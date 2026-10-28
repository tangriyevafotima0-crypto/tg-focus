"""Parolni DB'da shifrlab saqlash.

X-8 (Stage 8): avval o'zi yozilgan stdlib-only sxema (HMAC-SHA256 oqim
kaliti + XOR, pastda "eski format" sifatida saqlab qolingan) ishlatilardi.
Endi `cryptography` kutubxonasidagi `Fernet` (AES-128-CBC + HMAC-SHA256,
tasdiqlangan, vaqt belgili) ishlatiladi — sinalgan, tekshirilgan
kutubxona, o'zi yozilgan primitivlardan ko'ra ishonchliroq.

MIGRATSIYA: eski formatda shifrlangan parollar (DB'da allaqachon saqlangan
`password_enc` qiymatlari) yangi kod bilan ishlay olmay qoladi, chunki
format butunlay boshqa (eski: base64(nonce(16)||cipher||tag(16));
yangi: Fernet token, odatda "gAAAAA..." bilan boshlanadi va o'zida versiya
bayti + vaqt belgisi + IV + HMAC bor).

`decrypt_password()` avval yangi (Fernet) format deb urinib ko'radi;
agar bu muvaffaqiyatsiz bo'lsa, eski formatga **fallback** qiladi (pastdagi
`_legacy_decrypt`) — shu bilan eski qatorlar ham o'qiladi, yangi kodga
o'tish uchun DB migratsiyasi SHART emas. Biroq `encrypt_password()` endi
FAQAT yangi (Fernet) formatda yozadi — shuning uchun amalda "qayta
saqlashda avtomatik migratsiya" yuz beradi: har safar parol
yangilansa/qayta kiritilsa (`routers/email.py` POST/PUT), u endi Fernet
bilan shifrlanadi. Eski qatorlarni majburiy ko'chirish uchun oddiy skript:
har bir EmailAccount'ni o'qib, `decrypt_password` (fallback orqali eski
formatni ochadi) + `encrypt_password` (yangi format bilan qayta yozadi)
qilib saqlash kifoya.
"""
import base64
import hashlib
import hmac
import os
import secrets
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

BACKEND_DIR = Path(__file__).resolve().parents[1]
KEY_FILE = BACKEND_DIR / "data" / ".email_key"

_key_cache: bytes | None = None
_fernet_cache: Fernet | None = None


def _load_raw_key() -> bytes:
    """Xom kalit manbasi (EMAIL_SECRET_KEY yoki fayl) — SHA-256 hash
    OLINMAGAN, Fernet o'ziga xos kalit formatini talab qiladi."""
    global _key_cache
    if _key_cache is not None:
        return _key_cache
    env_key = os.getenv("EMAIL_SECRET_KEY", "").strip()
    if env_key:
        raw = env_key
    elif KEY_FILE.is_file():
        raw = KEY_FILE.read_text(encoding="utf-8").strip()
    else:
        raw = secrets.token_urlsafe(32)
        KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(KEY_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(raw)
    _key_cache = raw.encode("utf-8")
    return _key_cache


def _fernet() -> Fernet:
    global _fernet_cache
    if _fernet_cache is not None:
        return _fernet_cache
    raw = _load_raw_key()
    # Fernet kaliti 32 bayt, urlsafe-base64 bo'lishi shart. Foydalanuvchi
    # kiritgan (yoki avtomatik generatsiya qilingan) xom matn har qanday
    # uzunlikda bo'lishi mumkin, shuning uchun SHA-256 bilan aniq 32 baytga
    # keltirib, keyin urlsafe-base64 qilamiz (Fernet.generate_key() ham
    # aynan shu formatni qaytaradi).
    digest = hashlib.sha256(raw).digest()
    fernet_key = base64.urlsafe_b64encode(digest)
    _fernet_cache = Fernet(fernet_key)
    return _fernet_cache


def _reset_key_cache() -> None:  # testlar uchun
    global _key_cache, _fernet_cache
    _key_cache = None
    _fernet_cache = None


# ─────────────────────────────────────────────────────────────────────
# ESKI FORMAT (faqat o'qish uchun — migratsiya fallback, pastga qarang)
# ─────────────────────────────────────────────────────────────────────

def _legacy_key() -> bytes:
    return hashlib.sha256(_load_raw_key()).digest()


def _legacy_keystream(key: bytes, nonce: bytes, length: int) -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < length:
        out += hmac.new(key, nonce + counter.to_bytes(8, "big"), hashlib.sha256).digest()
        counter += 1
    return bytes(out[:length])


def _legacy_decrypt(token: str) -> str:
    key = _legacy_key()
    try:
        raw = base64.b64decode(token.encode("ascii"), validate=True)
    except Exception as exc:
        raise ValueError("Shifrlangan parol formati noto'g'ri.") from exc
    if len(raw) < 32:
        raise ValueError("Shifrlangan parol formati noto'g'ri.")
    nonce, cipher, tag = raw[:16], raw[16:-16], raw[-16:]
    expected = hmac.new(key, b"tag" + nonce + cipher, hashlib.sha256).digest()[:16]
    if not hmac.compare_digest(tag, expected):
        raise ValueError("Parolni deshifrlab bo'lmadi (kalit o'zgargan yoki ma'lumot buzilgan).")
    stream = _legacy_keystream(key, nonce, len(cipher))
    return bytes(a ^ b for a, b in zip(cipher, stream)).decode("utf-8")


# ─────────────────────────────────────────────────────────────────────
# YANGI FORMAT (Fernet)
# ─────────────────────────────────────────────────────────────────────

def encrypt_password(plain: str) -> str:
    token = _fernet().encrypt(plain.encode("utf-8"))
    return token.decode("ascii")


def decrypt_password(token: str) -> str:
    try:
        plain = _fernet().decrypt(token.encode("ascii"))
        return plain.decode("utf-8")
    except (InvalidToken, ValueError, UnicodeDecodeError):
        pass
    except Exception as exc:  # noqa: BLE001 - keng tutish, pastda fallback bor
        raise ValueError("Shifrlangan parol formati noto'g'ri.") from exc
    # Fernet sifatida ochib bo'lmadi — eski (migratsiyadan oldingi) format
    # bo'lishi mumkin. Fallback sifatida eski sxema bilan sinab ko'ramiz.
    return _legacy_decrypt(token)
