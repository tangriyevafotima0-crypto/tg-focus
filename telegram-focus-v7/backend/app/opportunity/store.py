"""
store.py — Imkoniyat-motor holati, SQLite'da.
"""
import json
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import delete, func, select

from ..database import async_session_factory
from ..models import OppChannel, OppGroup, OppProfile, OppSent, OppSettings, OppStats

DEFAULT_PROFILE: dict[str, Any] = {
    "age": 16,
    "grade": 11,
    "ielts": 6.0,
    "knows_english": True,
    "is_student": False,
    "is_pupil": True,
    "interests": ["IT", "Biznes", "Debat", "Til", "Liderlik"],
    "only_free": True,
}

DEFAULT_SETTINGS: dict[str, Any] = {
    "enabled": False,
    "min_score": 40,
    "check_interval": 600,
}

_MAX_SENT_HASHES = 5000


async def _get_or_create_profile(session) -> OppProfile:
    row = await session.get(OppProfile, 1)
    if row is None:
        row = OppProfile(
            id=1,
            age=DEFAULT_PROFILE["age"],
            grade=DEFAULT_PROFILE["grade"],
            ielts=DEFAULT_PROFILE["ielts"],
            knows_english=DEFAULT_PROFILE["knows_english"],
            is_student=DEFAULT_PROFILE["is_student"],
            is_pupil=DEFAULT_PROFILE["is_pupil"],
            interests=json.dumps(DEFAULT_PROFILE["interests"], ensure_ascii=False),
            only_free=DEFAULT_PROFILE["only_free"],
        )
        session.add(row)
        await session.flush()
    return row


async def _get_or_create_settings(session) -> OppSettings:
    row = await session.get(OppSettings, 1)
    if row is None:
        row = OppSettings(id=1, **DEFAULT_SETTINGS)
        session.add(row)
        await session.flush()
    return row


async def _get_or_create_stats(session) -> OppStats:
    row = await session.get(OppStats, 1)
    if row is None:
        row = OppStats(id=1, total_checks=0, total_found=0, last_check="")
        session.add(row)
        await session.flush()
    return row


def _profile_to_dict(row: OppProfile) -> dict[str, Any]:
    try:
        interests = json.loads(row.interests) if row.interests else []
    except (TypeError, ValueError):
        interests = []
    return {
        "age": row.age,
        "grade": row.grade,
        "ielts": row.ielts,
        "knows_english": row.knows_english,
        "is_student": row.is_student,
        "is_pupil": row.is_pupil,
        "interests": interests,
        "only_free": row.only_free,
    }


def _settings_to_dict(row: OppSettings) -> dict[str, Any]:
    return {
        "enabled": row.enabled,
        "min_score": row.min_score,
        "check_interval": row.check_interval,
    }


# ── Profil ────────────────────────────────────────────

async def get_profile() -> dict[str, Any]:
    async with async_session_factory() as session:
        row = await _get_or_create_profile(session)
        await session.commit()
        return _profile_to_dict(row)


async def update_profile(**fields: Any) -> dict[str, Any]:
    async with async_session_factory() as session:
        row = await _get_or_create_profile(session)
        for key, value in fields.items():
            if value is None and key not in ("grade", "ielts"):
                continue
            if key == "interests":
                row.interests = json.dumps(value, ensure_ascii=False)
            elif hasattr(row, key):
                setattr(row, key, value)
        await session.commit()
        await session.refresh(row)
        return _profile_to_dict(row)


# ── Sozlamalar ────────────────────────────────────────

async def get_settings() -> dict[str, Any]:
    async with async_session_factory() as session:
        row = await _get_or_create_settings(session)
        await session.commit()
        return _settings_to_dict(row)


async def update_settings(**fields: Any) -> dict[str, Any]:
    async with async_session_factory() as session:
        row = await _get_or_create_settings(session)
        for key, value in fields.items():
            if value is None:
                continue
            if hasattr(row, key):
                setattr(row, key, value)
        await session.commit()
        await session.refresh(row)
        return _settings_to_dict(row)


# ── Kanallar ──────────────────────────────────────────

async def add_channel(channel_id: int, name: str) -> OppChannel:
    async with async_session_factory() as session:
        existing = (
            await session.execute(select(OppChannel).where(OppChannel.channel_id == channel_id))
        ).scalar_one_or_none()
        if existing is not None:
            existing.name = name
            existing.is_active = True
            await session.commit()
            await session.refresh(existing)
            return existing
        row = OppChannel(channel_id=channel_id, name=name, last_seen=0, is_active=True)
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row


async def remove_channel(channel_id: int) -> bool:
    async with async_session_factory() as session:
        result = await session.execute(delete(OppChannel).where(OppChannel.channel_id == channel_id))
        await session.commit()
        return result.rowcount > 0


async def list_channels() -> list[OppChannel]:
    async with async_session_factory() as session:
        result = await session.execute(select(OppChannel).order_by(OppChannel.id))
        return list(result.scalars().all())


