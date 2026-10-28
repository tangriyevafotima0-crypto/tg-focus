"""Email fon ishchisi: har N soniyada faol hisoblarni ketma-ket tekshiradi."""
import asyncio
import logging
import os
import re
import time
from typing import Any, Awaitable, Callable, Optional

from sqlalchemy import select

from urllib.parse import urlparse

from .database import async_session_factory
from .email_client import (
    EmailAuthError,
    EmailConnectionError,
    ParsedEmail,
    fetch_new,
    humanize_auth_error,
)
from .email_crypto import decrypt_password
from .models import EmailAccount, Message, Opportunity, SubmittedOpportunity, Source, SourceType, utc_now
from .opportunity.delivery import send_telegram_alert

logger = logging.getLogger(__name__)

Broadcast = Callable[[dict[str, Any]], Awaitable[None]]

MIN_POLL_SECONDS = 30
DEFAULT_POLL_SECONDS = 60
BACKOFF_START = 60
BACKOFF_MAX = 15 * 60

_check_lock = asyncio.Lock()
# account_id -> (keyingi urinish vaqti monotonic, joriy kutish soniyasi)
_backoff: dict[int, tuple[float, int]] = {}


def poll_seconds() -> int:
    try:
        value = int(os.getenv("EMAIL_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)))
    except ValueError:
        value = DEFAULT_POLL_SECONDS
    return max(value, MIN_POLL_SECONDS)


def _register_failure(account_id: int) -> int:
    previous = _backoff.get(account_id, (0.0, BACKOFF_START // 2))[1]
    delay = min(max(previous * 2, BACKOFF_START), BACKOFF_MAX)
    _backoff[account_id] = (time.monotonic() + delay, delay)
    return delay


def _clear_backoff(account_id: int) -> None:
    _backoff.pop(account_id, None)


async def _get_or_create_source(session, account: EmailAccount) -> Source:
    identifier = f"email:{account.id}"
    result = await session.execute(
        select(Source).where(Source.identifier == identifier, Source.kind == "email")
    )
    source = result.scalar_one_or_none()
    if source is None:
        source = Source(
            identifier=identifier,
            display_name=account.label,
            type=SourceType.USER,
            is_active=True,
            kind="email",
        )
        session.add(source)
        await session.flush()
    elif source.display_name != account.label:
        source.display_name = account.label
    return source


def message_payload(record: Message, source: Source, extra: Optional[dict] = None) -> dict[str, Any]:
    import json

    payload = {
        "id": record.id,
        "source_id": source.id,
        "source_display_name": source.display_name,
        "sender_name": record.sender_name,
        "text": record.text,
        "media_type": None,
        "media_path": None,
        "telegram_message_id": record.telegram_message_id,
        "received_at": record.received_at.isoformat(),
        "is_read": record.is_read,
        "is_archived": record.is_archived,
        "archived_at": None,
        "reply_to_message_id": None,
        "chat_id": record.chat_id,
        "direction": "in",
        "has_media_file": False,
        "media_mime": None,
        "media_name": None,
        "link_urls": json.loads(record.link_urls) if record.link_urls else None,
        "channel": "email",
    }
    if extra:
        payload.update(extra)
    return payload


def extract_domain(email_or_url: Optional[str]) -> str:
    """Email manzili yoki URL'dan asosiy domenni ajratib oladi."""
    if not email_or_url:
        return ""
    val = email_or_url.strip().lower()
    if "@" in val:
        return val.split("@")[-1]
    if "://" in val or val.startswith("www."):
        if not val.startswith("http"):
            val = "https://" + val
        netloc = urlparse(val).netloc
        return netloc.replace("www.", "")
    return val


async def link_to_submission(session, parsed: ParsedEmail) -> Optional[dict[str, Any]]:
    """Kelgan xatni ochiq (status == 'submitted') topshiriqlar bilan bog'laydi.

    Domen mosligi ANIQ bo'lishi kerak: `==` yoki `.endswith("." + domain)`.
    Qism-satr tekshiruvi (masalan `org_name in sender_domain`) ATAYLAB ishlatilmaydi —
    xato manbai edi (masalan "Art Fund" tashkiloti "startfund.org" bilan mos kelib qolardi).
    Faqat Telegram orqali ogohlantiradi; email yozmaydi/javob bermaydi.
    """
    sender_domain = extract_domain(parsed.from_addr)
    if not sender_domain:
        return None

    result = await session.execute(
        select(SubmittedOpportunity)
        .join(Opportunity, SubmittedOpportunity.opportunity_id == Opportunity.id)
        .where(SubmittedOpportunity.status == "submitted")
    )
    submissions = result.scalars().all()

    for submission in submissions:
        opp_domain = extract_domain(submission.opportunity.url)
        if not opp_domain:
            continue
        if sender_domain == opp_domain or sender_domain.endswith("." + opp_domain):
            submission.status = "response_received"
            await session.commit()
            try:
                await send_telegram_alert(
                    f"📬 Siz topshirgan **{submission.opportunity.title}** dasturi bo'yicha "
                    f"yangi javob keldi ({sender_domain})."
                )
            except Exception:
                logger.exception("Email: Telegram ogohlantirishni yuborishda xato")
            return {"matched_by": "domain", "submission_id": submission.id}

    return None


async def check_account_once(
    account_id: int,
    broadcast: Optional[Broadcast] = None,
    force: bool = False,
) -> int:
    """Bitta hisobni tekshiradi. Yangi saqlangan xatlar sonini qaytaradi.

    force=True: backoff'ni e'tiborsiz qoldiradi (check-now).
    Xatolar last_error ga yoziladi va qayta ko'tarilmaydi (boshqa hisoblar to'xtamasin);
    check-now uchun xato matni chaqiruvchiga last_error orqali ko'rinadi.
    """
    import json

    if not force:
        until = _backoff.get(account_id, (0.0, 0))[0]
        if until and time.monotonic() < until:
            return 0

    async with async_session_factory() as session:
        account = await session.get(EmailAccount, account_id)
        if account is None or (not account.is_active and not force):
            return 0
        try:
            password = decrypt_password(account.password_enc)
        except ValueError as exc:
            account.last_error = str(exc)
            await session.commit()
            _register_failure(account_id)
            return 0

        try:
            result = await fetch_new(account, password)
        except EmailAuthError as exc:
            account.last_error = humanize_auth_error(account.imap_host, str(exc))
            await session.commit()
            delay = _register_failure(account_id)
            logger.warning("Email hisob %s: auth xatosi (keyingi urinish %ss).", account_id, delay)
            return 0
        except EmailConnectionError as exc:
            account.last_error = f"Ulanish xatosi: {str(exc)[:300]}"
            await session.commit()
            delay = _register_failure(account_id)
            logger.warning("Email hisob %s: tarmoq xatosi (keyingi urinish %ss): %s", account_id, delay, exc)
            return 0

        source = await _get_or_create_source(session, account)

        # X-19 (Stage 7): birinchi ishga tushirishda (last_uid=0) eski
        # BASELINE_COUNT (20 ta) xat "yangi" bo'lib keladi — bu kutilgan
        # xatti-harakat (fetch_new_sync ichida), lekin foydalanuvchi buni
        # kutmasligi mumkin. To'liq o'chirib yuborish o'rniga (chunki ba'zi
        # foydalanuvchilar aynan shuni xohlaydi — "oxirgi N ta xatni ko'r"),
        # hech bo'lmaganda aniq ogohlantirish logga yoziladi, shunda sabab
        # keyinchalik tushunarsiz bo'lib qolmaydi.
        if getattr(result, "baseline_skipped", 0) and result.emails:
            logger.info(
                "Email hisob %s: birinchi ishga tushirish — oxirgi %d ta xat "
                "'yangi' sifatida olindi (BASELINE_COUNT), %d ta eskiroq xat "
                "o'tkazib yuborildi.",
                account_id, len(result.emails), result.baseline_skipped,
            )

        # Takror oldini olish: (chat_id=account_id, telegram_message_id=uid, channel='email')
        uids = [item.uid for item in result.emails]
        existing: set[int] = set()
        if uids:
            rows = await session.execute(
                select(Message.telegram_message_id).where(
                    Message.channel == "email",
                    Message.chat_id == account.id,
                    Message.telegram_message_id.in_(uids),
                )
            )
            existing = {row[0] for row in rows.all()}

        created: list[tuple[Message, ParsedEmail]] = []
        for parsed in result.emails:
            if parsed.uid in existing:
                continue
            record = Message(
                source_id=source.id,
                sender_name=parsed.sender_display[:255],
                text=_compose_text(parsed),
                media_type=None,
                media_path=None,
                telegram_message_id=parsed.uid,
                received_at=_safe_received_at(parsed.date),
                is_read=False,
                chat_id=account.id,
                direction="in",
                has_media_file=False,
                link_urls=json.dumps(_extract_links(parsed.text), ensure_ascii=False)
                if _extract_links(parsed.text)
                else None,
                channel="email",
            )
            session.add(record)
            created.append((record, parsed))

        # fetch_new_sync UIDVALIDITY o'zgarganda o'zi 0 dan boshlaydi va new_last_uid ni
        # to'g'ri qaytaradi; shuning uchun natijani to'g'ridan-to'g'ri yozamiz.
        account.last_uid = result.new_last_uid
        account.uid_validity = result.uid_validity
        account.last_error = None
        await session.commit()
        _clear_backoff(account_id)

        for record, parsed in created:
            await session.refresh(record)
            if broadcast is not None:
                try:
                    await broadcast(
                        message_payload(record, source, {"attachments": _attachment_meta(parsed)})
                    )
                except Exception:
                    logger.exception("Email broadcast xatosi")
            try:
                await link_to_submission(session, parsed)
            except Exception:
                logger.exception("Email: link_to_submission xatosi")
        return len(created)


def _safe_received_at(value):
    """Yolg'on kelajak sanali xat ro'yxat tepasida qotib qolmasin: hozirdan oshsa -> hozir."""
    now = utc_now()
    return now if value > now else value


_URL_RE = re.compile(r"https?://[^\s<>\"')\]]+", re.I)


def _extract_links(text: str, limit: int = 20) -> list[str]:
    seen: list[str] = []
    for match in _URL_RE.finditer(text or ""):
        url = match.group(0).rstrip(".,;:!?")
        if url not in seen:
            seen.append(url)
        if len(seen) >= limit:
            break
    return seen


def _format_size(size: int) -> str:
    if size >= 1024 * 1024:
        return f"{size / (1024 * 1024):.1f} MB"
    if size >= 1024:
        return f"{size // 1024} KB"
    return f"{size} B"


def _compose_text(parsed: ParsedEmail) -> str:
    """Mavzu + matn + ilovalar ro'yxati (faqat nom/hajm; mazmun saqlanmaydi)."""
    text = parsed.message_text
    if parsed.attachments:
        lines = [f"📎 {item['name']} ({_format_size(item['size'])})" for item in parsed.attachments[:20]]
        text = f"{text}\n\n" + "\n".join(lines)
    return text


def _attachment_meta(parsed: ParsedEmail) -> list[dict[str, Any]]:
    return [{"name": item["name"], "size": item["size"]} for item in parsed.attachments]


async def check_all_accounts(broadcast: Optional[Broadcast] = None) -> int:
    """Barcha faol hisoblar, ketma-ket. Bir vaqtda ikki tekshiruv bo'lmaydi (Lock)."""
    if _check_lock.locked():
        return 0
    async with _check_lock:
        async with async_session_factory() as session:
            result = await session.execute(
                select(EmailAccount.id).where(EmailAccount.is_active.is_(True)).order_by(EmailAccount.id)
            )
            ids = [row[0] for row in result.all()]
        total = 0
        for account_id in ids:
            try:
                total += await check_account_once(account_id, broadcast)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Email hisob %s tekshiruvida kutilmagan xato", account_id)
        return total


async def check_account_locked(account_id: int, broadcast: Optional[Broadcast] = None) -> int:
    """check-now uchun: fon ishchi bilan bir xil Lock ostida (kutadi)."""
    async with _check_lock:
        return await check_account_once(account_id, broadcast, force=True)


async def email_worker_loop(broadcast: Optional[Broadcast] = None) -> None:
    logger.info("Email fon ishchisi ishga tushdi (har %ss).", poll_seconds())
    while True:
        try:
            await asyncio.sleep(poll_seconds())
            count = await check_all_accounts(broadcast)
            if count:
                logger.info("Email: %s ta yangi xat.", count)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Email fon ishchisi siklida xato")
