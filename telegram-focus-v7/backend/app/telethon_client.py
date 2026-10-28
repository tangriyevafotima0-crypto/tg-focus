import asyncio
import inspect
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from dotenv import load_dotenv
from sqlalchemy import select
from telethon import TelegramClient, events
from telethon.errors import FloodWaitError
from telethon.tl import types

from .database import async_session_factory
from .media import MAX_UPLOAD_MB, safe_media_path
from .models import Message, Source


logger = logging.getLogger(__name__)
BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")

SESSION_PATH = str(BACKEND_DIR / "telegram_focus")
MessageCallback = Callable[[dict[str, Any]], Awaitable[None] | None]

_client: Optional[TelegramClient] = None
_stop_event = asyncio.Event()

_background_tasks: set[asyncio.Task] = set()


def _spawn_background_task(coro: Awaitable[None]) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


def _settings() -> tuple[int, str, str]:
    raw_api_id = os.getenv("TELEGRAM_API_ID", "").strip()
    api_hash = os.getenv("TELEGRAM_API_HASH", "").strip()
    phone = os.getenv("TELEGRAM_PHONE", "").strip()
    if not raw_api_id or not api_hash or not phone:
        raise RuntimeError(
            "TELEGRAM_API_ID, TELEGRAM_API_HASH va TELEGRAM_PHONE backend/.env da "
            "to‘ldirilishi kerak."
        )
    try:
        api_id = int(raw_api_id)
    except ValueError as exc:
        raise RuntimeError("TELEGRAM_API_ID faqat raqam bo‘lishi kerak.") from exc
    return api_id, api_hash, phone


def _normalize_identifier(value: str) -> str:
    """Identifier ni yagona kanonik ko'rinishga keltiradi:
    - https://t.me/username, http://t.me/username, t.me/username, tg://resolve?domain=username
    - @username -> username
    - Kichik harflarga o'tkazish va bo'shliqlarni olib tashlash.
    """
    raw = str(value or "").strip()
    if not raw:
        return ""
    lowered = raw.casefold()
    for prefix in (
        "https://telegram.me/",
        "http://telegram.me/",
        "telegram.me/",
        "https://t.me/",
        "http://t.me/",
        "t.me/",
        "tg://resolve?domain=",
    ):
        if lowered.startswith(prefix):
            raw = raw[len(prefix):]
            break
    # Query string yoki slash'dan keyingi qismlarni tozalash (masalan t.me/kanal/123)
    raw = raw.split("?")[0].split("/")[0].strip()
    return raw.lstrip("@").casefold()


def _identifier_variants(value: Any) -> set[str]:
    """Telegram chat_id va entity.id tafovutlarini (-100 prefix, - prefix, musbat ID,
    @username, t.me/username) to'liq qamrab oluvchi kanonik variantlar to'plami.
    Bu Bug #1 (manbani o'chirib qo'yganda ham xabar kelaverishi) ni ildizidan hal qiladi.
    """
    norm = _normalize_identifier(str(value or ""))
    if not norm:
        return set()
    variants = {norm}
    # Raqamli ID bo'lsa: musbat, -id va -100id variantlarini hosil qilamiz
    digits = None
    if norm.startswith("-100") and norm[4:].isdigit():
        digits = norm[4:]
    elif norm.startswith("-") and norm[1:].isdigit():
        digits = norm[1:]
    elif norm.startswith("+") and norm[1:].isdigit():
        digits = norm[1:]
        variants.add(digits)
    elif norm.isdigit():
        digits = norm

    if digits:
        variants.add(digits)
        variants.add(f"-{digits}")
        variants.add(f"-100{digits}")
    return variants


def _collect_entity_identifiers(entity: Any, fallback_id: Any = None) -> set[str]:
    """Chat yoki Sender obyekti uchun barcha mumkin bo'lgan identifikatorlar."""
    ids: set[str] = set()
    if fallback_id is not None:
        ids.update(_identifier_variants(fallback_id))
    if entity is None:
        return ids
    ent_id = getattr(entity, "id", None)
    if ent_id is not None:
        ids.update(_identifier_variants(ent_id))
    username = getattr(entity, "username", None)
    if username:
        ids.update(_identifier_variants(username))
    # Ko'p username'li kanallar/foydalanuvchilar (Telegram collectible usernames)
    usernames = getattr(entity, "usernames", None)
    if usernames:
        for u_obj in usernames:
            u_str = getattr(u_obj, "username", None)
            if u_str:
                ids.update(_identifier_variants(u_str))
    phone = getattr(entity, "phone", None)
    if phone:
        ids.update(_identifier_variants(phone))
        ids.update(_identifier_variants(f"+{str(phone).lstrip('+')}"))
    return ids


