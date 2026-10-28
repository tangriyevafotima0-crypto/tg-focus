"""Email hisoblari API'si. Parol HECH QACHON javobda qaytmaydi (faqat has_password)."""
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..email_client import (
    EmailAuthError,
    EmailConnectionError,
    check_login,
    humanize_auth_error,
)
from ..email_crypto import decrypt_password, encrypt_password
from ..email_worker import check_account_locked
from ..models import EmailAccount, Message, Source
from .messages import message_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/email", tags=["email"])

OUTLOOK_HOSTS = ("outlook.", "office365.", "hotmail.", "live.com")

PRESETS = [
    {
        "id": "gmail", "name": "Gmail", "imap_host": "imap.gmail.com", "imap_port": 993,
        "note": "Oddiy parol ishlamaydi. Google hisobida 2 bosqichli tasdiqni yoqing, so'ng "
                "myaccount.google.com/apppasswords sahifasida App Password (16 belgi) yarating va shuni kiriting.",
    },
    {
        "id": "yandex", "name": "Yandex", "imap_host": "imap.yandex.com", "imap_port": 993,
        "note": "Yandex pochta sozlamalarida IMAP'ni yoqing. Kerak bo'lsa ilova paroli yarating.",
    },
    {
        "id": "mailru", "name": "Mail.ru", "imap_host": "imap.mail.ru", "imap_port": 993,
        "note": "Mail.ru sozlamalarida 'Tashqi ilovalar uchun parol' yarating va shuni kiriting.",
    },
    {
        "id": "icloud", "name": "iCloud", "imap_host": "imap.mail.me.com", "imap_port": 993,
        "note": "appleid.apple.com da ilovaga xos parol (App-Specific Password) yarating. "
                "Login — to'liq iCloud manzili.",
    },
    {
        "id": "yahoo", "name": "Yahoo", "imap_host": "imap.mail.yahoo.com", "imap_port": 993,
        "note": "Yahoo hisob xavfsizligi sahifasida App Password yarating.",
    },
]


class EmailAccountCreate(BaseModel):
    label: str = Field(min_length=1, max_length=255)
    imap_host: str = Field(min_length=1, max_length=255)
    imap_port: int = Field(default=993, ge=1, le=65535)
    username: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=512)
    folder: str = Field(default="INBOX", min_length=1, max_length=255)

    @field_validator("label", "imap_host", "username", "folder")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Maydon bo'sh bo'lishi mumkin emas.")
        return value


class EmailAccountUpdate(BaseModel):
    is_active: Optional[bool] = None
    label: Optional[str] = Field(default=None, min_length=1, max_length=255)
    password: Optional[str] = Field(default=None, min_length=1, max_length=512)


class EmailAccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    imap_host: str
    imap_port: int
    username: str
    folder: str
    is_active: bool
    last_error: Optional[str] = None
    created_at: datetime
    has_password: bool = True  # parol qaytarilmaydi
    source_id: Optional[int] = None
    unread_count: int = 0
    total_count: int = 0


class CheckNowOut(BaseModel):
    new: int
    last_error: Optional[str] = None


async def _enrich_accounts(db: AsyncSession, accounts: list[EmailAccount]) -> list[EmailAccountOut]:
    if not accounts:
        return []
    identifiers = [f"email:{a.id}" for a in accounts]
    src_res = await db.execute(
        select(Source).where(Source.kind == "email", Source.identifier.in_(identifiers))
    )
    src_by_ident = {s.identifier: s for s in src_res.scalars().all()}

    stats_res = await db.execute(
        select(
            Message.chat_id,
            func.sum(
                case(
                    (Message.is_archived.is_(False) & Message.is_read.is_(False), 1),
                    else_=0,
                )
            ).label("unread_count"),
            func.sum(
                case(
                    (Message.is_archived.is_(False), 1),
                    else_=0,
                )
            ).label("total_count"),
        )
        .where(Message.channel == "email", Message.chat_id.in_([a.id for a in accounts]))
        .group_by(Message.chat_id)
    )
    stats_by_acc = {row.chat_id: row for row in stats_res.all()}

    out: list[EmailAccountOut] = []
    for account in accounts:
        src = src_by_ident.get(f"email:{account.id}")
        st = stats_by_acc.get(account.id)
        out.append(
            EmailAccountOut(
                id=account.id,
                label=account.label,
                imap_host=account.imap_host,
                imap_port=account.imap_port,
                username=account.username,
                folder=account.folder,
                is_active=account.is_active,
                last_error=account.last_error,
                created_at=account.created_at,
                has_password=bool(account.password_enc),
                source_id=src.id if src else None,
                unread_count=int(st.unread_count or 0) if st else 0,
                total_count=int(st.total_count or 0) if st else 0,
            )
        )
    return out


