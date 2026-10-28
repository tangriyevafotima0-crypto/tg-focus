import os
import logging
from pathlib import Path
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import declarative_base
from sqlalchemy import event, text
from sqlalchemy.engine import Engine

logger = logging.getLogger("telegram_focus.database")

BACKEND_DIR = Path(__file__).resolve().parents[1]
DB_DIR = str(BACKEND_DIR / "data")
os.makedirs(DB_DIR, exist_ok=True)
DATABASE_URL = os.getenv("DATABASE_URL") or f"sqlite+aiosqlite:///{DB_DIR}/focus.db"

@event.listens_for(Engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=60000")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"timeout": 60.0}
)

async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)

async_session_factory = async_session_maker
AsyncSessionLocal = async_session_maker
Base = declarative_base()

# Ustunlar/jadvallar shu ro'yxatga qo'shiladi: (jadval, ustun, DDL turi).
# Idempotent: har bir ustun PRAGMA table_info orqali tekshiriladi, mavjud
# bo'lsa o'tkazib yuboriladi — hech qanday mavjud ma'lumot yo'qolmaydi.
_COLUMN_MIGRATIONS: list[tuple[str, str, str]] = [
    ("messages", "media_analysis_json", "TEXT"),
    ("messages", "triage_level", "INTEGER"),
    ("messages", "triage_reason", "TEXT"),
    ("messages", "triage_auto_reply", "TEXT"),
    ("messages", "triage_dashboard_json", "TEXT"),
    ("messages", "is_starred", "INTEGER NOT NULL DEFAULT 0"),
    ("opp_channels", "is_active", "INTEGER NOT NULL DEFAULT 1"),
]


async def run_migrations() -> None:
    """Barcha jadvallarni (agar yo'q bo'lsa) yaratadi, so'ng idempotent
    ALTER TABLE ADD COLUMN orqali yetishmayotgan ustunlarni qo'shadi.

    Xavfsiz: mavjud ma'lumotlarga tegmaydi, faqat yo'q narsani qo'shadi.
    """
    from . import models  # noqa: F401  (Base.metadata to'ldirilishi uchun import)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        for table, column, ddl_type in _COLUMN_MIGRATIONS:
            result = await conn.execute(text(f"PRAGMA table_info({table})"))
            existing_columns = {row[1] for row in result.fetchall()}
            if column not in existing_columns:
                await conn.execute(
                    text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}")
                )
                logger.info("[Migratsiya] %s.%s ustuni qo'shildi.", table, column)


async def init_db():
    await run_migrations()
    logger.info("[Database] Bazaga ulanish tekshirildi.")

async def close_db():
    await engine.dispose()
    logger.info("[Database] Bazaga ulanish yopildi.")

async def get_session() -> AsyncSession:
    async with async_session_maker() as session:
        yield session

get_db = get_session