async def get_channel_by_db_id(db_id: int) -> Optional[OppChannel]:
    async with async_session_factory() as session:
        return await session.get(OppChannel, db_id)


async def update_channel_by_db_id(
    db_id: int,
    *,
    is_active: Optional[bool] = None,
    name: Optional[str] = None,
) -> Optional[OppChannel]:
    async with async_session_factory() as session:
        row = await session.get(OppChannel, db_id)
        if row is None:
            return None
        if is_active is not None:
            row.is_active = bool(is_active)
        if name is not None and name.strip():
            row.name = name.strip()
        await session.commit()
        await session.refresh(row)
        return row


async def get_channel(channel_id: int) -> Optional[OppChannel]:
    async with async_session_factory() as session:
        return (
            await session.execute(select(OppChannel).where(OppChannel.channel_id == channel_id))
        ).scalar_one_or_none()


async def remove_channel_by_db_id(db_id: int) -> bool:
    async with async_session_factory() as session:
        row = await session.get(OppChannel, db_id)
        if row is None:
            return False
        await session.delete(row)
        await session.commit()
        return True


async def get_last_seen(channel_id: int) -> int:
    async with async_session_factory() as session:
        row = (
            await session.execute(select(OppChannel).where(OppChannel.channel_id == channel_id))
        ).scalar_one_or_none()
        return row.last_seen if row else 0


async def set_last_seen(channel_id: int, msg_id: int) -> None:
    async with async_session_factory() as session:
        row = (
            await session.execute(select(OppChannel).where(OppChannel.channel_id == channel_id))
        ).scalar_one_or_none()
        if row is not None:
            row.last_seen = msg_id
            await session.commit()


# ── Takror oldini olish ───────────────────────────────

async def is_sent(opp_hash: str) -> bool:
    async with async_session_factory() as session:
        row = (
            await session.execute(select(OppSent).where(OppSent.hash == opp_hash))
        ).scalar_one_or_none()
        return row is not None


async def mark_sent(opp_hash: str) -> None:
    async with async_session_factory() as session:
        existing = (
            await session.execute(select(OppSent).where(OppSent.hash == opp_hash))
        ).scalar_one_or_none()
        if existing is not None:
            return
        session.add(OppSent(hash=opp_hash))
        await session.commit()

        count = (
            await session.execute(select(func.count()).select_from(OppSent))
        ).scalar_one()
        if count > _MAX_SENT_HASHES:
            overflow = count - _MAX_SENT_HASHES
            old_ids = (
                await session.execute(
                    select(OppSent.id).order_by(OppSent.id.asc()).limit(overflow)
                )
            ).scalars().all()
            if old_ids:
                await session.execute(delete(OppSent).where(OppSent.id.in_(old_ids)))
                await session.commit()


# ── Statistika ────────────────────────────────────────

async def record_check(found: int, when: Optional[str] = None) -> None:
    when = when or datetime.now(timezone.utc).isoformat()
    async with async_session_factory() as session:
        row = await _get_or_create_stats(session)
        row.total_checks += 1
        row.total_found += found
        row.last_check = when
        await session.commit()


async def record_match(when: Optional[str] = None) -> None:
    when = when or datetime.now(timezone.utc).isoformat()
    async with async_session_factory() as session:
        row = await _get_or_create_stats(session)
        row.total_found += 1
        row.last_check = when
        await session.commit()


async def get_stats() -> dict[str, Any]:
    async with async_session_factory() as session:
        row = await _get_or_create_stats(session)
        await session.commit()
        return {
            "total_checks": row.total_checks,
            "total_found": row.total_found,
            "last_check": row.last_check,
        }


# ── Guruhlar (Stage 6) ──

async def add_group(chat_id: int, title: str) -> OppGroup:
    async with async_session_factory() as session:
        existing = (
            await session.execute(select(OppGroup).where(OppGroup.chat_id == chat_id))
        ).scalar_one_or_none()
        if existing is not None:
            existing.title = title
            await session.commit()
            await session.refresh(existing)
            return existing
        row = OppGroup(chat_id=chat_id, title=title, status="pending")
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row


async def list_groups(status: Optional[str] = None) -> list[OppGroup]:
    async with async_session_factory() as session:
        query = select(OppGroup).order_by(OppGroup.id)
        if status is not None:
            query = query.where(OppGroup.status == status)
        return list((await session.execute(query)).scalars().all())


async def get_group_by_db_id(db_id: int) -> Optional[OppGroup]:
    async with async_session_factory() as session:
        return await session.get(OppGroup, db_id)


async def confirm_group(db_id: int) -> Optional[OppGroup]:
    async with async_session_factory() as session:
        row = await session.get(OppGroup, db_id)
        if row is None:
            return None
        row.status = "confirmed"
        await session.commit()
        await session.refresh(row)
        return row


async def remove_group_by_db_id(db_id: int) -> bool:
    async with async_session_factory() as session:
        row = await session.get(OppGroup, db_id)
        if row is None:
            return False
        await session.delete(row)
        await session.commit()
        return True


