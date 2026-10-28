import base64
import csv
import io
import json
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..media import MAX_UPLOAD_MB, MEDIA_DIR, is_allowed_mime, safe_tmp_media_path
from ..models import Message, Source
from ..schemas import MessageCountsOut, MessageOut
from ..sender import send_reply
from ..settings_store import (
    DEFAULT_ARCHIVE_SETTINGS,
    read_archive_settings,
    read_auto_responder_settings,
    write_archive_settings,
    write_auto_responder_settings,
)
from ..opportunity.auto_responder import AutoResponderResult, send_executive_reply


router = APIRouter(tags=["messages"])


class MessageConnectionManager:
    def __init__(self) -> None:
        self.connections: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.connections.add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self.connections.discard(websocket)

    async def broadcast(self, payload: dict[str, Any]) -> None:
        disconnected: list[WebSocket] = []
        for websocket in tuple(self.connections):
            try:
                await websocket.send_json(payload)
            except Exception:
                disconnected.append(websocket)
        for websocket in disconnected:
            self.disconnect(websocket)


message_manager = MessageConnectionManager()


def to_message_out(message: Message) -> MessageOut:
    link_urls = None
    if message.link_urls:
        try:
            link_urls = json.loads(message.link_urls)
        except (TypeError, ValueError):
            link_urls = None
    src = message.source
    src_type = None
    if src is not None and getattr(src, "type", None) is not None:
        src_type = src.type.value if hasattr(src.type, "value") else str(src.type)
    return MessageOut(
        id=message.id,
        source_id=message.source_id,
        source_display_name=(src.display_name if src else "Noma'lum"),
        source_identifier=(src.identifier if src else None),
        source_type=src_type,
        source_is_active=(src.is_active if src is not None else True),
        sender_name=message.sender_name,
        text=message.text,
        media_type=message.media_type,
        media_path=message.media_path,
        telegram_message_id=message.telegram_message_id,
        received_at=message.received_at,
        is_read=message.is_read,
        is_archived=message.is_archived,
        archived_at=message.archived_at,
        is_starred=bool(getattr(message, "is_starred", False)),
        reply_to_message_id=message.reply_to_message_id,
        chat_id=message.chat_id,
        direction=message.direction,
        has_media_file=message.has_media_file,
        media_mime=message.media_mime,
        media_name=message.media_name,
        link_urls=link_urls,
        channel=message.channel,
        opp_score=message.opp_score,
        triage_level=message.triage_level,
        triage_reason=message.triage_reason,
        triage_auto_reply=message.triage_auto_reply,
        triage_dashboard=message.triage_dashboard_json,
        media_analysis=message.media_analysis_json,
    )


