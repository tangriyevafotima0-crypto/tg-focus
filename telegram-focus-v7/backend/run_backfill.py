"""run_backfill.py — oxirgi 7 kunlik kanal tarixini qayta tahlil qiladi va
bazaga (haqiqiy sxema bo'yicha) yangi imkoniyatlarni qo'shadi.

X-3 (Stage 8) tuzatishlari:
  1. `analyze_opportunity(...)` **sync** funksiya (Gemini'ga sync chaqiruv
     qiladi) edi, lekin `await analyze_opportunity(...)` bilan chaqirilgan —
     bu har safar `TypeError: object dict can't be used in 'await'
     expression` bilan yiqilardi. Endi `asyncio.to_thread(...)` bilan
     o'raladi (event loop'ni bloklamaslik uchun, boshqa modullardagi
     naqshga mos — qarang app/routers/ai_chat.py, app/opportunity/service.py).
  2. Skript avval xom SQLite jadvallariga (`monitored_channels`,
     `processed_messages`, `opportunities` ustunlari `channel_id`,
     `message_id`, `is_relevant` bilan) yozar edi — bular loyihaning
     haqiqiy sxemasida (`backend/app/models.py`) UMUMAN MAVJUD EMAS
     (haqiqiy jadvallar: `sources`, `messages`, `opportunities` — ustunlar
     butunlay boshqacha: `title`, `organization`, `match_score`, `is_paid`,
     `deadline`, h.k.). Shu sababli bu skript hech qachon muvaffaqiyatli
     ishlay olmas edi. Endi haqiqiy ORM modellaridan (`app.models.Source`,
     `app.models.Opportunity`) va `app.database.async_session_factory`dan
     foydalanadi.

Eslatma: `app.models.Opportunity`'da "qaysi kanal/xabardan kelgani" yoki
"takror ishlanmasligi" uchun ustunlar yo'q (masalan `channel_id`/
`message_id`/`processed_messages` jadvali kabi narsa yo'q). Shu sababli bu
versiyada oddiy himoya sifatida bir xil sarlavha (`title`) bilan oldin
qo'shilgan Opportunity borligi tekshiriladi (aynan bir xil post ikki marta
qo'shilib ketmasligi uchun) — bu mukammal emas (masalan boshqa so'z bilan
qayta yozilgan post qayta qo'shilishi mumkin), lekin hozirgi sxema bilan
oqilona chegara. To'liq "processed_messages" kuzatuvi kerak bo'lsa, bu
alohida migratsiya/jadval talab qiladi (stage doirasidan tashqarida).
"""

import asyncio
import logging
import os
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import select
from telethon import TelegramClient

BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("run_backfill")

API_ID = int(os.getenv("TELEGRAM_API_ID", "0"))
API_HASH = os.getenv("TELEGRAM_API_HASH", "")
SESSION_PATH = str(BACKEND_DIR / "telegram_focus")

from app.database import async_session_factory
from app.models import Source, Opportunity
from app.opportunity.gemini_analyzer import analyze_opportunity


async def _already_saved(session, title: str) -> bool:
    result = await session.execute(select(Opportunity.id).where(Opportunity.title == title).limit(1))
    return result.scalar_one_or_none() is not None


