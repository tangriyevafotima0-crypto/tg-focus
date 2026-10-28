"""IMAP klient (stdlib: imaplib, email, html.parser, ssl). Ilova mazmuni SAQLANMAYDI."""
import asyncio
import email
import email.policy
import imaplib
import logging
import os
import re
import ssl
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parseaddr, parsedate_to_datetime
from html.parser import HTMLParser
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

IMAP_TIMEOUT = 30
# X-19 (Stage 7): birinchi ishga tushirishda nechta eski xat "yangi" deb
# ko'rsatilishini EMAIL_BASELINE_COUNT muhit o'zgaruvchisi orqali
# sozlash mumkin (standart xatti-harakat o'zgarmadi — hamon 20).
try:
    BASELINE_COUNT = max(0, int(os.getenv("EMAIL_BASELINE_COUNT", "20")))
except ValueError:
    BASELINE_COUNT = 20
MAX_BODY_BYTES = 2 * 1024 * 1024
MAX_TEXT_CHARS = 20_000
_TEXT_TRUNC_NOTE = "\n\n[... matn qisqartirildi ...]"


class EmailAuthError(Exception):
    """Login/parol rad etildi."""


class EmailConnectionError(Exception):
    """Tarmoq/server xatosi (vaqtinchalik bo'lishi mumkin)."""


@dataclass
class ParsedEmail:
    uid: int
    subject: str
    from_name: str
    from_addr: str
    date: datetime
    message_id: Optional[str]
    text: str
    attachments: list[dict[str, Any]] = field(default_factory=list)  # [{"name","size"}]
    truncated_body: bool = False  # 2MB dan katta -> faqat sarlavha

    @property
    def sender_display(self) -> str:
        if self.from_name and self.from_addr:
            return f"{self.from_name} <{self.from_addr}>"
        return self.from_addr or self.from_name or "Noma'lum"

    @property
    def message_text(self) -> str:
        return f"{self.subject}\n\n{self.text}".rstrip()


@dataclass
class FetchResult:
    emails: list[ParsedEmail]
    new_last_uid: int
    uid_validity: Optional[int]
    baseline_skipped: int = 0