@router.get("/api/messages", response_model=list[MessageOut])
async def list_messages(
    source_id: Optional[int] = None,
    limit: int = 100,
    offset: int = 0,
    archived: Optional[bool] = False,
    channel: Optional[str] = None,
    unread_only: bool = False,
    starred_only: bool = False,
    has_media: bool = False,
    has_links: bool = False,
    include_inactive_sources: bool = False,
    sort: str = "desc",
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
) -> list[MessageOut]:
    limit = min(max(limit, 1), 500)
    offset = max(offset, 0)
    order_clauses = (
        (Message.received_at.asc(), Message.id.asc())
        if sort == "asc"
        else (Message.received_at.desc(), Message.id.desc())
    )
    query = (
        select(Message)
        .options(selectinload(Message.source))
        .order_by(*order_clauses)
        .limit(limit)
        .offset(offset)
    )

    is_dm_unmonitored_source = False
    if source_id is not None:
        query = query.where(Message.source_id == source_id)
        src_obj = await db.get(Source, source_id)
        if src_obj and src_obj.identifier == "dm_unmonitored":
            is_dm_unmonitored_source = True
    elif channel == "telegram" and not include_inactive_sources and not archived and not starred_only:
        # Bug #1: Umumiy kiruvchi oqimda foydalanuvchi o'chirib qo'ygan (is_active=False)
        # manbalarning xabarlari ko'rinmasin.
        query = query.join(Source, Message.source_id == Source.id).where(Source.is_active.is_(True))

    if starred_only:
        query = query.where(Message.is_starred.is_(True))
    elif is_dm_unmonitored_source and archived is False:
        # dm_unmonitored xabarlari telethon_client da is_archived=True bo'lib saqlangani uchun,
        # foydalanuvchi chap paneldan "Unmonitored DMs" manbasini tanlaganda ular ko'rinishi shart.
        pass
    elif archived is not None:
        query = query.where(Message.is_archived == archived)

    if channel is not None:
        query = query.where(Message.channel == channel)
    if unread_only:
        query = query.where(Message.is_read.is_(False))
    if has_media:
        query = query.where(or_(Message.has_media_file.is_(True), Message.media_type.is_not(None)))
    if has_links:
        query = query.where(Message.link_urls.is_not(None), Message.link_urls != "[]")
    if search:
        term = search.strip()[:120]
        if term:
            like = f"%{term}%"
            query = query.where(or_(Message.text.like(like), Message.sender_name.like(like)))
    result = await db.execute(query)
    return [to_message_out(item) for item in result.scalars().all()]


@router.get("/api/messages/counts", response_model=MessageCountsOut)
async def message_counts(db: AsyncSession = Depends(get_db)) -> MessageCountsOut:
    async def _count(*conditions) -> int:
        query = select(func.count()).select_from(Message).where(*conditions)
        result = await db.execute(query)
        return int(result.scalar_one())

    # Telegram unread faqat faol manbalardan hisoblanadi
    tg_unread_q = (
        select(func.count())
        .select_from(Message)
        .join(Source, Message.source_id == Source.id)
        .where(
            Message.channel == "telegram",
            Message.is_read.is_(False),
            Message.is_archived.is_(False),
            Source.is_active.is_(True),
        )
    )
    telegram_unread = int((await db.execute(tg_unread_q)).scalar_one())

    tg_total_q = (
        select(func.count())
        .select_from(Message)
        .join(Source, Message.source_id == Source.id)
        .where(
            Message.channel == "telegram",
            Message.is_archived.is_(False),
            Source.is_active.is_(True),
        )
    )
    telegram_total = int((await db.execute(tg_total_q)).scalar_one())

    email_unread = await _count(
        Message.channel == "email",
        Message.is_read.is_(False),
        Message.is_archived.is_(False),
    )
    email_total = await _count(
        Message.channel == "email",
        Message.is_archived.is_(False),
    )
    opportunity_unread = await _count(
        Message.channel == "opportunity",
        Message.is_read.is_(False),
        Message.is_archived.is_(False),
    )
    archived_count = await _count(Message.is_archived.is_(True))
    starred_count = await _count(Message.is_starred.is_(True))

    return MessageCountsOut(
        telegram_unread=telegram_unread,
        email_unread=email_unread,
        archived=archived_count,
        opportunity_unread=opportunity_unread,
        starred=starred_count,
        telegram_total=telegram_total,
        email_total=email_total,
    )