def _is_outlook(host: str) -> bool:
    lower = host.lower()
    return any(marker in lower for marker in OUTLOOK_HOSTS)


async def _verify_login(host: str, port: int, username: str, password: str, folder: str) -> None:
    if _is_outlook(host):
        raise HTTPException(
            status_code=400,
            detail="Outlook/Hotmail/M365 parol bilan ishlamaydi (OAuth2 kerak) — hozircha qo'llab-quvvatlanmaydi.",
        )
    try:
        await check_login(host, port, username, password, folder)
    except EmailAuthError as exc:
        raise HTTPException(status_code=400, detail=humanize_auth_error(host, str(exc))) from exc
    except EmailConnectionError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Serverga ulanib bo'lmadi yoki papka topilmadi: {str(exc)[:200]}",
        ) from exc


@router.get("/presets")
async def list_presets() -> list[dict]:
    return PRESETS


@router.post("/accounts", response_model=EmailAccountOut, status_code=status.HTTP_201_CREATED)
async def create_account(
    payload: EmailAccountCreate,
    db: AsyncSession = Depends(get_db),
) -> EmailAccountOut:
    await _verify_login(payload.imap_host, payload.imap_port, payload.username, payload.password, payload.folder)
    account = EmailAccount(
        label=payload.label,
        imap_host=payload.imap_host,
        imap_port=payload.imap_port,
        username=payload.username,
        password_enc=encrypt_password(payload.password),
        folder=payload.folder,
        is_active=True,
        last_uid=0,
        uid_validity=None,
    )
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return (await _enrich_accounts(db, [account]))[0]


@router.get("/accounts", response_model=list[EmailAccountOut])
async def list_accounts(db: AsyncSession = Depends(get_db)) -> list[EmailAccountOut]:
    result = await db.execute(select(EmailAccount).order_by(EmailAccount.id))
    return await _enrich_accounts(db, list(result.scalars().all()))


@router.patch("/accounts/{account_id}", response_model=EmailAccountOut)
async def update_account(
    account_id: int,
    payload: EmailAccountUpdate,
    db: AsyncSession = Depends(get_db),
) -> EmailAccountOut:
    account = await db.get(EmailAccount, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Email hisobi topilmadi.")
    updates = payload.model_dump(exclude_unset=True)
    source = (
        await db.execute(select(Source).where(Source.identifier == f"email:{account.id}", Source.kind == "email"))
    ).scalar_one_or_none()
    if "label" in updates and updates["label"] is not None:
        label = updates["label"].strip()
        if not label:
            raise HTTPException(status_code=422, detail="Nomi bo'sh bo'lishi mumkin emas.")
        account.label = label
        if source is not None:
            source.display_name = label
    if "password" in updates and updates["password"] is not None:
        await _verify_login(account.imap_host, account.imap_port, account.username, updates["password"], account.folder)
        account.password_enc = encrypt_password(updates["password"])
        account.last_error = None
    if "is_active" in updates and updates["is_active"] is not None:
        account.is_active = bool(updates["is_active"])
        if source is not None:
            source.is_active = bool(updates["is_active"])
    await db.commit()
    await db.refresh(account)
    return (await _enrich_accounts(db, [account]))[0]


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(account_id: int, db: AsyncSession = Depends(get_db)) -> None:
    account = await db.get(EmailAccount, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Email hisobi topilmadi.")
    source = (
        await db.execute(select(Source).where(Source.identifier == f"email:{account.id}", Source.kind == "email"))
    ).scalar_one_or_none()
    if source is not None:
        await db.delete(source)
    else:
        await db.execute(
            delete(Message).where(Message.channel == "email", Message.chat_id == account.id)
        )
    await db.delete(account)
    await db.commit()


@router.post("/accounts/{account_id}/check-now", response_model=CheckNowOut)
async def check_now(account_id: int, db: AsyncSession = Depends(get_db)) -> CheckNowOut:
    account = await db.get(EmailAccount, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Email hisobi topilmadi.")
    new_count = await check_account_locked(account_id, message_manager.broadcast)
    await db.refresh(account)
    return CheckNowOut(new=new_count, last_error=account.last_error)
