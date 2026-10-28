"""Imkoniyat-aniqlash motori API'si (Stage 5) + guruhga yuborish (Stage 6) + Deep Upgrade v7."""
import csv
import io
import json
import logging
import os
import tempfile
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Message
from ..opportunity import delivery, service, store
from ..opportunity.formatting import parse_formatted_meta
from ..opportunity.engine import catch_up
from ..opportunity.gemini_analyzer import call_gemini_raw
from ..opportunity.matcher import Profile, evaluate, filter_and_rank
from ..opportunity.parser import Opportunity, parse_export_file, parse_post
from ..opportunity.resolve import _load_dialog_cache
from ..telethon_client import get_client
from .messages import message_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/opp", tags=["opportunity"])

VALID_INTERESTS = ["IT", "Til", "Fan", "Biznes", "Debat", "Liderlik", "Madaniyat", "San'at"]

_MAX_IMPORT_BYTES = 2 * 1024 * 1024


def _profile_from_dict(d: dict) -> Profile:
    return Profile(
        age=d.get("age", 16),
        grade=d.get("grade"),
        ielts=d.get("ielts"),
        knows_english=d.get("knows_english", True),
        is_student=d.get("is_student", False),
        is_pupil=d.get("is_pupil", True),
        interests=d.get("interests", []),
        only_free=d.get("only_free", True),
    )


def _opp_to_dict(opp: Opportunity) -> dict:
    return {
        "title": opp.title,
        "deadline": opp.deadline.isoformat() if opp.deadline else None,
        "deadline_raw": opp.deadline_raw,
        "age_min": opp.age_min,
        "age_max": opp.age_max,
        "grade_min": opp.grade_min,
        "grade_max": opp.grade_max,
        "ielts_required": opp.ielts_required,
        "english_required": opp.english_required,
        "is_free": opp.is_free,
        "fields": opp.fields,
        "link": opp.link or None,
        "score": opp.score,
        "match_reasons": opp.match_reasons,
        "reject_reasons": opp.reject_reasons,
    }


def _get_connected_client():
    try:
        return get_client()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


# ── PROFIL ────────────────────────────────────────────

class OppProfileIn(BaseModel):
    age: int = Field(ge=5, le=100)
    grade: Optional[int] = Field(default=None, ge=1, le=11)
    ielts: Optional[float] = Field(default=None, ge=0, le=9)
    knows_english: bool = True
    is_student: bool = True
    is_pupil: bool = True
    interests: list[str] = Field(default_factory=list)
    only_free: bool = True

    @field_validator("interests")
    @classmethod
    def _validate_interests(cls, value: list[str]) -> list[str]:
        invalid = [item for item in value if item not in VALID_INTERESTS]
        if invalid:
            raise ValueError(f"Noto'g'ri qiziqish: {', '.join(invalid)}")
        return value


class OppProfileOut(BaseModel):
    age: int
    grade: Optional[int] = None
    ielts: Optional[float] = None
    knows_english: bool
    is_student: bool
    is_pupil: bool
    interests: list[str]
    only_free: bool


@router.get("/profile", response_model=OppProfileOut)
async def get_profile() -> OppProfileOut:
    return OppProfileOut(**await store.get_profile())


@router.put("/profile", response_model=OppProfileOut)
async def put_profile(payload: OppProfileIn) -> OppProfileOut:
    updated = await store.update_profile(**payload.model_dump())
    return OppProfileOut(**updated)


# ── SOZLAMALAR ────────────────────────────────────────

class OppSettingsIn(BaseModel):
    enabled: bool
    min_score: int = Field(ge=0, le=200)
    check_interval: int = Field(ge=60)


class OppSettingsOut(BaseModel):
    enabled: bool
    min_score: int
    check_interval: int


@router.get("/settings", response_model=OppSettingsOut)
async def get_settings() -> OppSettingsOut:
    return OppSettingsOut(**await store.get_settings())


@router.put("/settings", response_model=OppSettingsOut)
async def put_settings(payload: OppSettingsIn) -> OppSettingsOut:
    updated = await store.update_settings(**payload.model_dump())
    return OppSettingsOut(**updated)


# ── KANALLAR ──────────────────────────────────────────

class OppChannelIn(BaseModel):
    identifier: str = Field(min_length=1, max_length=255)

    @field_validator("identifier")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("identifier bo'sh bo'lishi mumkin emas.")
        return value


class OppChannelUpdateIn(BaseModel):
    is_active: Optional[bool] = None
    name: Optional[str] = Field(default=None, max_length=255)


