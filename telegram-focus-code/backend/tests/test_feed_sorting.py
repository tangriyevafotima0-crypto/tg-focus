"""GET /api/opp/feed sinovi — natijalar opp_score bo'yicha kamayish
tartibida qaytishini tekshiradi (null skorlar oxirida, teng skorlarda
received_at bo'yicha kamayish).

Alohida xotiradagi SQLite (aiosqlite) ishlatiladi, Telethon/lifespan
ishga tushirilmaydi — faqat opportunity router + get_db override.
"""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)

os.environ.setdefault("APP_PASSWORD", "test-parol-12345")
os.environ.setdefault("GEMINI_API_KEY", "fake-key-for-test")

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db
from app.models import Message, Source, SourceType
from app.routers.opportunity import router as opportunity_router

engine = create_async_engine("sqlite+aiosqlite:///:memory:", connect_args={})
TestSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def _override_get_db():
    async with TestSessionLocal() as session:
        yield session


async def _setup_db_with_messages():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    now = datetime.now(timezone.utc)
    async with TestSessionLocal() as session:
        source = Source(identifier="test-channel", display_name="Test Channel", type=SourceType.CHANNEL)
        session.add(source)
        await session.flush()

        rows = [
            # (title-ish sender_name, opp_score, minutes_ago)
            ("low-score-old", 40, 300),
            ("null-score", None, 10),
            ("high-score-new", 90, 5),
            ("high-score-old", 90, 60),  # teng skor, received_at bo'yicha high-score-new'dan keyin
            ("mid-score", 70, 30),
        ]
        for name, score, minutes_ago in rows:
            session.add(
                Message(
                    source_id=source.id,
                    sender_name=name,
                    text=f"opportunity: {name}",
                    telegram_message_id=hash(name) % 1_000_000,
                    received_at=now - timedelta(minutes=minutes_ago),
                    channel="opportunity",
                    opp_score=score,
                    is_archived=False,
                )
            )
        await session.commit()


app = FastAPI()
app.include_router(opportunity_router)
app.dependency_overrides[get_db] = _override_get_db
client = TestClient(app)


def test_feed_orders_by_score_descending_nulls_last():
    asyncio.run(_setup_db_with_messages())

    resp = client.get("/api/opp/feed")
    assert resp.status_code == 200, resp.text
    items = resp.json()

    names = [item["channel_name"] if "channel_name" in item else None for item in items]
    scores = [item["score"] for item in items]

    # Skorlar kamayish tartibida bo'lishi kerak (None'lar oxirida).
    non_null_scores = [s for s in scores if s is not None]
    assert non_null_scores == sorted(non_null_scores, reverse=True), scores

    # None (skor yo'q) yozuv ro'yxat oxirida bo'lishi kerak.
    if None in scores:
        assert scores[-1] is None, scores

    # Teng skorlar orasida "high-score-new" "high-score-old"dan oldin kelishi kerak
    # (received_at kamayish tartibi — yangisi birinchi).
    high_score_indices = [i for i, s in enumerate(scores) if s == 90]
    assert len(high_score_indices) == 2
    assert high_score_indices[0] < high_score_indices[1]


def _run_all():
    tests = [test_feed_orders_by_score_descending_nulls_last]
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