def _display_name(entity: Any) -> str:
    if isinstance(entity, types.User):
        name = " ".join(
            part for part in (entity.first_name, entity.last_name) if part
        ).strip()
        return name or entity.username or str(entity.id)
    return (
        getattr(entity, "title", None)
        or getattr(entity, "username", None)
        or str(getattr(entity, "id", "Noma’lum"))
    )


def _source_matches(source: Source, target_identifiers: set[str], target_names: set[str]) -> bool:
    """Manba berilgan identifikatorlar yoki aniq nom bilan mos kelishini tekshiradi."""
    src_variants = _identifier_variants(source.identifier)
    if src_variants & target_identifiers:
        return True
    # Agar foydalanuvchi identifier sifatida kanal/guruh/odamning ko'rinadigan nomini yozgan bo'lsa:
    src_id_norm = _normalize_identifier(source.identifier)
    src_name_norm = (source.display_name or "").strip().casefold()
    if src_id_norm and src_id_norm in target_names:
        return True
    if src_name_norm and len(src_name_norm) >= 3 and src_name_norm in target_names:
        return True
    return False


def _media_type(message: Any) -> Optional[str]:
    if not message or not message.media:
        return None
    if message.photo:
        return "photo"
    if message.video:
        return "video"
    if message.voice:
        return "voice"
    if message.audio:
        return "audio"
    if message.document:
        return "document"
    if message.sticker:
        return "sticker"
    return "media"


_URL_RE = re.compile(r"https?://\S+")


def _extract_links(text: str) -> list[str]:
    if not text:
        return []
    return _URL_RE.findall(text)


def _media_mime(message: Any) -> Optional[str]:
    document = getattr(message, "document", None)
    if document is not None and getattr(document, "mime_type", None):
        return document.mime_type
    if getattr(message, "photo", None):
        return "image/jpeg"
    return None


def _media_extension(mime: Optional[str], media_type_hint: Optional[str]) -> str:
    if mime and "/" in mime:
        ext = mime.split("/")[-1].split(";")[0]
        if ext:
            return ext
    return media_type_hint or "bin"


async def _maybe_download_media(
    message: Any,
    media_type: Optional[str],
    source_id: int,
) -> tuple[bool, Optional[str], Optional[str]]:
    """Download small media to data/media/. Never blocks message saving on failure.

    Returns (has_media_file, media_mime, media_name).
    """
    if media_type is None or not message.media:
        return False, None, None

    mime = _media_mime(message)
    try:
        size = getattr(message.file, "size", None) if message.file else None
        if size is not None and size > MAX_UPLOAD_MB * 1024 * 1024:
            return False, mime, None

        ext = _media_extension(mime, media_type)
        file_name = f"{source_id}_{message.id}.{ext}"
        target_path = safe_media_path(file_name)
        await message.download_media(file=str(target_path))
        return True, mime, file_name
    except Exception:
        logger.exception("Media yuklab olishda xato (xabar baribir saqlanadi)")
        return False, mime, None


async def _maybe_analyze_media(
    media_type: Optional[str],
    media_name: str,
    original_text: str,
) -> tuple[str, Optional[str]]:
    """Stage 1: yuklab olingan media ustida OCR/audio/PDF tahlili."""
    try:
        from .media import safe_media_path
        from .opportunity import dashboard_formatter, media_analyzer

        path = safe_media_path(media_name)

        if media_type == "photo":
            result = await media_analyzer.analyze_image(path)
            dashboard = dashboard_formatter.format_media_analysis("photo", result)
            dashboard_json = json.dumps(dashboard, ensure_ascii=False) if dashboard else None
            if result.get("ok") and result.get("text"):
                return result["text"], dashboard_json
            return original_text, dashboard_json

        if media_type in ("voice", "audio"):
            result = await media_analyzer.analyze_audio(path)
            dashboard = dashboard_formatter.format_media_analysis(media_type, result)
            dashboard_json = json.dumps(dashboard, ensure_ascii=False) if dashboard else None
            if result.get("ok") and result.get("text"):
                return result["text"], dashboard_json
            return original_text, dashboard_json

        if media_type == "document" and path.suffix.lower() == ".pdf":
            result = await media_analyzer.analyze_document(path)
            if result.get("ok"):
                dashboard = dashboard_formatter.format_media_analysis("document", result)
                dashboard_json = json.dumps(dashboard, ensure_ascii=False) if dashboard else None
                return result.get("text") or original_text, dashboard_json
            return original_text, None

        return original_text, None
    except Exception:
        logger.exception("Media tahlilida xato (xabar baribir saqlanadi, o'zgarishsiz)")
        return original_text, None