async def main() -> None:
    print("=" * 60)
    print(" [1/3] Kanallar tarixini (oxirgi 7 kun) tahlil qilish boshlandi...")
    print("=" * 60)

    async with async_session_factory() as session:
        result = await session.execute(
            select(Source).where(Source.is_active.is_(True), Source.kind == "telegram")
        )
        channels = result.scalars().all()

    if not channels:
        print("[!] Faol kanallar topilmadi!")
        return

    print(f"[*] Kuzatilayotgan kanallar soni: {len(channels)} ta")

    client = TelegramClient(SESSION_PATH, API_ID, API_HASH)
    await client.connect()

    if not await client.is_user_authorized():
        print("[X] Telegram sessiyasi ochilmadi! Avval terminalda "
              "`python -m app.telethon_client` bilan bir marta login qiling.")
        await client.disconnect()
        return

    seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)
    total_added = 0

    for source in channels:
        identifier = source.identifier
        ch_id = int(identifier) if identifier.lstrip("-").isdigit() else identifier
        ch_title = source.display_name or f"Kanal ({ch_id})"
        print(f"\n---> [{ch_title}] ko'rib chiqilmoqda...")

        try:
            entity = await client.get_entity(ch_id)
        except Exception as exc:
            print(f"   [!] Kanalga ulanishda xatolik: {exc}")
            continue

        try:
            async for msg in client.iter_messages(entity, limit=25):
                if not msg.text or len(msg.text.strip()) < 40:
                    continue
                if msg.date < seven_days_ago:
                    break

                urls = re.findall(r"https?://\S+", msg.text)

                # X-3: analyze_opportunity sync — to_thread bilan o'ralgan,
                # `await`lanmaydi (sync qaytadi).
                try:
                    analysis = await asyncio.to_thread(analyze_opportunity, msg.text, urls[0] if urls else None)
                except Exception:
                    logger.exception("Post %s tahlilida xato, o'tkazib yuborildi", msg.id)
                    continue

                if not analysis:
                    continue

                # Haqiqiy maydon nomi `match_percentage` (`match_score` emas —
                # oldingi versiyada noto'g'ri kalit ishlatilgani uchun bu
                # doim 0 bo'lib, hech narsa saqlanmas edi). AI mavjud
                # bo'lmasa (`ai_available=False`) `match_percentage`/
                # `is_relevant` `None` bo'ladi — bunday postlar hozircha
                # baholab bo'lmaydi deb o'tkazib yuboriladi (keyinroq qayta
                # ko'rib chiqilishi mumkin, lekin noaniq ballga bazaga
                # yozilmaydi).
                if analysis.get("ai_available") is False:
                    print(f"   [~] Post {msg.id}: AI mavjud emas, o'tkazib yuborildi")
                    continue

                score = analysis.get("match_percentage")
                title = analysis.get("title") or "Nomsiz imkoniyat"
                is_relevant = analysis.get("is_relevant")

                print(f"   [+] Post {msg.id}: {title[:35]}... | Ball: {score}")

                if not is_relevant or not score or score < 70:
                    continue

                async with async_session_factory() as session:
                    if await _already_saved(session, title):
                        print("       >>> O'TKAZIB YUBORILDI (bazada allaqachon bor)")
                        continue

                    organization = analysis.get("organization")
                    is_free = analysis.get("is_free")
                    is_paid = (is_free is False)

                    # `deadline` Gemini'dan erkin matn sifatida keladi
                    # (masalan "2025-yil 20-iyun" yoki "Ko'rsatilmagan"),
                    # ISO format EMAS — shuning uchun faqat aniq ISO
                    # ko'rinishdagi qiymat ustunga yoziladi; aks holda
                    # `None` qoldiriladi va xom matn logga yoziladi (noto'g'ri
                    # "parslangan" sana bazaga tushib ketmasligi uchun —
                    # buni to'g'ri aniqlash `parser.py`dagi naqshlarni talab
                    # qiladi va bu skriptning doirasidan tashqarida).
                    deadline_raw = analysis.get("deadline")
                    deadline = None
                    if deadline_raw and deadline_raw not in ("Noma'lum", "Noma\u02bclum", "Ko'rsatilmagan", ""):
                        try:
                            deadline = datetime.fromisoformat(deadline_raw)
                            if deadline.tzinfo is None:
                                deadline = deadline.replace(tzinfo=timezone.utc)
                        except ValueError:
                            logger.info(
                                "Deadline matnini ISO formatga o'tkazib bo'lmadi (qo'lda tekshiring): %r",
                                deadline_raw,
                            )
                            deadline = None

                    opp = Opportunity(
                        title=title,
                        organization=organization,
                        url=(urls[0] if urls else None),
                        match_score=float(score),
                        is_paid=is_paid,
                        deadline=deadline,
                    )
                    session.add(opp)
                    await session.commit()

                total_added += 1
                print(f"       >>> BAZAGA QO'SHILDI (Ball: {score})")

                await asyncio.sleep(1.0)
        except Exception as exc:
            print(f"   [!] Kanalni o'qishda xatolik: {exc}")

    await client.disconnect()
    print("\n" + "=" * 60)
    print(f" [TAMOM] Tahlil tugadi! Bazaga {total_added} ta yangi imkoniyat qo'shildi.")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