async def get_current_system_facts(session) -> dict:
    """Chat va Welcome uchun DB dan haqiqiy faktlarni yig'adi (async)."""
    from sqlalchemy import select, func, desc
    from app.models import Message, Opportunity, SubmittedOpportunity, Source
    from datetime import datetime, timezone

    tg_unread_result = await session.execute(
        select(func.count())
        .select_from(Message)
        .join(Source, Message.source_id == Source.id)
        .where(
            Source.is_active.is_(True),
            Message.channel == "telegram",
            Message.is_read.is_(False),
            Message.is_archived.is_(False),
        )
    )
    tg_unread = tg_unread_result.scalar_one()

    important_sources_result = await session.execute(
        select(Source.display_name, func.count(Message.id).label("unread_count"))
        .join(Message, Message.source_id == Source.id)
        .where(
            Source.is_active.is_(True),
            Message.channel == "telegram",
            Message.is_read.is_(False),
            Message.is_archived.is_(False),
        )
        .group_by(Source.id)
        .order_by(desc("unread_count"))
        .limit(5)
    )
    important_sources = [row[0] for row in important_sources_result.all()]

    _ADMISSIONS_KEYWORDS = (
        "admission", "admitted", "application", "scholarship", "accept",
        "decision", "offer", "enroll", "qabul", "ariza", "stipendiya",
    )
    email_candidates_result = await session.execute(
        select(Message.text).where(
            Message.channel == "email",
            Message.is_archived.is_(False),
        )
    )
    email_texts = email_candidates_result.scalars().all()
    email_admissions = sum(
        1 for t in email_texts
        if t and any(kw in t[:200].lower() for kw in _ADMISSIONS_KEYWORDS)
    )

    now = datetime.now(timezone.utc)
    urgent_sub_result = await session.execute(
        select(SubmittedOpportunity)
        .where(SubmittedOpportunity.next_deadline >= now)
        .order_by(SubmittedOpportunity.next_deadline.asc())
        .limit(1)
    )
    urgent_sub = urgent_sub_result.scalar_one_or_none()

    if urgent_sub:
        deadline = urgent_sub.next_deadline
        if deadline.tzinfo is None:
            deadline = deadline.replace(tzinfo=timezone.utc)
        days_left = (deadline - now).days
        title = urgent_sub.opportunity.title if getattr(urgent_sub, "opportunity", None) else "Noma'lum dastur"
        rule_focus = f"'{title}' bo'yicha {urgent_sub.next_deadline_note or 'hujjat topshirish'} ({max(0, days_left)} kun qoldi)"
    else:
        top_opp_result = await session.execute(
            select(Opportunity)
            .where(Opportunity.deadline.is_(None) | (Opportunity.deadline >= now))
            .order_by(Opportunity.match_score.desc())
            .limit(1)
        )
        top_opp = top_opp_result.scalar_one_or_none()
        if top_opp:
            rule_focus = f"'{top_opp.title}' arizasini tayyorlash"
        else:
            rule_focus = "Bugungi dolzarb vazifalarni ko'rib chiqish"

    recommended_result = await session.execute(
        select(Opportunity.title)
        .where(Opportunity.deadline.is_(None) | (Opportunity.deadline >= now))
        .order_by(Opportunity.match_score.desc())
        .limit(3)
    )
    recommended_opportunities = [row[0] for row in recommended_result.all()]

    return {
        "telegram": {
            "unread_count": tg_unread,
            "important_sources": important_sources,
        },
        "email": {
            "admissions_count": email_admissions
        },
        "rule_of_one_focus": rule_focus,
        "recommended_opportunities": recommended_opportunities,
    }


async def get_recent_telegram_messages(limit: int = 50) -> list:
    from sqlalchemy import select
    from app.models import Message

    async with async_session_factory() as session:
        result = await session.execute(
            select(Message)
            .where(Message.channel == "telegram", Message.is_archived.is_(False))
            .order_by(Message.received_at.desc())
            .limit(limit)
        )
        rows = result.scalars().all()
        return [
            {
                "id": m.id,
                "sender": m.sender_name,
                "text": m.text,
                "date": m.received_at.isoformat() if m.received_at else None,
                "is_opportunity_candidate": bool(m.opp_score and m.opp_score > 0),
            }
            for m in rows
        ]


async def get_recent_emails(limit: int = 50) -> list:
    from sqlalchemy import select
    from app.models import Message

    async with async_session_factory() as session:
        result = await session.execute(
            select(Message)
            .where(Message.channel == "email", Message.is_archived.is_(False))
            .order_by(Message.received_at.desc())
            .limit(limit)
        )
        rows = result.scalars().all()
        return [
            {
                "id": m.id,
                "thread_id": str(m.reply_to_message_id) if m.reply_to_message_id else "",
                "sender": m.sender_name,
                "subject": (m.text or "")[:80],
                "snippet": m.text,
                "received_at": m.received_at.isoformat() if m.received_at else None,
            }
            for m in rows
        ]