def _entity_type(entity: Any) -> str:
    if isinstance(entity, types.User):
        return "user"
    if isinstance(entity, types.Channel):
        return "channel" if entity.broadcast else "group"
    return "group"


async def _maybe_call(callback: Optional[MessageCallback], payload: dict[str, Any]) -> None:
    if callback is None:
        return
    result = callback(payload)
    if inspect.isawaitable(result):
        await result


async def _handle_new_message(
    event: events.NewMessage.Event,
    callback: Optional[MessageCallback],
) -> None:
    """Yangi kiruvchi Telegram xabarini qayta ishlaydi.
    MUHIM: Bu funksiya HECH QACHON `client.send_read_acknowledge()` chaqirmaydi,
    ya'ni Telegramning o'zida xabar "o'qildi" bo'lib qolmaydi (Bug #2 talabi).
    """
    if event.out or getattr(event.message, "out", False):
        return
    try:
        entity = await event.get_chat()
        sender = await event.get_sender()
        chat_id = event.chat_id
        if entity is None or chat_id is None:
            return

        chat_identifiers = _collect_entity_identifiers(entity, fallback_id=chat_id)
        sender_identifiers = _collect_entity_identifiers(
            sender, fallback_id=getattr(event.message, "sender_id", None)
        )
        all_identifiers = chat_identifiers | sender_identifiers

        entity_name = _display_name(entity).strip().casefold()
        sender_name = _display_name(sender or entity).strip().casefold()
        target_names = {n for n in (entity_name, sender_name) if n}

        async with async_session_factory() as session:
            all_res = await session.execute(
                select(Source).where(Source.kind == "telegram")
            )
            all_sources = all_res.scalars().all()

            # 1. Chat (kanal/guruh/DM) bo'yicha mos manbalarni topish
            chat_matched_sources = [
                src for src in all_sources
                if src.identifier != "dm_unmonitored"
                and _source_matches(src, chat_identifiers, {entity_name} if entity_name else set())
            ]
            # 2. Yuboruvchi (odam) bo'yicha mos manbalarni topish (masalan guruh ichidagi odam yoki DM)
            sender_matched_sources = [
                src for src in all_sources
                if src.identifier != "dm_unmonitored"
                and _source_matches(src, sender_identifiers, {sender_name} if sender_name else set())
            ]
            matched_candidates = chat_matched_sources or sender_matched_sources

            # BUG #1 QAT'IY HIMOYA:
            # Agar chat manbasi YOKI yuboruvchi (odam) manbasi foydalanuvchi tomonidan
            # to'xtatilgan (is_active == False) bo'lsa, xabar UMUMAN qabul qilinmaydi
            # (imkoniyat motoriga ham, dm_unmonitored ga ham o'tmaydi).
            if any(not src.is_active for src in chat_matched_sources) or any(
                not src.is_active for src in sender_matched_sources
            ):
                paused_names = ", ".join(
                    src.display_name
                    for src in (chat_matched_sources + sender_matched_sources)
                    if not src.is_active
                )
                logger.info(
                    "Xabar bloklandi: manba uzatishi to‘xtatilgan (%s)",
                    paused_names,
                )
                return

            # Imkoniyat-aniqlash motori faqat manba to'xtatilmagan bo'lsagina ishga tushadi
            try:
                from .opportunity.engine import handle_incoming
                from .routers.messages import message_manager

                await handle_incoming(
                    chat_id,
                    _display_name(entity),
                    event.message.message or "",
                    event.message.date,
                    event.message.id,
                    message_manager.broadcast,
                    event.client,
                )
            except Exception:
                logger.exception("Imkoniyat-aniqlashda xato (asosiy oqimga ta'sir qilmaydi)")

            active_source = next((src for src in matched_candidates if src.is_active), None)
            if active_source is None:
                if event.is_private:
                    res = await session.execute(
                        select(Source).where(Source.identifier == "dm_unmonitored")
                    )
                    dm_source = res.scalars().first()
                    if dm_source is None or not dm_source.is_active:
                        return
                    active_source = dm_source
                else:
                    return

            matched_source = active_source
            message = event.message
            received_at = datetime.now(timezone.utc)
            media_type = _media_type(message)
            has_media_file, media_mime, media_name = await _maybe_download_media(
                message, media_type, matched_source.id
            )
            links = _extract_links(message.message or "")
            reply_to_message_id = getattr(message, "reply_to_msg_id", None)
            record_text = message.message or ""

            record = Message(
                source_id=matched_source.id,
                sender_name=_display_name(sender or entity),
                text=record_text,
                media_type=media_type,
                telegram_message_id=message.id,
                received_at=received_at,
                is_read=False,
                is_starred=False,
                reply_to_message_id=reply_to_message_id,
                chat_id=chat_id,
                direction="in",
                has_media_file=has_media_file,
                media_mime=media_mime,
                media_name=media_name,
                link_urls=json.dumps(links) if links else None,
                channel="telegram",
                media_analysis_json=None,
            )
            if matched_source and matched_source.identifier == "dm_unmonitored":
                record.is_archived = True
            session.add(record)
            await session.commit()
            await session.refresh(record)

            record_id = record.id
            source_id = matched_source.id
            source_display_name = matched_source.display_name
            source_identifier = matched_source.identifier
            source_type_val = matched_source.type.value if hasattr(matched_source.type, "value") else str(matched_source.type)

            payload = {
                "id": record.id,
                "source_id": matched_source.id,
                "source_display_name": source_display_name,
                "source_identifier": source_identifier,
                "source_type": source_type_val,
                "source_is_active": matched_source.is_active,
                "sender_name": record.sender_name,
                "text": record.text,
                "media_type": record.media_type,
                "media_path": record.media_path,
                "telegram_message_id": record.telegram_message_id,
                "received_at": record.received_at.isoformat(),
                "is_read": record.is_read,
                "is_archived": record.is_archived,
                "is_starred": record.is_starred,
                "archived_at": None,
                "reply_to_message_id": record.reply_to_message_id,
                "chat_id": record.chat_id,
                "direction": record.direction,
                "has_media_file": record.has_media_file,
                "media_mime": record.media_mime,
                "media_name": record.media_name,
                "link_urls": links,
                "channel": record.channel,
                "triage_level": record.triage_level,
                "triage_reason": record.triage_reason,
                "triage_auto_reply": record.triage_auto_reply,
                "triage_dashboard": (
                    json.loads(record.triage_dashboard_json) if record.triage_dashboard_json else None
                ),
                "media_analysis": (
                    json.loads(record.media_analysis_json) if record.media_analysis_json else None
                ),
            }

        await _maybe_call(callback, payload)

        _spawn_background_task(
            _process_message_stages(
                record_id,
                source_id,
                source_identifier,
                callback,
                media_type=media_type,
                media_name=media_name,
                has_media_file=has_media_file,
            )
        )

    except Exception:
        logger.exception("_handle_new_message xatoligi")


