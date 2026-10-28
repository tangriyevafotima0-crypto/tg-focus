"""auth.py sinovi — to'g'ri va noto'g'ri parol bilan login.

Haqiqiy server yoki tarmoq kerak emas: FastAPI TestClient orqali faqat
auth_router ustida ishlaydi (asosiy `app`dagi lifespan/Telethon ishga
tushirilmaydi). APP_PASSWORD test uchun oldindan o'rnatiladi.
"""
import os
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)

os.environ.setdefault("APP_PASSWORD", "test-parol-12345")
os.environ.setdefault("COOKIE_SECURE", "false")

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import router as auth_router, require_auth
from app.rate_limit import limiter
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler

APP_PASSWORD = os.environ["APP_PASSWORD"]

app = FastAPI()
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.include_router(auth_router)


@app.get("/api/_protected")
async def _protected(_: None = None):
    return {"ok": True}


# require_auth ni alohida himoyalangan endpoint uchun qo'lda ulaymiz,
# chunki asosiy ilovada routerlar shunday ulanadi (Depends(require_auth)).
from fastapi import Depends


@app.get("/api/_protected2")
async def _protected2(_auth: None = Depends(require_auth)):
    return {"ok": True}


client = TestClient(app)


def test_login_correct_password_sets_cookie_and_allows_access():
    resp = client.post("/api/auth/login", json={"password": APP_PASSWORD})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "ok"
    assert "focus_session" in resp.cookies

    # To'g'ri cookie bilan himoyalangan endpointga kirish mumkin bo'lishi kerak.
    protected = client.get("/api/_protected2")
    assert protected.status_code == 200
    assert protected.json() == {"ok": True}


def test_login_wrong_password_returns_401():
    fresh_client = TestClient(app)
    resp = fresh_client.post("/api/auth/login", json={"password": "notogri-parol"})
    assert resp.status_code == 401
    assert "focus_session" not in resp.cookies


def test_protected_endpoint_without_cookie_returns_401():
    fresh_client = TestClient(app)
    resp = fresh_client.get("/api/_protected2")
    assert resp.status_code == 401


def test_logout_clears_cookie_and_blocks_access():
    fresh_client = TestClient(app)
    login_resp = fresh_client.post("/api/auth/login", json={"password": APP_PASSWORD})
    assert login_resp.status_code == 200
    assert fresh_client.get("/api/_protected2").status_code == 200

    fresh_client.post("/api/auth/logout")
    resp = fresh_client.get("/api/_protected2")
    assert resp.status_code == 401


def _run_all():
    tests = [
        test_login_correct_password_sets_cookie_and_allows_access,
        test_login_wrong_password_returns_401,
        test_protected_endpoint_without_cookie_returns_401,
        test_logout_clears_cookie_and_blocks_access,
    ]
    failures = 0
    for t in tests:
        try:
            t()
            print(f"OK   {t.__name__}")
        except AssertionError as exc:
            failures += 1
            print(f"FAIL {t.__name__}: {exc}")
    if failures:
        print(f"\n{failures} ta test muvaffaqiyatsiz.")
        sys.exit(1)
    print(f"\nHammasi o'tdi ({len(tests)} ta test).")


if __name__ == "__main__":
    _run_all()
