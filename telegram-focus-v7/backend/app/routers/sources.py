from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Message, Source
from ..schemas import SourceCreate, SourceOut, SourceUpdate
from ..telethon_client import _identifier_variants, _normalize_identifier


router = APIRouter(prefix="/api/sources", tags=["sources"])


def normalize_identifier(value: str) -> str:
    return _normalize_identifier(value)


async def _enrich_sources(db: AsyncSession, sources: list[Source]) -> list[SourceOut]:
    if not sources:
        return []
    source_ids = [s.id for s in sources]

    # Har bir manba bo'yicha o'qilmagan, jami, arxiv, media, saqlangan va oxirgi faollik statistikasi
    stats_query = (
        select(
            Message.source_id,
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
            func.sum(
                case(
                    (Message.is_archived.is_(True), 1),
                    else_=0,
                )
            ).label("archived_count"),
            func.sum(
                case(
                    (
                        Message.is_archived.is_(False)
                        & (Message.has_media_file.is_(True) | Message.media_type.is_not(None)),
                        1,
                    ),
                    else_=0,
                )
            ).label("media_count"),
            func.sum(
                case(
                    (Message.is_starred.is_(True), 1),
                    else_=0,
                )
            ).label("starred_count"),
            func.max(Message.received_at).label("last_message_at"),
        )
        .where(Message.source_id.in_(source_ids))
        .group_by(Message.source_id)
    )
    stats_res = await db.execute(stats_query)
    stats_map = {row.source_id: row for row in stats_res.all()}

    # Har bir manbaning eng oxirgi xabari (preview uchun)
    latest_msg_subq = (
        select(
            Message.source_id,
            func.max(Message.id).label("max_msg_id"),
        )
        .where(Message.source_id.in_(source_ids), Message.is_archived.is_(False))
        .group_by(Message.source_id)
        .subquery()
    )
    latest_msgs_query = select(Message).join(
        latest_msg_subq, Message.id == latest_msg_subq.c.max_msg_id
    )
    latest_res = await db.execute(latest_msgs_query)
    latest_map = {m.source_id: m for m in latest_res.scalars().all()}

    enriched: list[SourceOut] = []
    for src in sources:
        st = stats_map.get(src.id)
        last_msg = latest_map.get(src.id)
        preview = None
        last_sender = None
        if last_msg is not None:
            raw_text = (last_msg.text or "").strip().replace("\n", " ")
            if raw_text:
                preview = raw_text[:90] + ("…" if len(raw_text) > 90 else "")
            elif last_msg.media_type:
                preview = f"📎 {last_msg.media_type}"
            last_sender = last_msg.sender_name

        enriched.append(
            SourceOut(
                id=src.id,
                identifier=src.identifier,
                display_name=src.display_name,
                type=src.type,
                is_active=src.is_active,
                created_at=src.created_at,
                unread_count=int(st.unread_count or 0) if st else 0,
                total_count=int(st.total_count or 0) if st else 0,
                archived_count=int(st.archived_count or 0) if st else 0,
                media_count=int(st.media_count or 0) if st else 0,
                starred_count=int(st.starred_count or 0) if st else 0,
                last_message_at=st.last_message_at if st else None,
                last_message_preview=preview,
                last_sender_name=last_sender,
            )
        )
    return enriched


@router.post("", response_model=SourceOut, status_code=status.HTTP_201_CREATED)
async def create_source(
    payload: SourceCreate,
    db: AsyncSession = Depends(get_db),
) -> SourceOut:
    new_variants = _identifier_variants(payload.identifier)
    existing = await db.execute(select(Source).where(Source.kind == "telegram"))
    for item in existing.scalars():
        if _identifier_variants(item.identifier) & new_variants:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Bu manba allaqachon qo‘shilgan.",
            )

    clean_identifier = payload.identifier.strip()
    source = Source(
        identifier=clean_identifier,
        display_name=payload.display_name or clean_identifier,
        type=payload.type,
        is_active=True,
    )
    db.add(source)
    await db.commit()
    await db.refresh(source)
    enriched = await _enrich_sources(db, [source])
    return enriched[0]


@router.get("", response_model=list[SourceOut])
async def list_sources(db: AsyncSession = Depends(get_db)) -> list[SourceOut]:
    subquery = (
        select(Message.source_id, func.max(Message.received_at).label("last_activity"))
        .group_by(Message.source_id)
        .subquery()
    )

    query = (
        select(Source)
        .outerjoin(subquery, Source.id == subquery.c.source_id)
        .where(Source.kind == "telegram")
        .order_by(subquery.c.last_activity.desc().nullslast(), Source.created_at.desc())
    )
    result = await db.execute(query)
    sources = list(result.scalars().all())
    return await _enrich_sources(db, sources)


@router.get("/{source_id}/profile", response_model=SourceOut)
async def get_source_profile(
    source_id: int,
    db: AsyncSession = Depends(get_db),
) -> SourceOut:
    source = await db.get(Source, source_id)
    if source is None or source.kind != "telegram":
        raise HTTPException(status_code=404, detail="Manba topilmadi.")
    enriched = await _enrich_sources(db, [source])
    return enriched[0]


@router.patch("/{source_id}", response_model=SourceOut)
async def update_source(
    source_id: int,
    payload: SourceUpdate,
    db: AsyncSession = Depends(get_db),
) -> SourceOut:
    source = await db.get(Source, source_id)
    if source is None or source.kind != "telegram":
        raise HTTPException(status_code=404, detail="Manba topilmadi.")

    updates = payload.model_dump(exclude_unset=True)
    if "display_name" in updates and updates["display_name"] is not None:
        if not updates["display_name"].strip():
            raise HTTPException(status_code=422, detail="Nomi bo‘sh bo‘lishi mumkin emas.")
        source.display_name = updates["display_name"].strip()
    if "is_active" in updates and updates["is_active"] is not None:
        source.is_active = bool(updates["is_active"])
    if "type" in updates and updates["type"] is not None:
        source.type = updates["type"]
    await db.commit()
    await db.refresh(source)
    enriched = await _enrich_sources(db, [source])
    return enriched[0]


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_source(
    source_id: int,
    db: AsyncSession = Depends(get_db),
) -> None:
    source = await db.get(Source, source_id)
    if source is None or source.kind != "telegram":
        raise HTTPException(status_code=404, detail="Manba topilmadi.")
    await db.delete(source)
    await db.commit()