async def _process_message_stages(
    record_id: int,
    source_id: int,
    source_identifier: str,
    callback: Optional[MessageCallback],
    *,
    media_type: Optional[str] = None,
    media_name: Optional[str] = None,
    has_media_file: bool = False,
) -> None:
    try:
        async with async_session_factory() as session:
            record = await session.get(Message, record_id)
            if record is None:
                return
            source = await session.get(Source, source_id)
            if source is not None and not source.is_active:
                # Manba orada o'chirilgan bo'lsa fon bosqichini to'xtatamiz
                return

            if has_media_file and media_name:
                try:
                    new_text, media_analysis_json = await _maybe_analyze_media(
                        media_type, media_name, record.text or ""
                    )
                    record.text = new_text
                    record.media_analysis_json = media_analysis_json
                    await session.commit()
                    await session.refresh(record)
                except Exception:
                    logger.exception("Media tahlil bosqichida xato (xabar o'zgarishsiz qoladi)")

            try:
                from .opportunity.triage import classify_message

                triage_result = await classify_message(record)
                record.triage_level = triage_result.level
                record.triage_reason = triage_result.reason
                record.triage_auto_reply = triage_result.auto_reply_text
                if triage_result.level == 3:
                    from .opportunity import dashboard_formatter

                    dashboard = dashboard_formatter.format_triage_emergency(
                        record.text, triage_result.reason
                    )
                    record.triage_dashboard_json = json.dumps(dashboard, ensure_ascii=False)
                await session.commit()
                await session.refresh(record)
            except Exception:
                logger.exception("Triage klassifikatsiyasida xato (xabar baribir saqlangan)")

            try:
                is_unmonitored = source_identifier == "dm_unmonitored"
                if is_unmonitored or record.triage_level == 2:
                    from .opportunity.auto_responder import send_executive_reply
                    await send_executive_reply(record)
            except Exception:
                logger.exception("Executive auto-reply yuborishda xato")

            # Manba hali ham faolligini qayta tekshiramiz
            source = await session.get(Source, source_id)
            if source is not None and not source.is_active:
                return

            update_payload = {
                "id": record.id,
                "is_update": True,
                "source_id": record.source_id,
                "source_display_name": source.display_name if source else "Noma'lum",
                "source_is_active": source.is_active if source else True,
                "sender_name": record.sender_name,
                "received_at": record.received_at.isoformat() if record.received_at else None,
                "is_read": record.is_read,
                "is_archived": record.is_archived,
                "is_starred": record.is_starred,
                "channel": record.channel,
                "text": record.text,
                "triage_level": record.triage_level,
                "triage_reason": record.triage_reason,
                "triage_auto_reply": record.triage_auto_reply,
                "triage_dashboard": (
                    json.loads(record.triage_dashboard_json) if record.triage_dashboard_json else None
                ),
                "media_analysis": (
                    json.loads(record.media_analysis_json) if record.media_analysis_json else None
                ),
            }
        await _maybe_call(callback, update_payload)
    except Exception:
        logger.exception("_process_message_stages xatoligi (record_id=%s)", record_id)


