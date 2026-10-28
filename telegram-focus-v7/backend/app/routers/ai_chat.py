import asyncio
import logging
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Message
from app.opportunity import store
from app.opportunity.gemini_analyzer import (
    generate_welcome_briefing,
    generate_chat_response,
)
from app.rate_limit import limiter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ai", tags=["ai-chat"])


class ChatMessageHistoryItem(BaseModel):
    sender: str = Field(..., pattern="^(user|ai)$")
    text: str = Field(..., max_length=4000)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=3000)
    history: Optional[List[ChatMessageHistoryItem]] = Field(default_factory=list)
    current_context: Optional[Dict[str, Any]] = None


class ChatResponse(BaseModel):
    reply: str
    used_model: str


async def get_realtime_context(db: AsyncSession) -> Dict[str, Any]:
    facts = {
        "telegram": {"unread_count": 0},
        "email": {"admissions_count": 0},
        "rule_of_one_focus": "Universitet va grant arizalarini ko'rib chiqish",
        "recent_messages": []
    }
    try:
        f_func = getattr(store, "get_current_system_facts", None)
        if f_func:
            raw = await f_func(db)
            if isinstance(raw, dict):
                facts.update(raw)
    except Exception:
        # X-1 (Stage 8): avval bu xato jimgina yutilardi ("pass") — masalan
        # `get_current_system_facts` ichidagi `AttributeError` (mavjud
        # bo'lmagan `Opportunity.is_active`) hech qayerda ko'rinmasdi.
        # Endi log'ga yoziladi, lekin baribir zaxira `facts` bilan davom
        # etadi (chat/welcome funksiyasi buzilmasligi uchun).
        logger.exception("get_current_system_facts xatoligi (zaxira faktlar ishlatiladi)")

    try:
        result = await db.execute(
            select(Message).order_by(Message.received_at.desc()).limit(20)
        )
        msgs = result.scalars().all()
        recent = []
        for m in reversed(msgs):
            chat = getattr(m, "channel", "") or "Guruh"
            snd = getattr(m, "sender_name", "") or "Foydalanuvchi"
            txt = (getattr(m, "text", "") or "").strip()
            if txt:
                recent.append(f"[{chat} | {snd}]: {txt[:160]}")
        facts["recent_messages"] = recent
    except Exception:
        logger.exception("So'nggi xabarlarni olishda xato")
        await db.rollback()

    return facts


@router.get("/welcome")
async def get_ai_welcome(db: AsyncSession = Depends(get_session)):
    facts = await get_realtime_context(db)
    # Stage 6: generate_welcome_briefing ichida sync Gemini chaqiruvi bor —
    # to_thread'siz bu endpoint butun event loop'ni (shu jumladan boshqa
    # foydalanuvchi so'rovlari va Telegram oqimini) Gemini javob
    # bergunicha bloklab qo'yardi.
    greeting_text, used_model = await asyncio.to_thread(generate_welcome_briefing, facts)
    return {"greeting": greeting_text, "facts": facts, "used_model": used_model}


@router.post("/chat", response_model=ChatResponse)
@limiter.limit("20/minute")
async def post_ai_chat(request: Request, req: ChatRequest, db: AsyncSession = Depends(get_session)):
    facts = await get_realtime_context(db)
    history_dicts = [item.model_dump() for item in (req.history or [])]
    # Stage 6: generate_chat_response sync (Gemini + scrape_webpage bo'lishi
    # mumkin) — to_thread orqali chaqiriladi, aks holda bitta chat so'rovi
    # butun ilovani muzlatib qo'yardi.
    reply_text, used_model = await asyncio.to_thread(
        generate_chat_response,
        message=req.message,
        history=history_dicts,
        facts=facts,
        current_context=req.current_context,
    )
    return ChatResponse(reply=reply_text, used_model=used_model)