@router.get("/api/notifications", response_model=list[MessageOut])
async def list_notifications(
    limit: int = 100,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
) -> list[MessageOut]:
    """Stage 2: Notification Center — Daraja 2 va Daraja 3 xabarlar (arxivlanmagan)."""
    limit = min(max(limit, 1), 250)
    offset = max(offset, 0)
    query = (
        select(Message)
        .options(selectinload(Message.source))
        .where(Message.triage_level.in_([2, 3]))
        .where(Message.is_archived.is_(False))
        .order_by(Message.triage_level.desc(), Message.received_at.desc(), Message.id.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(query)
    return [to_message_out(item) for item in result.scalars().all()]


@router.get("/api/media/{message_id}")
async def get_media(message_id: int, db: AsyncSession = Depends(get_db)) -> FileResponse:
    message = await db.get(Message, message_id)
    if message is None or not message.has_media_file or not message.media_name:
        raise HTTPException(status_code=404, detail="Media topilmadi.")

    file_path = (MEDIA_DIR / message.media_name).resolve()
    if MEDIA_DIR.resolve() not in file_path.parents or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Media topilmadi.")

    return FileResponse(
        path=file_path,
        media_type=message.media_mime or "application/octet-stream",
        filename=message.media_name,
    )


class ReplyFileIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    mime: str = Field(min_length=1, max_length=100)
    data_b64: str


class ReplyIn(BaseModel):
    text: Optional[str] = None
    files: Optional[list[ReplyFileIn]] = None
    as_document: bool = False


@router.post("/api/messages/{message_id}/reply", response_model=MessageOut)
async def reply_to_message(
    message_id: int,
    payload: ReplyIn,
    db: AsyncSession = Depends(get_db),
) -> MessageOut:
    text = (payload.text or "").strip()
    files = payload.files or []
    if not text and not files:
        raise HTTPException(status_code=422, detail="Matn yoki fayl kerak.")

    original = await db.get(Message, message_id)
    if original is None:
        raise HTTPException(status_code=404, detail="Xabar topilmadi.")
    if original.channel != "telegram":
        raise HTTPException(status_code=422, detail="Bu kanal uchun javob yuborish qo'llab-quvvatlanmaydi.")

    max_bytes = MAX_UPLOAD_MB * 1024 * 1024
    tmp_dir = MEDIA_DIR / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    saved_paths: list[str] = []

    try:
        for item in files:
            if not is_allowed_mime(item.mime):
                raise HTTPException(status_code=415, detail=f"Ruxsat etilmagan fayl turi: {item.mime}")
            try:
                raw = base64.b64decode(item.data_b64, validate=True)
            except Exception as exc:
                raise HTTPException(status_code=422, detail="Fayl ma'lumoti noto‘g‘ri (base64).") from exc
            if len(raw) > max_bytes:
                raise HTTPException(
                    status_code=413,
                    detail=f"Fayl {MAX_UPLOAD_MB}MB dan katta bo‘lishi mumkin emas.",
                )
            tmp_name = f"{uuid.uuid4().hex}_{item.name}"
            tmp_path = safe_tmp_media_path(tmp_name)
            tmp_path.write_bytes(raw)
            saved_paths.append(str(tmp_path))

        record = await send_reply(
            message_db_id=message_id,
            text=text,
            file_paths=saved_paths,
            force_document=payload.as_document,
        )
        result = to_message_out(record)
        await message_manager.broadcast(result.model_dump(mode="json"))
        return result
    finally:
        for path in saved_paths:
            try:
                os.remove(path)
            except OSError:
                pass


@router.patch("/api/messages/{message_id}/read", response_model=MessageOut)
async def mark_message_read(
    message_id: int,
    archive: bool = False,
    db: AsyncSession = Depends(get_db),
) -> MessageOut:
    """Xabarni FAQAT sayt bazasida 'o'qildi' deb belgilaydi."""
    query = (
        select(Message)
        .options(selectinload(Message.source))
        .where(Message.id == message_id)
    )
    result = await db.execute(query)
    message = result.scalar_one_or_none()
    if message is None:
        raise HTTPException(status_code=404, detail="Xabar topilmadi.")
    message.is_read = True
    if archive and not message.is_archived:
        message.is_archived = True
        message.archived_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(message)
    return to_message_out(message)


class StarIn(BaseModel):
    starred: Optional[bool] = None


@router.patch("/api/messages/{message_id}/star", response_model=MessageOut)
async def toggle_message_star(
    message_id: int,
    payload: Optional[StarIn] = None,
    db: AsyncSession = Depends(get_db),
) -> MessageOut:
    query = (
        select(Message)
        .options(selectinload(Message.source))
        .where(Message.id == message_id)
    )
    result = await db.execute(query)
    message = result.scalar_one_or_none()
    if message is None:
        raise HTTPException(status_code=404, detail="Xabar topilmadi.")
    if payload is not None and payload.starred is not None:
        message.is_starred = bool(payload.starred)
    else:
        message.is_starred = not bool(message.is_starred)
    await db.commit()
    await db.refresh(message)
    return to_message_out(message)


@router.patch("/api/messages/{message_id}/archive", response_model=MessageOut)
async def archive_message(
    message_id: int,
    db: AsyncSession = Depends(get_db),
) -> MessageOut:
    query = (
        select(Message)
        .options(selectinload(Message.source))
        .where(Message.id == message_id)
    )
    result = await db.execute(query)
    message = result.scalar_one_or_none()
    if message is None:
        raise HTTPException(status_code=404, detail="Xabar topilmadi.")
    if not message.is_archived:
        message.is_archived = True
        message.archived_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(message)
    return to_message_out(message)


@router.patch("/api/messages/{message_id}/unarchive", response_model=MessageOut)
async def unarchive_message(
    message_id: int,
    db: AsyncSession = Depends(get_db),
) -> MessageOut:
    query = (
        select(Message)
        .options(selectinload(Message.source))
        .where(Message.id == message_id)
    )
    result = await db.execute(query)
    message = result.scalar_one_or_none()
    if message is None:
        raise HTTPException(status_code=404, detail="Xabar topilmadi.")
    if message.is_archived:
        message.is_archived = False
        message.archived_at = None
        await db.commit()
        await db.refresh(message)
    return to_message_out(message)


class BulkFilterIn(BaseModel):
    ids: Optional[list[int]] = None
    source_id: Optional[int] = None
    channel: Optional[str] = None
    only_read: bool = False
    archived: Optional[bool] = None
    exclude_starred: bool = False
    all_matching: bool = False


class ReadBulkOut(BaseModel):
    read: int


class ArchiveBulkOut(BaseModel):
    archived: int


class UnarchiveBulkOut(BaseModel):
    unarchived: int


class DeleteBulkOut(BaseModel):
    deleted: int


def _build_bulk_conditions(payload: BulkFilterIn, *, default_archived: Optional[bool] = None) -> Optional[list]:
    if payload.ids is not None:
        if len(payload.ids) > 10000:
            raise HTTPException(status_code=422, detail="Bir vaqtda 10000 tadan ortiq ID yubormang.")
        if not payload.ids:
            return None
        return [Message.id.in_(payload.ids)]
    elif payload.source_id is not None or payload.channel is not None or payload.all_matching:
        conds = []
        if payload.source_id is not None:
            conds.append(Message.source_id == payload.source_id)
        if payload.channel is not None:
            conds.append(Message.channel == payload.channel)
        arch_val = payload.archived if payload.archived is not None else default_archived
        if arch_val is not None:
            conds.append(Message.is_archived.is_(arch_val))
        if payload.only_read:
            conds.append(Message.is_read.is_(True))
        if payload.exclude_starred:
            conds.append(Message.is_starred.is_(False))
        return conds
    else:
        raise HTTPException(status_code=422, detail="ids, source_id yoki channel kerak.")


@router.post("/api/messages/read-bulk", response_model=ReadBulkOut)
async def read_bulk(
    payload: BulkFilterIn,
    db: AsyncSession = Depends(get_db),
) -> ReadBulkOut:
    """Tezkor SQL UPDATE orqali xabarlarni saytda o'qildi deb belgilash."""
    conds = _build_bulk_conditions(payload)
    if conds is None:
        return ReadBulkOut(read=0)
    conds.append(Message.is_read.is_(False))
    stmt = update(Message).where(*conds).values(is_read=True)
    result = await db.execute(stmt)
    await db.commit()
    return ReadBulkOut(read=int(result.rowcount or 0))


@router.post("/api/messages/archive-bulk", response_model=ArchiveBulkOut)
async def archive_bulk(
    payload: BulkFilterIn,
    db: AsyncSession = Depends(get_db),
) -> ArchiveBulkOut:
    conds = _build_bulk_conditions(payload, default_archived=False)
    if conds is None:
        return ArchiveBulkOut(archived=0)
    conds.append(Message.is_archived.is_(False))
    now = datetime.now(timezone.utc)
    stmt = update(Message).where(*conds).values(is_archived=True, archived_at=now)
    result = await db.execute(stmt)
    await db.commit()
    return ArchiveBulkOut(archived=int(result.rowcount or 0))


@router.post("/api/messages/unarchive-bulk", response_model=UnarchiveBulkOut)
async def unarchive_bulk(
    payload: BulkFilterIn,
    db: AsyncSession = Depends(get_db),
) -> UnarchiveBulkOut:
    conds = _build_bulk_conditions(payload, default_archived=True)
    if conds is None:
        return UnarchiveBulkOut(unarchived=0)
    conds.append(Message.is_archived.is_(True))
    stmt = update(Message).where(*conds).values(is_archived=False, archived_at=None)
    result = await db.execute(stmt)
    await db.commit()
    return UnarchiveBulkOut(unarchived=int(result.rowcount or 0))


@router.delete("/api/messages/{message_id}", status_code=204)
async def delete_message(
    message_id: int,
    db: AsyncSession = Depends(get_db),
) -> None:
    message = await db.get(Message, message_id)
    if message is None:
        raise HTTPException(status_code=404, detail="Xabar topilmadi.")
    await db.delete(message)
    await db.commit()


@router.post("/api/messages/delete-bulk", response_model=DeleteBulkOut)
async def delete_bulk(
    payload: BulkFilterIn,
    db: AsyncSession = Depends(get_db),
) -> DeleteBulkOut:
    conds = _build_bulk_conditions(payload)
    if conds is None:
        return DeleteBulkOut(deleted=0)
    stmt = delete(Message).where(*conds)
    result = await db.execute(stmt)
    await db.commit()
    return DeleteBulkOut(deleted=int(result.rowcount or 0))


class ExportBulkIn(BaseModel):
    ids: Optional[list[int]] = None
    source_id: Optional[int] = None
    channel: Optional[str] = "telegram"
    archived: Optional[bool] = None
    format: str = "csv"  # "csv" | "json" | "txt"
    then_action: str = "none"  # "none" | "archive" | "delete"


def _format_export_stream(items: list[MessageOut], fmt: str, label: str):
    today_str = date.today().isoformat()
    if fmt == "json":
        data = [item.model_dump(mode="json") for item in items]
        content = json.dumps(data, ensure_ascii=False, indent=2)
        filename = f"{label}-{today_str}.json"
        media_type = "application/json"
    elif fmt == "txt":
        lines = [f"# Telegram Focus Eksport ({label}) — {today_str}", f"# Jami xabarlar: {len(items)}", ""]
        for item in items:
            dt_str = item.received_at.isoformat() if item.received_at else ""
            lines.append("=" * 60)
            lines.append(f"[{dt_str}] Manba: {item.source_display_name} | Yuboruvchi: {item.sender_name}")
            if item.opp_score is not None:
                lines.append(f"Moslik bali: {item.opp_score}")
            lines.append("-" * 60)
            lines.append(item.text or "(Media xabar)")
            if item.link_urls:
                lines.append("Havolalar: " + ", ".join(item.link_urls))
            lines.append("")
        content = "\n".join(lines)
        filename = f"{label}-{today_str}.txt"
        media_type = "text/plain; charset=utf-8"
    else:
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow([
            "id", "channel", "source", "sender", "received_at",
            "is_read", "is_archived", "is_starred", "triage_level", "opp_score", "text", "links",
        ])
        for item in items:
            writer.writerow([
                item.id,
                item.channel,
                item.source_display_name,
                item.sender_name,
                item.received_at.isoformat() if item.received_at else "",
                item.is_read,
                item.is_archived,
                item.is_starred,
                item.triage_level if item.triage_level is not None else "",
                item.opp_score if item.opp_score is not None else "",
                item.text or "",
                ";".join(item.link_urls or []),
            ])
        content = buffer.getvalue()
        filename = f"{label}-{today_str}.csv"
        media_type = "text/csv; charset=utf-8"

    return StreamingResponse(
        iter([content]),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/api/messages/export")
async def export_messages_get(
    format: str = Query(default="csv"),
    channel: Optional[str] = Query(default=None),
    source_id: Optional[int] = Query(default=None),
    archived: Optional[bool] = Query(default=None),
    ids: Optional[str] = Query(default=None),
    then_action: str = Query(default="none"),
    db: AsyncSession = Depends(get_db),
):
    query = select(Message).options(selectinload(Message.source)).order_by(Message.received_at.desc(), Message.id.desc())
    id_list = []
    if ids:
        id_list = [int(x) for x in ids.split(",") if x.strip().isdigit()]
        if id_list:
            query = query.where(Message.id.in_(id_list))
    else:
        if source_id is not None:
            query = query.where(Message.source_id == source_id)
        if channel is not None:
            query = query.where(Message.channel == channel)
        if archived is not None:
            query = query.where(Message.is_archived.is_(archived))

    result = await db.execute(query)
    rows = list(result.scalars().all())
    items = [to_message_out(m) for m in rows]
    row_ids = [m.id for m in rows]

    if row_ids and then_action in ("archive", "delete"):
        if then_action == "archive":
            now = datetime.now(timezone.utc)
            await db.execute(
                update(Message).where(Message.id.in_(row_ids)).values(is_archived=True, archived_at=now)
            )
        elif then_action == "delete":
            await db.execute(delete(Message).where(Message.id.in_(row_ids)))
        await db.commit()

    fmt = format.lower() if format.lower() in ("csv", "json", "txt") else "csv"
    label = channel or "xabarlar"
    return _format_export_stream(items, fmt, label)


@router.post("/api/messages/export")
async def export_messages_post(
    payload: ExportBulkIn,
    db: AsyncSession = Depends(get_db),
):
    query = select(Message).options(selectinload(Message.source)).order_by(Message.received_at.desc(), Message.id.desc())
    if payload.ids:
        query = query.where(Message.id.in_(payload.ids))
    else:
        if payload.source_id is not None:
            query = query.where(Message.source_id == payload.source_id)
        if payload.channel is not None:
            query = query.where(Message.channel == payload.channel)
        if payload.archived is not None:
            query = query.where(Message.is_archived.is_(payload.archived))

    result = await db.execute(query)
    rows = list(result.scalars().all())
    items = [to_message_out(m) for m in rows]
    row_ids = [m.id for m in rows]

    if row_ids and payload.then_action in ("archive", "delete"):
        if payload.then_action == "archive":
            now = datetime.now(timezone.utc)
            await db.execute(
                update(Message).where(Message.id.in_(row_ids)).values(is_archived=True, archived_at=now)
            )
        elif payload.then_action == "delete":
            await db.execute(delete(Message).where(Message.id.in_(row_ids)))
        await db.commit()

    fmt = payload.format.lower() if payload.format.lower() in ("csv", "json", "txt") else "csv"
    label = payload.channel or "xabarlar"
    return _format_export_stream(items, fmt, label)


class ArchiveSettingsOut(BaseModel):
    archive_on_read: bool
    archive_on_reply: bool
    auto_archive_days: int


class ArchiveSettingsIn(BaseModel):
    archive_on_read: Optional[bool] = None
    archive_on_reply: Optional[bool] = None
    auto_archive_days: Optional[int] = Field(default=None, ge=0)


@router.get("/api/settings/archive", response_model=ArchiveSettingsOut)
async def get_archive_settings() -> ArchiveSettingsOut:
    return ArchiveSettingsOut(**read_archive_settings())


@router.put("/api/settings/archive", response_model=ArchiveSettingsOut)
async def put_archive_settings(payload: ArchiveSettingsIn) -> ArchiveSettingsOut:
    updates = payload.model_dump(exclude_unset=True, exclude_none=True)
    merged = write_archive_settings(updates)
    return ArchiveSettingsOut(**merged)


class AutoResponderSettingsOut(BaseModel):
    auto_reply_enabled: bool


class AutoResponderSettingsIn(BaseModel):
    auto_reply_enabled: Optional[bool] = None


@router.get("/api/settings/auto-responder", response_model=AutoResponderSettingsOut)
async def get_auto_responder_settings() -> AutoResponderSettingsOut:
    return AutoResponderSettingsOut(**read_auto_responder_settings())


@router.put("/api/settings/auto-responder", response_model=AutoResponderSettingsOut)
async def put_auto_responder_settings(payload: AutoResponderSettingsIn) -> AutoResponderSettingsOut:
    updates = payload.model_dump(exclude_unset=True, exclude_none=True)
    merged = write_auto_responder_settings(updates)
    return AutoResponderSettingsOut(**merged)


class AutoReplyActionOut(BaseModel):
    sent: bool
    reason: str


@router.post("/api/messages/{message_id}/confirm-auto-reply", response_model=AutoReplyActionOut)
async def confirm_auto_reply(message_id: int, db: AsyncSession = Depends(get_db)) -> AutoReplyActionOut:
    message = await db.get(Message, message_id)
    if message is None:
        raise HTTPException(status_code=404, detail="Xabar topilmadi.")
    if message.triage_level != 2:
        raise HTTPException(status_code=422, detail="Faqat Daraja 2 xabarlar uchun.")

    result: AutoResponderResult = await send_executive_reply(message, force=True)
    if result.reason == "error":
        raise HTTPException(status_code=502, detail="Telegram'ga yuborishda xato yuz berdi.")
    if result.reason == "no_chat":
        raise HTTPException(status_code=404, detail="Chat topilmadi.")
    return AutoReplyActionOut(sent=result.sent, reason=result.reason)


@router.post("/api/messages/{message_id}/cancel-auto-reply", response_model=AutoReplyActionOut)
async def cancel_auto_reply(message_id: int, db: AsyncSession = Depends(get_db)) -> AutoReplyActionOut:
    message = await db.get(Message, message_id)
    if message is None:
        raise HTTPException(status_code=404, detail="Xabar topilmadi.")
    if message.triage_level != 2:
        raise HTTPException(status_code=422, detail="Faqat Daraja 2 xabarlar uchun.")

    message.is_archived = True
    message.archived_at = datetime.now(timezone.utc)
    await db.commit()
    return AutoReplyActionOut(sent=False, reason="cancelled")


async def run_auto_archive_once(db: AsyncSession) -> int:
    """Archive read messages older than auto_archive_days. Returns count archived."""
    settings = read_archive_settings()
    days = settings.get("auto_archive_days", 0)
    if not days or days <= 0:
        return 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    now = datetime.now(timezone.utc)
    stmt = (
        update(Message)
        .where(
            Message.is_archived.is_(False),
            Message.is_read.is_(True),
            Message.is_starred.is_(False),
            Message.received_at < cutoff,
        )
        .values(is_archived=True, archived_at=now)
    )
    result = await db.execute(stmt)
    await db.commit()
    return int(result.rowcount or 0)


@router.websocket("/ws/messages")
async def messages_websocket(websocket: WebSocket) -> None:
    await message_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        message_manager.disconnect(websocket)
    except Exception:
        message_manager.disconnect(websocket)