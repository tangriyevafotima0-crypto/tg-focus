"""Oddiy parol-asosli autentifikatsiya.

APP_PASSWORD muhit o'zgaruvchisi bilan solishtiriladigan yagona parol.
Muvaffaqiyatli login'da itsdangerous bilan imzolangan HttpOnly cookie
qo'yiladi (24 soat amal qiladi). require_auth dependency har bir himoyalangan
endpoint uchun shu cookie'ni tekshiradi.
"""

from __future__ import annotations

import os
import time

from fastapi import APIRouter, Cookie, HTTPException, Request, Response, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel

from .rate_limit import limiter

COOKIE_NAME = "focus_session"
COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60  # 24 soat


def _get_secret_key() -> str:
    # APP_PASSWORD'ning o'zi imzolash kaliti sifatida ham ishlatiladi —
    # alohida SECRET_KEY talab qilinmasin (deploy soddaligi uchun).
    secret = os.getenv("APP_PASSWORD")
    if not secret:
        raise RuntimeError(
            "APP_PASSWORD muhit o'zgaruvchisi o'rnatilmagan. "
            "backend/.env faylida APP_PASSWORD=... ko'rsating."
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
    if not expected or payload.password != expected:
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


async def require_auth(request: Request, focus_session: str | None = Cookie(default=None)) -> None:
    """Himoyalangan endpointlar uchun dependency: cookie yo'q yoki yaroqsiz
    bo'lsa 401 qaytaradi."""
    token = focus_session or request.cookies.get(COOKIE_NAME)
    if not token or not _verify_session_token(token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Autentifikatsiya talab qilinadi")