# ---------------------------------------------------------------- HTML -> matn
class _TextExtractor(HTMLParser):
    _BLOCK = {"p", "div", "br", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "blockquote"}
    _SKIP = {"script", "style", "head", "title"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in self._SKIP:
            self._skip_depth += 1
        elif tag in self._BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self._SKIP and self._skip_depth:
            self._skip_depth -= 1
        elif tag in self._BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self._skip_depth:
            self.parts.append(data)


def html_to_text(html: str) -> str:
    parser = _TextExtractor()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        # Buzuq HTML: teglarni oddiy regex bilan olib tashlaymiz.
        return re.sub(r"<[^>]+>", " ", html)
    text = "".join(parser.parts)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r" ?\n ?", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ---------------------------------------------------------------- MIME tahlili
def _safe_header(msg, name: str) -> str:
    try:
        value = msg[name]
        return str(value) if value is not None else ""
    except Exception:
        try:
            raw = msg.get(name)
            return str(raw) if raw is not None else ""
        except Exception:
            return ""


def _body_text(part) -> str:
    try:
        content = part.get_content()
        if isinstance(content, str):
            return content
    except Exception:
        pass
    payload = part.get_payload(decode=True) or b""
    charset = part.get_content_charset() or "utf-8"
    try:
        return payload.decode(charset, errors="replace")
    except LookupError:
        return payload.decode("utf-8", errors="replace")


def _clip(text: str) -> str:
    text = text.replace("\x00", "")
    if len(text) > MAX_TEXT_CHARS:
        return text[:MAX_TEXT_CHARS] + _TEXT_TRUNC_NOTE
    return text


def parse_email_bytes(raw: bytes, uid: int, truncated_body: bool = False) -> ParsedEmail:
    msg = email.message_from_bytes(raw, policy=email.policy.default)

    subject = _safe_header(msg, "Subject").strip() or "(mavzusiz)"
    from_name, from_addr = parseaddr(_safe_header(msg, "From"))
    message_id = _safe_header(msg, "Message-ID").strip() or None

    date = datetime.now(timezone.utc)
    date_raw = _safe_header(msg, "Date")
    if date_raw:
        try:
            parsed_date = parsedate_to_datetime(date_raw)
            if parsed_date.tzinfo is None:
                parsed_date = parsed_date.replace(tzinfo=timezone.utc)
            date = parsed_date.astimezone(timezone.utc)
        except Exception:
            pass

    plain_parts: list[str] = []
    html_parts: list[str] = []
    attachments: list[dict[str, Any]] = []

    for part in msg.walk():
        if part.is_multipart():
            continue
        disposition = (part.get_content_disposition() or "").lower()
        ctype = part.get_content_type()
        filename = None
        try:
            filename = part.get_filename()
        except Exception:
            filename = None

        if disposition == "attachment" or (filename and ctype not in ("text/plain", "text/html")):
            try:
                size = len(part.get_payload(decode=True) or b"")
            except Exception:
                size = 0
            attachments.append({"name": (filename or "nomsiz")[:255], "size": size})
            continue
        if ctype == "text/plain":
            plain_parts.append(_body_text(part))
        elif ctype == "text/html":
            html_parts.append(_body_text(part))

    if plain_parts and "".join(plain_parts).strip():
        text = "\n".join(plain_parts)
    elif html_parts:
        text = html_to_text("\n".join(html_parts))
    else:
        text = ""

    return ParsedEmail(
        uid=uid,
        subject=_clip(subject)[:500],
        from_name=from_name,
        from_addr=from_addr,
        date=date,
        message_id=message_id,
        text=_clip(text.strip()),
        attachments=attachments,
        truncated_body=truncated_body,
    )


# ---------------------------------------------------------------- IMAP (sinxron)
_IMAP_FACTORY: Callable[..., Any] = None  # testlar uchun almashtiriladi


def _connect(host: str, port: int):
    if _IMAP_FACTORY is not None:
        return _IMAP_FACTORY(host, port)
    context = ssl.create_default_context()
    return imaplib.IMAP4_SSL(host, port, ssl_context=context, timeout=IMAP_TIMEOUT)


def _decode_uidvalidity(client) -> Optional[int]:
    try:
        typ, data = client.response("UIDVALIDITY")
        if data and data[0]:
            value = data[0]
            if isinstance(value, bytes):
                value = value.decode("ascii", "ignore")
            return int(str(value).strip())
    except Exception:
        pass
    return None


def _quote_folder(folder: str) -> str:
    escaped = folder.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _login_and_select(client, username: str, password: str, folder: str) -> Optional[int]:
    try:
        client.login(username, password)
    except imaplib.IMAP4.error as exc:
        raise EmailAuthError(str(exc)) from exc
    typ, data = client.select(_quote_folder(folder), readonly=True)
    if typ != "OK":
        raise EmailConnectionError(f"Papka ochilmadi: {folder}")
    return _decode_uidvalidity(client)


def check_login_sync(host: str, port: int, username: str, password: str, folder: str) -> None:
    """Saqlashdan oldingi tekshiruv: LOGIN + SELECT. Xatoda EmailAuthError/EmailConnectionError."""
    client = None
    try:
        client = _connect(host, port)
        _login_and_select(client, username, password, folder)
    except (EmailAuthError, EmailConnectionError):
        raise
    except (OSError, ssl.SSLError, imaplib.IMAP4.abort, imaplib.IMAP4.error, TimeoutError) as exc:
        raise EmailConnectionError(str(exc)) from exc
    finally:
        _safe_logout(client)


def _safe_logout(client) -> None:
    if client is None:
        return
    try:
        client.logout()
    except Exception:
        pass


def _uid_search(client, criteria: str) -> list[int]:
    typ, data = client.uid("SEARCH", None, criteria)
    if typ != "OK" or not data or not data[0]:
        return []
    return sorted(int(x) for x in data[0].split())


def _extract_fetch_bytes(data) -> Optional[bytes]:
    """IMAP FETCH javobidan literal (katta) qismni chiqarib oladi — bu
    `(seq (UID n BODY[...] {len}\\r\\n<data>) )` ko'rinishidagi tuple'da keladi."""
    if not data:
        return None
    for item in data:
        if isinstance(item, tuple) and len(item) >= 2 and isinstance(item[1], (bytes, bytearray)):
            return bytes(item[1])
    return None


def _extract_fetch_line(data) -> Optional[bytes]:
    """IMAP FETCH javobidan oddiy (literal bo'lmagan) matn qatorini oladi —
    bu RFC822.SIZE yoki BODYSTRUCTURE kabi javoblar uchun, ular odatda
    tuple emas, to'g'ridan-to'g'ri bytes qatori sifatida keladi."""
    if not data:
        return None
    for item in data:
        blob = item[0] if isinstance(item, tuple) else item
        if isinstance(blob, (bytes, bytearray)):
            return bytes(blob)
    return None


# X-19 (Stage 8): BODYSTRUCTURE javobidan "oddiy" holatlarda matn qismining
# MIME bo'lim raqamini chiqarib olishga urinish. Faqat ikkita juda tarqalgan
# ko'rinishni tushunadi:
#   1) bitta qismli xat (text/plain yoki text/html) -> bo'lim "1"
#   2) multipart/alternative yoki multipart/mixed'ning BIRINCHI pastki qismi
#      text/plain yoki text/html bo'lsa -> bo'lim "1"
# Bundan murakkabroq (ichma-ich multipart, boshida attachment va h.k.) holatlar
# ataylab qo'llab-quvvatlanmaydi — bunday holatda None qaytariladi va chaqiruvchi
# xavfsiz HEADER-only fallback'ga o'tadi. BODYSTRUCTURE formatini to'liq
# tahlil qilish (umumiy IMAP parser) bu yerda ataylab qilinmadi: real
# serverlarda juda ko'p format variatsiyasi bor, notog'ri tahlil qilish
# noto'g'ri bo'limni olib kelishi mumkin — soddaroq, tekshirilishi oson
# ikkita holat bilan cheklanish xavfsizroq.
def _guess_text_section(bodystructure_blob: bytes) -> Optional[str]:
    try:
        text = bodystructure_blob.decode("ascii", "replace")
    except Exception:
        return None
    # FETCH javobi "<seq> (UID <uid> BODYSTRUCTURE <tuzilish>)" ko'rinishida
    # keladi — avval shu tashqi o'ramni olib tashlab, faqat <tuzilish>
    # qismini (BODYSTRUCTURE so'zidan keyingisini, oxirgi yopuvchi qavssiz)
    # qoldiramiz.
    upper = text.upper()
    marker = "BODYSTRUCTURE "
    idx = upper.find(marker)
    if idx == -1:
        return None
    inner = text[idx + len(marker):]
    # Oxirgi yopuvchi qavs — FETCH javobining o'zinikidir (BODYSTRUCTURE
    # tuzilishini o'rab turgan tashqi qavs), uni olib tashlaymiz.
    if inner.endswith(")"):
        inner = inner[:-1]
    inner = inner.strip()
    inner_upper = inner.upper()

    # Bitta qismli: ("TEXT" "PLAIN" ...) — faqat bitta darajadagi qavs.
    if inner_upper.startswith('("TEXT"'):
        return "1"
    # Ko'p qismli, birinchi pastki qism matn: (("TEXT" "PLAIN" ...)(...) ...
    # "ALTERNATIVE"/"MIXED") — ko'pincha multipart/alternative yoki
    # multipart/mixed'ning birinchi qismi matn bo'ladi.
    if inner_upper.startswith('(("TEXT"'):
        return "1"
    return None


def _fetch_one(client, uid: int) -> Optional[ParsedEmail]:
    # Avval hajmni so'raymiz (BODY.PEEK[] o'qildi flagini o'zgartirmaydi).
    typ, data = client.uid("FETCH", str(uid), "(RFC822.SIZE)")
    size = 0
    if typ == "OK" and data:
        for item in data:
            blob = item[0] if isinstance(item, tuple) else item
            if isinstance(blob, bytes):
                match = re.search(rb"RFC822\.SIZE (\d+)", blob)
                if match:
                    size = int(match.group(1))

    if size > MAX_BODY_BYTES:
        # X-19 (Stage 8): avval FAQAT sarlavha olinardi — butun matn
        # yo'qolardi. Endi avval BODYSTRUCTURE so'ralib, "oddiy" MIME
        # tuzilishi bo'lsa, faqat matn qismi (odatda attachment'lardan
        # ancha kichik) alohida olib ko'riladi — shunda foydalanuvchi
        # xat matnini o'qiy oladi, faqat katta ilovalar o'tkazib
        # yuboriladi. Murakkab tuzilish bo'lsa (yoki BODYSTRUCTURE
        # so'rovi muvaffaqiyatsiz bo'lsa) — xavfsiz HEADER-only fallback.
        text_section = None
        try:
            bs_typ, bs_data = client.uid("FETCH", str(uid), "(BODYSTRUCTURE)")
            bs_raw = _extract_fetch_line(bs_data) if bs_typ == "OK" else None
            if bs_raw is not None:
                text_section = _guess_text_section(bs_raw)
        except Exception as exc:
            logger.warning("UID %s BODYSTRUCTURE olinmadi: %s", uid, exc)

        truncated = True
        text_only_ok = False
        if text_section is not None:
            try:
                typ, data = client.uid("FETCH", str(uid), f"(BODY.PEEK[{text_section}])")
                section_raw = _extract_fetch_bytes(data) if typ == "OK" else None
            except Exception as exc:
                logger.warning("UID %s matn qismi (bo'lim %s) olinmadi: %s", uid, text_section, exc)
                section_raw = None
            if section_raw is not None and len(section_raw) <= MAX_BODY_BYTES:
                # Faqat matn qismi — to'liq email xabari emas (sarlavhalarsiz).
                # parse_email_bytes() to'liq MIME xabar kutadi, shuning uchun
                # minimal sarlavha bilan qayta o'raymiz (Content-Type va h.k.
                # BODYSTRUCTURE'dan aniq bilmasak ham, matnni plain-text
                # sifatida ko'rsatish yetarli).
                wrapped = b"Content-Type: text/plain; charset=utf-8\r\n\r\n" + section_raw
                parsed = parse_email_bytes(wrapped, uid, truncated_body=True)
                # Haqiqiy sarlavhalarni (Subject/From/Date) alohida HEADER
                # so'rovi bilan to'ldiramiz, chunki yuqoridagi "wrapped"da
                # ular yo'q.
                try:
                    h_typ, h_data = client.uid("FETCH", str(uid), "(BODY.PEEK[HEADER])")
                    h_raw = _extract_fetch_bytes(h_data) if h_typ == "OK" else None
                except Exception:
                    h_raw = None
                if h_raw is not None:
                    header_only = parse_email_bytes(h_raw, uid, truncated_body=True)
                    parsed.subject = header_only.subject
                    parsed.from_name = header_only.from_name
                    parsed.from_addr = header_only.from_addr
                    parsed.date = header_only.date
                    parsed.message_id = header_only.message_id
                parsed.text = (
                    f"[Xat hajmi {size // 1024} KB — 2 MB dan katta, faqat matn qismi ko'rsatildi, "
                    f"ilova(lar) o'tkazib yuborildi]\n\n" + parsed.text
                )
                return parsed
        # Matn qismini alohida olib bo'lmadi (murakkab tuzilish yoki xato) —
        # oldingi xavfsiz xatti-harakat: faqat sarlavha, aniq belgi bilan.
        typ, data = client.uid("FETCH", str(uid), "(BODY.PEEK[HEADER])")
    else:
        typ, data = client.uid("FETCH", str(uid), "(BODY.PEEK[])")
        truncated = False

    raw = _extract_fetch_bytes(data) if typ == "OK" else None
    if raw is None:
        return None
    parsed = parse_email_bytes(raw, uid, truncated_body=truncated)
    if truncated:
        parsed.text = f"[Xat hajmi {size // 1024} KB — 2 MB dan katta, faqat sarlavha olindi — matn qismini ajratib bo'lmadi]"
    return parsed


def fetch_new_sync(
    host: str,
    port: int,
    username: str,
    password: str,
    folder: str,
    last_uid: int,
    stored_uid_validity: Optional[int],
) -> FetchResult:
    client = None
    try:
        client = _connect(host, port)
        uid_validity = _login_and_select(client, username, password, folder)

        if (
            stored_uid_validity is not None
            and uid_validity is not None
            and stored_uid_validity != uid_validity
        ):
            logger.info("UIDVALIDITY o'zgardi (%s -> %s): qayta baseline.", stored_uid_validity, uid_validity)
            last_uid = 0

        skipped = 0
        if last_uid == 0:
            all_uids = _uid_search(client, "ALL")
            if not all_uids:
                return FetchResult([], 0, uid_validity)
            wanted = all_uids[-BASELINE_COUNT:]
            skipped = len(all_uids) - len(wanted)
        else:
            found = [u for u in _uid_search(client, f"UID {last_uid + 1}:*") if u > last_uid]
            if not found:
                return FetchResult([], last_uid, uid_validity)
            wanted = found

        # X-20 (Stage 8): avval `new_last` FETCH urinishlaridan OLDIN, oddiy
        # `max(...)` bilan hisoblanardi — agar biror UID (masalan 105)
        # olinmasa (tarmoq xatosi, vaqtinchalik IMAP xatosi) va undan
        # kattaroq UID (106) muvaffaqiyatli bo'lsa, baribir `new_last=106`
        # saqlanardi. Keyingi safar qidiruv `UID 107:*` dan boshlanadi —
        # 105 ABADIY o'tkazib yuboriladi (hech qachon qayta urinilmaydi).
        #
        # Endi: `new_last` faqat ketma-ket (uzilishsiz) muvaffaqiyatli
        # olingan UID'lar bo'yicha oldinga suriladi. Birinchi muvaffaqiyatsiz
        # UID'dan boshlab to'xtaymiz (undan keyingi, hatto muvaffaqiyatli
        # bo'lganlari ham, keyingi safar qayta so'raladi — xavfsiz, faqat
        # ortiqcha ish, ma'lumot yo'qolmaydi). `wanted` saralangan (sorted)
        # bo'lishi shart — pastda shunga tayanadi (`_uid_search` buni
        # ta'minlaydi).
        results: list[ParsedEmail] = []
        new_last = last_uid
        advancing = True
        for uid in wanted:
            try:
                parsed = _fetch_one(client, uid)
            except (imaplib.IMAP4.error, OSError) as exc:
                logger.warning("UID %s olinmadi (keyingi safar qayta uriniladi): %s", uid, exc)
                advancing = False
                continue
            if parsed is not None:
                results.append(parsed)
            if advancing:
                new_last = uid
        return FetchResult(results, new_last, uid_validity, baseline_skipped=skipped)
    except (EmailAuthError, EmailConnectionError):
        raise
    except (OSError, ssl.SSLError, imaplib.IMAP4.abort, imaplib.IMAP4.error, TimeoutError) as exc:
        raise EmailConnectionError(str(exc)) from exc
    finally:
        _safe_logout(client)


async def fetch_new(account, password: str) -> FetchResult:
    """Sinxron imaplib kodi asyncio.to_thread ichida."""
    return await asyncio.to_thread(
        fetch_new_sync,
        account.imap_host,
        account.imap_port,
        account.username,
        password,
        account.folder,
        account.last_uid or 0,
        account.uid_validity,
    )


async def check_login(host: str, port: int, username: str, password: str, folder: str) -> None:
    await asyncio.to_thread(check_login_sync, host, port, username, password, folder)


def humanize_auth_error(host: str, raw: str) -> str:
    base = "Login yoki parol noto'g'ri."
    lower = (host or "").lower()
    if "gmail" in lower or "google" in lower:
        return base + " Gmail uchun oddiy parol ishlamaydi — 2 bosqichli tasdiqni yoqib, App Password (16 belgi) yarating."
    if "yahoo" in lower or "icloud" in lower or "me.com" in lower:
        return base + " Bu xizmat uchun App Password (ilova paroli) kerak."
    if any(x in lower for x in ("outlook", "office365", "hotmail", "live.com")):
        return "Outlook/Hotmail/M365 parol bilan ishlamaydi (OAuth2 kerak) — bu stage'da qo'llab-quvvatlanmaydi."
    if "yandex" in lower or "mail.ru" in lower:
        return base + " IMAP yoqilganini va (kerak bo'lsa) ilova paroli ishlatilganini tekshiring."
    return base