class OppChannelOut(BaseModel):
    id: int
    channel_id: int
    name: str
    last_seen: int
    is_active: bool = True
    created_at: datetime

    model_config = {"from_attributes": True}


_normalize_target = service.normalize_target


@router.post("/channels", response_model=OppChannelOut, status_code=status.HTTP_201_CREATED)
async def add_channel(payload: OppChannelIn) -> OppChannelOut:
    client = _get_connected_client()
    try:
        row = await service.add_channel_by_identifier(client, payload.identifier)
    except service.ServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return OppChannelOut.model_validate(row)


@router.get("/channels", response_model=list[OppChannelOut])
async def list_channels() -> list[OppChannelOut]:
    rows = await store.list_channels()
    return [OppChannelOut.model_validate(row) for row in rows]


@router.patch("/channels/{channel_db_id}", response_model=OppChannelOut)
async def update_channel(channel_db_id: int, payload: OppChannelUpdateIn) -> OppChannelOut:
    row = await store.update_channel_by_db_id(
        channel_db_id,
        is_active=payload.is_active,
        name=payload.name,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Kanal topilmadi.")
    return OppChannelOut.model_validate(row)


@router.delete("/channels/{channel_db_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_channel(channel_db_id: int) -> None:
    removed = await store.remove_channel_by_db_id(channel_db_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Kanal topilmadi.")


# ── DIALOG KESH / SKAN ────────────────────────────────

@router.post("/refresh-dialogs")
async def refresh_dialogs() -> dict:
    client = _get_connected_client()
    count = await _load_dialog_cache(client)
    return {"count": count}


@router.post("/scan-now")
async def scan_now() -> dict:
    client = _get_connected_client()
    found = await catch_up(client, message_manager.broadcast)
    return {"found": found}


# ── HOLAT ─────────────────────────────────────────────

class OppStatusOut(BaseModel):
    enabled: bool
    channels_count: int
    min_score: int
    check_interval: int
    total_checks: int
    total_found: int
    last_check: str


@router.get("/status", response_model=OppStatusOut)
async def get_status() -> OppStatusOut:
    return OppStatusOut(**await service.build_status())


# ── TAHLIL (yangi) ────────────────────────────────────

class AnalyzeIn(BaseModel):
    text: str = Field(min_length=1, max_length=20000)


@router.post("/analyze")
async def analyze(payload: AnalyzeIn) -> dict:
    profile = _profile_from_dict(await store.get_profile())
    opp = parse_post(payload.text, date.today(), "")
    evaluate(opp, profile, date.today())
    result = _opp_to_dict(opp)
    result["title"] = opp.title
    return result


# ── EKSPORT FAYL TAHLILI (eski) ───────────────────────

class ImportExportIn(BaseModel):
    text: str = Field(min_length=1)


@router.post("/import-export")
async def import_export(payload: ImportExportIn) -> dict:
    encoded = payload.text.encode("utf-8")
    if len(encoded) > _MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail="Matn 2 MB dan katta bo'lishi mumkin emas.")

    profile = _profile_from_dict(await store.get_profile())
    settings = await store.get_settings()

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", suffix=".txt", delete=False, encoding="utf-8"
        ) as handle:
            handle.write(payload.text)
            tmp_path = handle.name
        channel, opportunities = parse_export_file(tmp_path)
    finally:
        if tmp_path is not None:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    ranked = filter_and_rank(opportunities, profile, min_score=settings["min_score"])
    return {
        "channel": channel,
        "total_posts": len(opportunities),
        "found": len(ranked),
        "opportunities": [_opp_to_dict(opp) for opp in ranked],
    }


# ── GURUHLAR (Stage 6) ─────

class OppGroupIn(BaseModel):
    chat_id: Optional[int] = None
    identifier: Optional[str] = Field(default=None, max_length=255)
    title: Optional[str] = Field(default=None, max_length=255)

    @field_validator("identifier")
    @classmethod
    def _strip_identifier(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        return value or None


class OppGroupOut(BaseModel):
    id: int
    chat_id: int
    title: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class DeliveryModeOut(BaseModel):
    mode: str
    bot_configured: bool
    warning: Optional[str] = None


@router.get("/delivery-mode", response_model=DeliveryModeOut)
async def get_delivery_mode() -> DeliveryModeOut:
    return DeliveryModeOut(**delivery.mode_info())


@router.get("/groups", response_model=list[OppGroupOut])
async def list_groups() -> list[OppGroupOut]:
    rows = await store.list_groups()
    return [OppGroupOut.model_validate(row) for row in rows]


@router.post("/groups", response_model=OppGroupOut, status_code=status.HTTP_201_CREATED)
async def add_group(payload: OppGroupIn) -> OppGroupOut:
    target = payload.identifier or (str(payload.chat_id) if payload.chat_id is not None else None)
    if not target:
        raise HTTPException(status_code=422, detail="chat_id yoki identifier kerak.")
    client = _get_connected_client()
    try:
        row = await service.add_group_by_identifier(client, target, payload.title)
    except service.ServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return OppGroupOut.model_validate(row)


@router.post("/groups/{group_db_id}/confirm", response_model=OppGroupOut)
async def confirm_group(group_db_id: int) -> OppGroupOut:
    group = await store.get_group_by_db_id(group_db_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Guruh topilmadi.")
    client = None
    try:
        client = get_client()
    except RuntimeError:
        client = None
    if delivery.delivery_mode() == "userbot" and client is None:
        raise HTTPException(status_code=503, detail="Telegram mijozi ulanmagan.")
    ok, reason = await delivery.check_group_ready(client, group.chat_id)
    if not ok:
        raise HTTPException(status_code=400, detail=reason)
    row = await store.confirm_group(group_db_id)
    await delivery.send_confirmation(client, group.chat_id)
    return OppGroupOut.model_validate(row)


@router.delete("/groups/{group_db_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(group_db_id: int) -> None:
    removed = await store.remove_group_by_db_id(group_db_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Guruh topilmadi.")


# ── LENTA VA KATEGORIYALAR (Stage 6 + Deep Upgrade v7 Bug #5) ─────

def _compute_match_percent(raw_score: Optional[int]) -> int:
    """Xom ballni (masalan 40..130+) 0..100% moslik foiziga me'yorlashtiradi."""
    if raw_score is None:
        return 60
    if raw_score <= 0:
        return 25
    if raw_score >= 100:
        return min(100, 92 + (raw_score - 100) // 10)
    # 40 ball -> ~65%, 70 ball -> ~82%, 90 ball -> ~93%
    pct = int(round(35 + (raw_score * 0.62)))
    return max(15, min(100, pct))


def _compute_tier(pct: int) -> tuple[str, str]:
    if pct >= 90:
        return "gold", "Oliy moslik (90–100%)"
    if pct >= 75:
        return "silver", "Yuqori moslik (75–89%)"
    if pct >= 55:
        return "bronze", "O‘rta moslik (55–74%)"
    return "base", "Qo‘shimcha (<55%)"


def _compute_discovered_bucket(received_at: datetime) -> str:
    now_utc = datetime.now(timezone.utc)
    dt = received_at if received_at.tzinfo else received_at.replace(tzinfo=timezone.utc)
    dt_utc = dt.astimezone(timezone.utc)
    today_start = datetime(now_utc.year, now_utc.month, now_utc.day, tzinfo=timezone.utc)
    yesterday_start = today_start - timedelta(days=1)
    week_start = today_start - timedelta(days=7)
    if dt_utc >= today_start:
        return "today"
    if dt_utc >= yesterday_start:
        return "yesterday"
    if dt_utc >= week_start:
        return "this_week"
    return "older"


class OppFeedItem(BaseModel):
    id: int
    title: str
    score: Optional[int] = None
    match_percent: int = 60
    tier_key: str = "bronze"
    tier_label: str = "O‘rta moslik (55–74%)"
    discovered_bucket: str = "today"
    deadline: Optional[str] = None
    days_left: Optional[int] = None
    fields: list[str] = Field(default_factory=list)
    is_free: bool = False
    reasons: str = ""
    link: Optional[str] = None
    channel_name: str = ""
    received_at: datetime
    is_read: bool = False
    is_archived: bool = False
    is_starred: bool = False


def _safe_http_link(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    lowered = value.strip().lower()
    return value.strip() if lowered.startswith(("http://", "https://")) else None


def _feed_item(message: Message) -> OppFeedItem:
    meta = parse_formatted_meta(message.text or "")
    link = meta["link"]
    if not link and message.link_urls:
        try:
            urls = json.loads(message.link_urls)
            link = urls[0] if urls else None
        except (TypeError, ValueError):
            link = None
    deadline = meta["deadline"]
    days_left = None
    if deadline:
        try:
            days_left = (date.fromisoformat(deadline) - date.today()).days
        except ValueError:
            deadline = None

    pct = _compute_match_percent(message.opp_score)
    tier_key, tier_label = _compute_tier(pct)
    bucket = _compute_discovered_bucket(message.received_at)

    return OppFeedItem(
        id=message.id,
        title=meta["title"] or (message.text or "").split("\n")[0][:120],
        score=message.opp_score,
        match_percent=pct,
        tier_key=tier_key,
        tier_label=tier_label,
        discovered_bucket=bucket,
        deadline=deadline,
        days_left=days_left,
        fields=meta["fields"],
        is_free=meta["is_free"],
        reasons=meta["reasons"],
        link=_safe_http_link(link),
        channel_name=message.sender_name or "",
        received_at=message.received_at,
        is_read=message.is_read,
        is_archived=message.is_archived,
        is_starred=bool(getattr(message, "is_starred", False)),
    )


@router.get("/feed", response_model=list[OppFeedItem])
async def get_feed(
    archived: bool = False,
    triage_level: Optional[int] = Query(default=None, ge=0, le=3),
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    period: Optional[str] = Query(default=None),  # today | yesterday | this_week | older | all
    tier: Optional[str] = Query(default=None),    # gold | silver | bronze | base
    field_filter: Optional[str] = Query(default=None),
    only_free: Optional[bool] = Query(default=None),
    starred_only: bool = Query(default=False),
    search: Optional[str] = Query(default=None),
    sort_by: str = Query(default="date"),  # "date" (kunlik yangilar) | "score" (foizli ierarxiya)
    limit: int = Query(default=100, ge=1, le=250),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> list[OppFeedItem]:
    """Bug #5: Imkoniyatlar lentasi — kunlik yangi qo'shilganlar (today/yesterday/this_week)
    hamda foizli ierarxiya (gold/silver/bronze/base) bo'yicha to'liq filtrlash va saralash."""
    query = select(Message).where(Message.channel == "opportunity", Message.is_archived == archived)
    if starred_only:
        query = query.where(Message.is_starred.is_(True))
    if triage_level is not None:
        query = query.where(Message.triage_level == triage_level)
    if date_from is not None:
        query = query.where(Message.received_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to is not None:
        query = query.where(Message.received_at <= datetime.combine(date_to, datetime.max.time()))
    if search:
        term = search.strip()[:100]
        if term:
            query = query.where(Message.text.like(f"%{term}%"))

    if sort_by == "score":
        query = query.order_by(Message.opp_score.desc().nullslast(), Message.received_at.desc(), Message.id.desc())
    else:
        query = query.order_by(Message.received_at.desc(), Message.opp_score.desc().nullslast(), Message.id.desc())

    query = query.limit(limit).offset(offset)
    result = await db.execute(query)
    items = [_feed_item(item) for item in result.scalars().all()]

    if period and period != "all":
        if period == "this_week":
            items = [i for i in items if i.discovered_bucket in ("today", "yesterday", "this_week")]
        else:
            items = [i for i in items if i.discovered_bucket == period]
    if tier and tier != "all":
        items = [i for i in items if i.tier_key == tier]
    if field_filter:
        ff = field_filter.strip().lower()
        items = [i for i in items if any(f.lower() == ff for f in i.fields)]
    if only_free is True:
        items = [i for i in items if i.is_free]

    return items


@router.get("/summary")
async def get_feed_summary(
    archived: bool = False,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Bug #5: Imkoniyatlar bo'limidagi 2 ta asosiy kategoriya (Kunlik yangilar va Foizli ierarxiya)
    uchun real vaqtdagi hisoblagichlar."""
    result = await db.execute(
        select(Message).where(Message.channel == "opportunity", Message.is_archived == archived)
    )
    items = [_feed_item(m) for m in result.scalars().all()]

    daily_counts = {"today": 0, "yesterday": 0, "this_week": 0, "older": 0, "total": len(items)}
    tier_counts = {"gold": 0, "silver": 0, "bronze": 0, "base": 0}
    field_counts: dict[str, int] = {}
    urgent_count = 0
    free_count = 0
    unread_count = 0

    for item in items:
        b = item.discovered_bucket
        if b in daily_counts:
            daily_counts[b] += 1
        if b in ("today", "yesterday"):
            daily_counts["this_week"] += 1
        t = item.tier_key
        if t in tier_counts:
            tier_counts[t] += 1
        for f in item.fields:
            field_counts[f] = field_counts.get(f, 0) + 1
        if item.days_left is not None and 0 <= item.days_left <= 3:
            urgent_count += 1
        if item.is_free:
            free_count += 1
        if not item.is_read:
            unread_count += 1

    return {
        "daily": daily_counts,
        "tiers": tier_counts,
        "fields": field_counts,
        "urgent_count": urgent_count,
        "free_count": free_count,
        "unread_count": unread_count,
    }


# ── EKSPORT (Stage 4 + Deep Upgrade v7) ────────────────

@router.get("/export")
async def export_feed(
    format: str = Query(default="csv"),
    archived: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """Imkoniyatlarni CSV yoki JSON formatida eksport qiladi."""
    fmt = format.lower()
    if fmt not in ("csv", "json"):
        raise HTTPException(status_code=400, detail="Faqat format=csv yoki format=json qo'llab-quvvatlanadi.")

    result = await db.execute(
        select(Message)
        .where(Message.channel == "opportunity", Message.is_archived == archived)
        .order_by(Message.opp_score.desc().nullslast(), Message.received_at.desc(), Message.id.desc())
    )
    items = [_feed_item(item) for item in result.scalars().all()]

    if fmt == "json":
        content = json.dumps([i.model_dump(mode="json") for i in items], ensure_ascii=False, indent=2)
        filename = f"imkoniyatlar-{date.today().isoformat()}.json"
        return StreamingResponse(
            iter([content]),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["title", "match_percent", "tier", "score", "discovered_bucket", "deadline", "link", "fields"])
    for item in items:
        writer.writerow([
            item.title,
            f"{item.match_percent}%",
            item.tier_label,
            item.score if item.score is not None else "",
            item.discovered_bucket,
            item.deadline or "",
            item.link or "",
            ";".join(item.fields),
        ])
    buffer.seek(0)
    filename = f"imkoniyatlar-{date.today().isoformat()}.csv"
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── HAFTALIK XULOSA (Stage 4) ──────────────────────────

@router.get("/briefing/weekly")
async def weekly_briefing(db: AsyncSession = Depends(get_db)) -> dict:
    """So'nggi 7 kunlik top-imkoniyatlar + muhim xabarlarni Gemini orqali qisqa xulosaga aylantiradi."""
    since = datetime.now(timezone.utc) - timedelta(days=7)

    top_result = await db.execute(
        select(Message)
        .where(Message.channel == "opportunity", Message.received_at >= since)
        .order_by(Message.opp_score.desc().nullslast(), Message.received_at.desc())
        .limit(10)
    )
    top_items = [_feed_item(item) for item in top_result.scalars().all()]

    important_result = await db.execute(
        select(Message)
        .where(
            Message.channel == "opportunity",
            Message.received_at >= since,
            Message.triage_level >= 2,
        )
        .order_by(Message.received_at.desc())
        .limit(15)
    )
    important_items = important_result.scalars().all()

    lines = ["TOP IMKONIYATLAR (bali bo'yicha):"]
    for item in top_items:
        deadline_label = item.deadline or "noma\u02bclum"
        lines.append(f"- {item.title} | moslik: {item.match_percent}% ({item.score} ball) | muddat: {deadline_label}")
    lines.append("\nMUHIM XABARLAR:")
    for msg in important_items:
        snippet = (msg.text or "")[:150].replace("\n", " ")
        lines.append(f"- {snippet}")

    prompt = "\n".join(lines) if (top_items or important_items) else "Bu hafta yangi imkoniyat yoki muhim xabar yo'q."

    sys_instruct = (
        "Sen 16 yoshli o'quvchining shaxsiy 'Chief of Staff'isan. Quyidagi so'nggi 7 kunlik "
        "imkoniyatlar va muhim xabarlar ro'yxatidan foydalanuvchiga qisqa (5-8 jumla), aniq, "
        "amaliy haftalik xulosa yoz: eng muhim 2-3 imkoniyatni ajratib ko'rsat, muddatlarni eslat, "
        "keyingi qadamni tavsiya qil. O'zbekcha, aniq va dalillarga asoslangan."
    )
    summary = call_gemini_raw([{"parts": [{"text": prompt}]}], sys_instruct, max_tokens=800)
    if not summary:
        summary = (
            f"So'nggi 7 kunda {len(top_items)} ta imkoniyat va {len(important_items)} ta muhim xabar topildi. "
            "Batafsil ro'yxatni pastda ko'rishingiz mumkin."
        )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "period_days": 7,
        "summary": summary,
        "top_opportunities": [item.model_dump() for item in top_items],
        "important_count": len(important_items),
    }
