# HANDOFF — Stage 1 tugadi

## O'zgargan fayllar

**`backend/app/telethon_client.py`**
- `events.NewMessage` → `events.NewMessage(incoming=True)` (handler registratsiyasida).
- `_handle_new_message` boshiga qo'shildi:
  ```python
  if event.out or getattr(event.message, "out", False):
      return
  ```
- `TelegramClient(SESSION_PATH, api_id, api_hash)` → qo'shimcha `catch_up=True`.

**`backend/app/opportunity/engine.py`**
- `score = result.get("match_score", 0) or 0` →
  `score = result.get("match_percentage") or result.get("match_score") or 0`

**`backend/app/opportunity/auto_responder.py`**
- `message.source_id == 14` qattiq kod olib tashlandi. Endi:
  `Source` jadvalidan `await session.get(Source, message.source_id)` orqali
  topib, `source.identifier == "dm_unmonitored"` tekshiriladi.
- Funksiya boshiga `message.direction != "in"` tekshiruvi qo'shildi (bo'lmasa
  `wrong_level` bilan qaytadi).
- Import qatoriga `Source` qo'shildi (`from ..models import Message, Source`).

## auto_reply_enabled holati

- **Hech narsa o'zgartirilmadi** — `settings_store.py`dagi default allaqachon
  `"auto_reply_enabled": False` edi, va repo ichida uni override qiladigan
  `settings.json` fayli topilmadi. Ya'ni auto-reply **hozir ham o'chiq**
  holatda, stage 4 da (qattiq kodlar to'liq tuzatilgach) yoqilishi kerak.
- Agar runtime muhitda alohida `settings.json` fayli bo'lsa va u
  `auto_reply_enabled: true` qilib qo'ygan bo'lsa — uni qo'lda `false`ga
  tushiring (bu zip ichida bunday fayl yo'q edi, shuning uchun koddan tuzata
  olmadim).

## Stage 2 uchun eslatma

- `email_worker.py.bak` dan asl ishchini tiklash kerak (async
  `link_to_submission` + alert bilan birga). Qaysi fayl `.bak` ekanini stage 2
  boshida tekshirib oling — bu stage unga tegmadi.

## Tekshirish checklist

- [ ] O'zingizga (yoki test akkauntdan) DM yozib ko'ring — bot avtomatik
      javob yozmasligi kerak (`auto_reply_enabled=False` bo'lgani uchun).
- [ ] Botni ishga tushirganda eski (o'qilmagan) xabarlar `catch_up=True`
      tufayli bir marta qayta ishlanadi — bu kutilgan holat.
- [ ] `source_id == 14` bo'lgan xabarlar endi faqat haqiqiy
      `identifier == "dm_unmonitored"` source'lar uchun ishlaydi — DB'da shu
      identifier mavjudligini tekshiring (agar yo'q bo'lsa, qo'shish kerak
      bo'lishi mumkin, lekin bu stage ko'lamidan tashqarida).

---

# HANDOFF — Stage 2 tugadi

## O'zgargan fayllar

**`backend/app/email_worker.py`**
- To'liq almashtirildi: soxta stub (120 qator, sync SQLite, `app.*` importlar)
  o'rniga `.bak`dagi haqiqiy async IMAP ishchi asos qilib olindi (289 → 347
  qator). `.bak` fayli o'chirildi (endi asosiy faylga singdirilgan).
- Qo'shildi: `extract_domain(email_or_url)` — email/URL'dan domenni ajratadi.
- Qo'shildi: `async def link_to_submission(session, parsed)`:
  - Faqat `SubmittedOpportunity.status == "submitted"` yozuvlarni ko'radi
    (`Opportunity` bilan join).
  - Domen mosligi **aniq**: `sender_domain == opp_domain` yoki
    `sender_domain.endswith("." + opp_domain)`. Eski stub'dagi
    `org_name in sender_domain` qism-satr tekshiruvi **ishlatilmadi** —
    masalan "Art Fund" tashkiloti "startfund.org" yoki "evilartfund.org"
    kabi domenlarga noto'g'ri mos kelib qolishi mumkin edi (test bilan
    tekshirildi, pastga qarang).
  - Moslik topilsa: `status = "response_received"`, `session.commit()`,
    so'ng `send_telegram_alert(...)` chaqiriladi (try/except bilan —
    Telegram xatosi email oqimini to'xtatmaydi).
  - `check_account_once()` ichida har bir yangi saqlangan xat uchun,
    broadcast'dan keyin, `session.commit()` qilingandan SO'NG chaqiriladi.
- `check_account_locked` — `.bak`da allaqachon `async def` edi (stub'da sync
  `-> bool: return False` edi). Hech narsa qo'shimcha o'zgartirilmadi, lekin
  endi `routers/email.py:223`dagi `await check_account_locked(...)` to'g'ri
  ishlaydi (avval `TypeError: object bool can't be used in 'await'` berardi).
- Sync SQLite ulanish (`create_engine(f"sqlite:///...")`,
  `sessionmaker(bind=...)`) butunlay olib tashlandi — endi faqat
  `database.py`dagi `async_session_factory` ishlatiladi (loyihaning umumiy
  naqshi, "database is locked" muammosi oldini olish uchun).
- `try/except (ImportError, AttributeError): return []` jim-yutish patterni
  olib tashlandi — `email_client.fetch_new` va
  `opportunity.delivery.send_telegram_alert` endi oddiy importlar, import
  xato bo'lsa ilova ochiq-oydin yiqiladi.

**`backend/app/opportunity/delivery.py`**
- Qo'shildi: `async def send_telegram_alert(text: str) -> bool`:
  - `OWNER_ID`ni (`owner_id()`) maqsad chat sifatida oladi; yo'q bo'lsa
    `False` bilan jim qaytadi (log ogohlantirish bilan).
  - Avval bot klientini (`get_bot_client()`) sinab ko'radi (bot rejimi);
    bo'lmasa `telethon_client.get_client()` orqali ishlayotgan userbot
    klientini oladi.
  - Klient umuman topilmasa (ulanmagan) — jim `False`.
  - Topilsa, mavjud `send_to_chat(client, chat_id, text)` orqali yuboradi
    (FloodWait + markdown fallback avtomatik ishlaydi, chunki `send_to_chat`
    ichidan chaqiriladi).
  - Hech qachon istisno ko'tarmaydi chaqiruvchiga (try/except bilan o'ralgan).

## Tegilmagan narsalar (keyingi stagelar uchun, promptda ko'rsatilganidek)

- `email_client.py` ichidagi `BASELINE_COUNT`, triage integratsiyasi,
  `store.py` dagi "email_admissions" hisoblash xatosi, Fernet almashtirish —
  булар stage 7/8 ko'lamida, bu stage ularga tegmadi.
- `check_interval` asosidagi polling loop (fon tsikli) — bu allaqachon
  `.bak`da `email_worker_loop()` ichida mavjud (`poll_seconds()` orqali), lekin
  **faqat email uchun**. Telegram/grant tomonidagi umumiy `check_interval`
  polling (Stage 3 mavzusi) bu stage'ga kirmaydi — Stage 3 shundan boshlasin.
- `briefing_service.py`dagi o'xshash `except (ImportError, AttributeError)`
  pattern **tegilmadi** (email_worker.py'dan tashqarida, ko'lamdan tashqari).

## Sinovdan o'tkazildi (bu konteyner ichida, lokal)

- `email_worker.py` toza import qilindi (sync engine/stub izlari yo'q).
- `check_account_locked` va `link_to_submission` — ikkalasi ham haqiqiy
  `async def` ekani tasdiqlandi (`inspect.iscoroutinefunction`).
- `tests/test_email_worker_pure.py` (mavjud, o'zgartirilmagan) — **barcha 5
  tekshiruv o'tdi** (havolalar, compose, backoff, poll_seconds, kelajak sana).
- Qo'shimcha vaqtinchalik integratsiya testi (in-memory SQLite,
  `tests/`ga qo'shilmadi — faqat tekshiruv uchun) orqali `link_to_submission`:
  - Aniq domen moslik ✅ (`grants@artfund.org` → "artfund.org" ga mos keladi).
  - Subdomen moslik ✅ (`noreply@mail.artfund.org` → "artfund.org" ga mos).
  - O'xshash-lekin-boshqa domen ❌ to'g'ri rad etildi
    (`someone@evilartfund.org` "artfund.org" ga mos KELMAYDI — eski
    qism-satr pattern bilan bu NOTO'G'RI mos kelib qolardi).
  - Ikkinchi (ro'yxatdagi boshqa) topshiriq domeni bilan aralashmadi.
- `pytest tests/ -q` to'liq ishga tushirildi: email bilan bog'liq testlar
  (`test_email_client.py`, `test_email_crypto.py`,
  `test_email_worker_pure.py`) — hammasi OK. `test_opportunity_engine.py`,
  `test_triage.py` va `test_media_analyzer.py`dagi muvaffaqiyatsizliklar —
  **bu stage'dan oldin ham mavjud edi**, `email_worker.py`/`delivery.py`ga
  aloqasi yo'q (pytest-asyncio event-loop konfiguratsiyasi va boshqa
  kutubxona/fixture muammolari, boshqa modullarda). Stage 9 (testlar) ko'lamida.

## Stage 3 uchun eslatma

- Grant davriy tekshiruvi (polling, `check_interval`) — email'dan ALOHIDA,
  umumiy/grant tomonidagi fon tsiklini yoki `main.py`dagi
  `_start_task(...)` naqshini ko'rib chiqish kerak bo'lishi mumkin.
- `email_worker_loop()` (email uchun) allaqachon ishlaydi va o'z
  `poll_seconds()`/backoff mexanizmiga ega — Stage 3 buni o'zgartirmasligi
  kerak, agar aniq talab bo'lmasa.
- `send_telegram_alert` endi `opportunity/delivery.py`da mavjud — agar Stage
  3/4 boshqa joylarda ham shunga o'xshash ogohlantirish kerak bo'lsa, shuni
  qayta ishlatish mumkin (wrapper qilib emas, to'g'ridan-to'g'ri import).

## Tekshirish checklist

- [ ] IMAP akkaunt qo'shib, "Hozir tekshirish" (`check-now`) tugmasini
      bosing — 500 xato bermasligi kerak (avval `check_account_locked`
      sync bo'lgani uchun `TypeError` berardi).
- [ ] `SubmittedOpportunity.status == "submitted"` bo'lgan yozuv yarating,
      shu tashkilot domenidan (yoki subdomenidan) test xat yuboring —
      status avtomatik `response_received`ga o'tishi va Telegram'ga
      ogohlantirish kelishi kerak (agar `OWNER_ID` va Telegram klienti
      sozlangan bo'lsa).
- [ ] O'xshash lekin boshqa domendan (masalan asl domen `fund.org` bo'lsa,
      `somethingfund.org`dan) xat kelsa — **mos kelmasligi** kerak (eski xato
      tuzatilgani tekshiriladi).
- [ ] `.env`da `OWNER_ID` yo'q bo'lsa, email tekshiruvi baribir ishlashi
      kerak (alert jim o'tkazib yuboriladi, email flow to'xtamaydi).

---

# HANDOFF — Stage 3 tugadi

## O'zgargan fayllar

**`backend/app/main.py`**
- Qo'shildi: `_opportunity_poll_loop()` — promptda berilgan tuzilma bo'yicha
  (`opportunity_store.get_settings()`, `get_client()`,
  `opportunity_catch_up(client, message_manager.broadcast)`). 30s dastlabki
  kutishdan keyin doimiy tsikl: `enabled=True` bo'lsa `catch_up` chaqiradi,
  keyin `check_interval` (min 60s) bilan uxlaydi. `RuntimeError` (Telethon
  hali ulanmagan) — 30s dan keyin qayta urinadi. Kutilmagan xato — log +
  300s dan keyin qayta urinadi. `CancelledError` — qayta ko'tariladi
  (to'xtatish ishlashi uchun).
- `lifespan` ichida `_start_task(app, "opportunity_poll", _opportunity_poll_loop)`
  qo'shildi (`opportunity_catchup`dan keyin). Eski `_opportunity_catchup_once`
  o'zgarishsiz qoldi (ishga tushgandagi bir martalik tez tiklash uchun) —
  ikkalasi parallel ishlaydi: catchup_once tezroq (Telethon ulanishi
  tugashi bilanoq), poll_loop esa doimiy davriy tekshiruv.
- Import yoki boshqa funksiya nomlari o'zgartirilmadi — hammasi allaqachon
  import qilingan edi (`opportunity_store`, `opportunity_catch_up`,
  `get_client`, `message_manager`).

**`backend/app/opportunity/engine.py`**
- `handle_incoming()` qayta tuzildi: `last_seen` yangilanishi endi
  funksiya oxiridagi `try/finally` blokida (ishlov natijasidan qat'i
  nazar — muvaffaqiyat, rad etish yoki istisno — baribir yangilanadi).
  Oldin (X-10) bu post **parse/evaluate/AI/saqlashdan OLDIN** yangilanardi:
  agar o'rtada xato chiqsa, post "ko'rilgan" deb qolib, qayta urinib
  bo'lmas edi. Endi: agar ishlov vaqtida kutilmagan istisno chiqsa (masalan
  AI chaqiruvida), `finally` baribir `last_seen`ni yangilaydi (xabar hali
  ham "ko'rilgan" — bu catch_up uchun xavfsiz chekinish xatti-harakati,
  cheksiz qayta-urinish tsiklidan ko'ra afzal), lekin asosiy fikr: endi bu
  **ataylab va aniq joyda** sodir bo'ladi, parse/evaluate orasida tasodifan
  emas. Testlar (`test_handle_incoming_match_and_dedup` va h.k.) o'zgarishsiz
  o'tadi, chunki muvaffaqiyatli holatda natija bir xil.
- Boshqa mantiq (parse, evaluate, AI, saqlash tartibi) tegilmadi.

**`backend/tests/test_opportunity_bot_and_lifespan.py`**
- `lifespan_isolation()` testidagi `background_tasks` nomlari to'plamiga
  `"opportunity_poll"` qo'shildi (yangi fon vazifa paydo bo'lgani uchun),
  aks holda bu test endi muvaffaqiyatsiz bo'lar edi.

## Tegilmagan narsalar

- `telethon_client.py`dagi `catch_up=True` — stage 1 da allaqachon qo'shilgan
  edi, tekshirildi, joyida.
- Yangi kanal uchun baseline (eski postlar o'tkazib yuborilishi) —
  `engine.catch_up()` ichida o'zgarishsiz, bu to'g'ri xatti-harakat.
  Hozircha faqat backend logida (`logger.info("Baseline: %s #%s", ...)`)
  ko'rinadi — frontendda alohida xabar/belgi yo'q. Buni frontendga chiqarish
  (masalan "Bu kanal uchun faqat bugundan boshlab kuzatiladi" degan
  bildirishnoma) ushbu stage ko'lamidan tashqarida qoldirildi — agar kerak
  bo'lsa alohida kichik stage sifatida qilish mumkin (routers/opportunity.py
  dagi `add_channel` javobiga bitta maydon qo'shish kifoya qiladi).
- AI darvoza mantig'i, parser/matcher — tegilmadi (stage 5 mavzusi).

## Poll loop qanday ishlaydi

- Ilova ishga tushgandan 30s keyin boshlanadi (Telethon ulanishi uchun
  vaqt beriladi).
- Har tsiklda: sozlamalarni o'qiydi → `enabled=True` bo'lsa bitta
  `catch_up` yurishi qiladi (barcha kanallar) → keyin
  `max(check_interval, 60)` soniya kutadi.
- `enabled=False` bo'lsa ham tsikl davom etadi (shunchaki `catch_up`
  chaqirilmaydi), keyingi safar `enabled` yoqilsa avtomatik ishlay
  boshlaydi — qayta ishga tushirish shart emas.
- Botdan/UI orqali `check_interval` o'zgartirilsa — joriy uyqudan keyingi
  tsiklda yangi qiymat o'qiladi (darhol emas, joriy kutish tugagandan keyin).

## Stage 4 uchun eslatma

- Auto-responder qolgan qattiq kodlari: shablon/ko'rsatilgan javob mosligi,
  chat turi tekshiruvi — stage 1 da faqat `source_id==14` va
  `direction != "in"` tuzatildi, qolganlari stage 4 da.
- `opportunity/auto_responder.py.bak` va `gemini_analyzer.py.bak` hamon
  repo'da turibdi (ular bu stage doirasida ishlatilmadi/tegilmadi) — agar
  stage 4/5 ularni asosiy faylga singdirishi kerak bo'lsa, stage 2 dagi
  `email_worker.py.bak` bilan qilingan ishga o'xshash yondashuv qo'llash
  mumkin (avval taqqoslab chiqish kerak, chunki auto_responder.py allaqachon
  stage 1 da qisman tuzatilgan — `.bak` eski versiya bo'lishi mumkin).

## Tekshirish checklist

- [ ] Ilovani ishga tushiring, logda ~30s dan keyin poll loop ishga
      tushganini kuzating (agar `enabled=True` bo'lsa, `catch_up` chaqirilishi
      kerak; `enabled=False` bo'lsa indamay uxlashda davom etadi).
- [ ] Botdan/UI orqali `check_interval`ni masalan 90 soniyaga o'zgartiring —
      keyingi tsikl shu interval bilan ishlayotganini logdan (yoki vaqtni
      o'lchab) tekshiring.
- [ ] Ilovani to'xtatganda (`Ctrl+C` yoki deploy restart) poll loop ham
      boshqa fon vazifalar bilan birga toza bekor qilinishini tekshiring
      (xato/log chiqmasligi kerak).
- [ ] Bitta kanalda post ishlov vaqtida xato bersa (masalan vaqtincha AI
      xatosi) — keyingi `catch_up` yurishida o'sha post qayta ko'rinmasligini
      (yoki ataylab ko'rinishini, agar xato darajasi shuni talab qilsa)
      kutilgan tarzda ishlashini tasdiqlang.
- [ ] `pytest tests/test_opportunity_engine.py tests/test_opportunity_bot_and_lifespan.py`
      ishga tushiring — ikkalasi ham o'tishi kerak (engine testlari
      o'zgarishsiz o'tadi, lifespan testi yangilangan task nomi bilan o'tadi).
