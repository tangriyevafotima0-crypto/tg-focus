"""Oddiy parol-asosli autentifikatsiya.

APP_PASSWORD muhit o'zgaruvchisi bilan solishtiriladigan yagona parol.
Muvaffaqiyatli login'da itsdangerous bilan imzolangan HttpOnly cookie
qo'yiladi (24 soat amal qiladi). require_auth dependency har bir himoyalangan
endpoint uchun shu cookie'ni tekshiradi.
"""

from __future__ import annotations

import hmac
import os
import time

from fastapi import APIRouter, Cookie, HTTPException, Request, Response, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel

from .rate_limit import limiter

COOKIE_NAME = "focus_session"
COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60  # 24 soat


def _get_secret_key() -> str:
    # X-12 (Stage 8): avval APP_PASSWORD'ning o'zi imzolash kaliti sifatida
    # ham ishlatilardi. Muammo: parolni almashtirsangiz, barcha mavjud
    # sessiya cookie'lari ham avtomatik bekor bo'lib qoladi (imzolash
    # kaliti o'zgargani uchun) — bu login holatini kutilmaganda yo'qotadi.
    # Endi alohida SECRET_KEY bor; agar u o'rnatilmagan bo'lsa, APP_PASSWORD
    # fallback sifatida ishlatiladi (eski deploy'lar bilan moslik uchun —
    # lekin bu holatda parolni almashtirish hamon sessiyalarni bekor qiladi,
    # shuning uchun production'da SECRET_KEY alohida o'rnatish tavsiya
    # etiladi).
    secret = os.getenv("SECRET_KEY") or os.getenv("APP_PASSWORD")
    if not secret:
        raise RuntimeError(
            "SECRET_KEY (yoki kamida APP_PASSWORD) muhit o'zgaruvchisi "
            "o'rnatilmagan. backend/.env faylida SECRET_KEY=... ko'rsating."
        )
    return secret


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(_get_secret_key(), salt="focus-auth")


def _create_session_token() -> str:
    return _serializer().dumps({"authenticated": True, "issued_at": int(time.time())})


def _verify_session_token(token: str) -> bool:
    try:
        data = _serializer().loads(token, max_age=COOKIE_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        return False
    return bool(data.get("authenticated"))


router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    password: str


class LoginResponse(BaseModel):
    status: str = "ok"


@router.post("/login", response_model=LoginResponse)
@limiter.limit("5/minute")
async def login(request: Request, payload: LoginRequest, response: Response) -> LoginResponse:
    expected = os.getenv("APP_PASSWORD")
    # X-12 (Stage 8): oddiy `!=` o'rniga `hmac.compare_digest` — belgi-ma-belgi
    # taqqoslash parol uzunligi/mos qismiga qarab javob vaqti farqlanishiga
    # (timing attack) yo'l qo'yadi. compare_digest doimiy vaqtda ishlaydi.
    # `expected` bo'lmasa ham compare_digest baribir bo'sh satrga nisbatan
    # chaqiriladi, shuning uchun "parol sozlanmagan" holati alohida vaqt
    # profiliga ega bo'lib qolmaydi.
    if not expected or not hmac.compare_digest(payload.password, expected or ""):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Noto'g'ri parol")

    token = _create_session_token()
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=COOKIE_MAX_AGE_SECONDS,
        httponly=True,
        samesite="lax",
        secure=os.getenv("COOKIE_SECURE", "false").lower() == "true",
        path="/",
    )
    return LoginResponse()


@router.post("/logout", response_model=LoginResponse)
async def logout(response: Response) -> LoginResponse:
    response.delete_cookie(COOKIE_NAME, path="/")
    return LoginResponse()


async def require_auth(focus_session: str | None = Cookie(default=None)) -> None:
    """Himoyalangan endpointlar uchun dependency: cookie yo'q yoki yaroqsiz
    bo'lsa 401 qaytaradi. Faqat Cookie() orqali ishlaydi (Request talab
    qilmaydi), shuning uchun HTTP va WebSocket route'larining ikkalasida
    ham to'g'ri ishlaydi (FastAPI WebSocket handshake'da ham cookie'larni
    Cookie() parametriga uzatadi)."""
    if not focus_session or not _verify_session_token(focus_session):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Autentifikatsiya talab qilinadi")