async def run_telegram_client(
    on_new_filtered_message: Optional[MessageCallback] = None,
    *,
    interactive: bool = False,
) -> None:
    """Run the Telethon userbot until shutdown."""
    global _client
    try:
        api_id, api_hash, phone = _settings()
    except RuntimeError as exc:
        logger.warning("Telethon ishga tushmadi: %s", exc)
        return

    _stop_event.clear()
    client = TelegramClient(SESSION_PATH, api_id, api_hash, catch_up=True)
    _client = client
    client.add_event_handler(
        lambda event: _handle_new_message(event, on_new_filtered_message),
        events.NewMessage(incoming=True),
    )

    try:
        while not _stop_event.is_set():
            try:
                if not client.is_connected():
                    await client.connect()
                if not await client.is_user_authorized():
                    if not interactive:
                        logger.error(
                            "Telethon session topilmadi. Avval terminalda "
                            "`python -m app.telethon_client` bilan bir marta login qiling."
                        )
                        return
                    await client.start(phone=phone)

                logger.info("Telethon ulandi; filtrlangan xabarlar tinglanmoqda.")
                await client.run_until_disconnected()
            except FloodWaitError as exc:
                logger.warning("Flood wait: %s soniya kutilyapti.", exc.seconds)
                await asyncio.sleep(exc.seconds)
            except (ConnectionError, OSError) as exc:
                logger.warning("Telegram ulanishi uzildi: %s", exc)
                if not _stop_event.is_set():
                    await asyncio.sleep(5)
            else:
                if not _stop_event.is_set():
                    logger.warning("Telegram ulanishi uzildi; 5 soniyadan keyin qayta ulanadi.")
                    await asyncio.sleep(5)
    except (asyncio.CancelledError, KeyboardInterrupt):
        raise
    except Exception:
        logger.exception("Telethon client xatosi")
    finally:
        if client.is_connected():
            await client.disconnect()
        if _client is client:
            _client = None


def get_client() -> TelegramClient:
    """Return the running Telethon client, or raise if it isn't connected."""
    if _client is None:
        raise RuntimeError("Telegram mijozi ulanmagan.")
    return _client


async def stop_telegram_client() -> None:
    _stop_event.set()
    if _client is not None and _client.is_connected():
        await _client.disconnect()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    asyncio.run(run_telegram_client(interactive=True))