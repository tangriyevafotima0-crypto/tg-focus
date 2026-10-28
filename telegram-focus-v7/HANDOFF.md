# HANDOFF — v7: Stage 6 + Stage 7 (haqiqiy rejadagi vazifalar) tugadi

## Muhim ogohlantirish — nima uchun bu fayl kerak bo'lib qoldi

Yuklangan `HANDOFF_stage6.md` va `HANDOFF_stage7.md` (endi
`HANDOFF_stage6_old_pytest_fixes.md` / `HANDOFF_stage7_old_pytest_fixes.md`
deb saqlandi) **asl stage rejasidagi (`00-STAGE-PLAN.md`,
`stage-6-prompt.md`, `stage-7-prompt.md`) vazifalarni bajarmagan**. O'sha
sessiyalar o'rniga pytest konfiguratsiyasi va `media_analyzer.py` ↔
`dashboard_formatter.py` nomuvofiqligini tuzatgan — bu foydali ish, lekin
Stage 6 uchun rejalashtirilgan "muzlatuvchi chaqiruvlar + Gemini
xavfsizligi" va Stage 7 uchun rejalashtirilgan "models.py/vaqt mintaqasi"
vazifalariga umuman tegilmagan.

Tekshiruv natijasida (yuklangan v{N} kodida to'g'ridan-to'g'ri grep orqali)
tasdiqlandi: barcha 6+5=11 ta reja bandi hali ham kodda tuzatilmagan holda
turardi. Shu sababli ushbu v7 — **Stage 6 va Stage 7'ni asl reja bo'yicha
haqiqatan bajaradi**, pytest/media_analyzer tuzatishlarini (ular to'g'ri va
foydali edi) saqlab qolgan holda.

Eski `HANDOFF.md` (Stage 1-3 tarixi) `HANDOFF_history_stages1-3.md` deb
saqlab qolindi — Stage 4/5 uchun alohida fayl topilmadi (stage plan
rejasiga ko'ra har safar yangilanishi kerak edi, lekin ko'rinib turibdiki
Stage 4'dan keyin to'xtab qolgan).

## STAGE 6 — Muzlatuvchi chaqiruvlar va Gemini xavfsizligi

### 1. Event loop bloklanishi — `asyncio.to_thread` qo'shildi

- `engine.py:_ai_confirms()` — `analyze_opportunity(...)` endi
  `await asyncio.to_thread(analyze_opportunity, ...)` orqali chaqiriladi
  (avval sync, event loop'ni Gemini+scrape javob bergunicha bloklardi).
- `triage.py:classify_message()` — `_gemini_classify(text)` endi
  `await asyncio.to_thread(_gemini_classify, text)` orqali chaqiriladi.
- `routers/ai_chat.py` — `get_ai_welcome()` va `post_ai_chat()` ikkalasi
  ham `generate_welcome_briefing`/`generate_chat_response`ni
  `asyncio.to_thread` orqali chaqiradi endi.
- `media_analyzer.py` — bu fayl allaqachon (oldingi "stage 6/7"
  sessiyalarida) `to_thread` ishlatardi, tegilmadi.

### 2. Vaqt chegarasi va parallellik

- `gemini_analyzer.py`: `call_gemini_raw` va `scrape_webpage` ichidagi
  vaqt chegarasi 25s'dan `_HTTP_TIMEOUT = 9.0`ga tushirildi.
- Yangi `_EXTERNAL_CALL_SEMAPHORE = threading.Semaphore(2)` — bir vaqtning
  o'zida ko'pi bilan 2 ta tashqi so'rov (Gemini yoki scrape) yuboriladi.
  (`threading.Semaphore` ishlatildi, `asyncio.Semaphore` emas — chunki bu
  funksiyalar sync va `to_thread` orqali turli thread'larda chaqirilishi
  mumkin.)

### 3. SSRF himoyasi

- Yangi modul: **`backend/app/opportunity/net_safety.py`** —
  `assert_public_url(url)` funksiyasi: sxemani (`http`/`https`) tekshiradi,
  `localhost`/literal IP/DNS orqali topilgan IP manzillarni
  (`is_private`, `is_loopback`, `is_link_local` — shu jumladan
  `169.254.169.254` cloud-metadata, `is_multicast`, `is_reserved`,
  `is_unspecified`) blokdaydi. `BlockedUrlError` ko'taradi.
- `gemini_analyzer.py:scrape_webpage()` va `scraper.py:scrape_url()`
  ikkalasi ham chaqirishdan oldin `assert_public_url()`ni ishlatadi;
  bloklangan holatda aniq xabar bilan (qotib qolmasdan) qaytadi.
- `gemini_analyzer.py:scrape_webpage()`: `verify=False` → `verify=True`
  (TLS tekshiruvi yoqildi).
- `scraper.py:scrape_url()`: `httpx.AsyncClient(...)` ga `verify=True`
  aniq qo'shildi (avval standart holatda ham True edi, lekin aniq
  ko'rsatilmagan edi — endi aniq).

Eslatma: sinov muhitida (bu konteynerda) tashqi DNS yo'q, shuning uchun
`test_opportunity_engine.py` ishga tushganda haqiqiy domenlarga (masalan
`forms.gle`) so'rov "Hostni aniqlab bo'lmadi" deb bloklanadi — bu kutilgan
va **to'g'ri** xavfsizlik xatti-harakati (DNS topilmasa — ruxsat
berilmaydi), xato emas. Haqiqiy muhitda (internet bilan) oddiy tashqi
saytlar normal ishlaydi, faqat ichki/lokal IP'lar bloklanadi.

### 4. Xatolarni yutmaslik

- `call_gemini_raw` ichidagi `except Exception: continue` olib
  tashlandi. Endi:
  - `urllib.error.HTTPError` — 429 (limit), 404 (model topilmadi) va
    boshqa HTTP kodlar alohida-alohida `logger.warning` bilan yoziladi.
  - `urllib.error.URLError` / `TimeoutError` — vaqt tugashi va tarmoq
    xatosi farqlanadi.
  - Boshqa kutilmagan xatolar — `logger.exception` (to'liq traceback
    bilan).
  - Bo'sh javob (barcha modellar muvaffaqiyatsiz) ham alohida
    `logger.warning` bilan qayd etiladi.

### 5. API kalit xavfsizligi

- `call_gemini_raw`: API kalit endi URL query string'ida (`?key=...`)
  emas, `x-goog-api-key` so'rov sarlavhasida yuboriladi. Bu URL endi
  loglarga/proksi tarixiga tushib qolganda kalitni oshkor qilmaydi.
- **Muhim:** `urllib.request` saqlab qolindi (httpx'ga o'tkazilmadi) —
  chunki `tests/test_triage.py` va `tests/test_media_analyzer.py`
  `urllib.request.urlopen`ni mock qiladigan tarzda yozilgan, httpx'ga
  o'tish ularni buzgan bo'lardi (bu amalda sinab ko'rildi va tasdiqlandi:
  birinchi urinishda `AttributeError: module 'httpx' has no attribute
  'post'` chiqdi, shuning uchun qaytarildi). Xavfsizlik maqsadi (kalitni
  sarlavhaga ko'chirish) `urllib.request` bilan ham to'liq bajariladi.

### 6. Soxta zaxira javoblar olib tashlandi

- `analyze_opportunity_deeply()`: avval Gemini umuman javob bermasa
  (kalit yo'q, tarmoq xatosi, barcha modellar 429/404) yoki JSON buzilgan
  bo'lsa, funksiya **o'ylab topilgan "85% mos" (yoki "40%") natija**
  qaytarardi — bu foydalanuvchini chalg'itardi (AI haqiqatan baholagandek
  ko'rinardi). Endi aniq holat qaytariladi:
  ```python
  {
      ...,
      "is_relevant": None,
      "match_percentage": None,
      "ai_available": False,   # <- yangi maydon
      ...
  }
  ```
- `engine.py:_ai_confirms()` yangilandi: `result.get("ai_available") is
  False` holatini aniq tekshiradi va bu holatda **bloklamaydi** (regex
  natijasiga tayanadi) — avval `match_percentage=None or 0 = 0 <
  _AI_MIN_SCORE` natijasida bexosdan hamma narsa rad etilishi mumkin edi.
- Regex zaxira qoliplari aniqlashtirildi: `fee`/`\$` → `\bfee\b` (so'z
  chegarasi bilan), xuddi shunday `free`/`bepul` va h.k.

## STAGE 7 — Modellar, vaqt mintaqasi, tozalash

### 1. Vaqt mintaqasi (X-16)

- `models.py:217,239-240` dagi `datetime.utcnow` (eskirgan, timezone-siz)
  chaqiruvlari loyihada allaqachon mavjud bo'lgan `utc_now()` ga
  almashtirildi (`SubmittedOpportunity.submitted_at`,
  `Opportunity.created_at`, `Opportunity.updated_at`).
- `store.py`dagi qo'lda `tzinfo` qo'shish endi **kerak emas** (ustunlar
  endi `DateTime(timezone=True)`), lekin xavfsizlik uchun saqlab
  qolindi — eski (migratsiyagacha yozilgan) qatorlarda naive datetime
  bo'lishi mumkin, shuning uchun `if deadline.tzinfo is None:` tekshiruvi
  hamon bor, faqat izoh bilan nega u endi "faqat ehtiyot chorasi"
  ekani tushuntirildi.

### 2. engine.py — `today`/`post_date` UTC nomuvofiqligi tuzatildi

- Avval: `today = date.today()` (server mahalliy vaqt mintaqasi) vs
  `post_date = message_date.date()` (Telethon UTC beradi) — ikkalasi
  kun chegarasida har xil kun bo'lib qolishi mumkin edi.
- Endi: ikkalasi ham UTC. **Tanlov:** mahalliy (Asia/Tashkent) emas, UTC
  tanlandi — chunki loyihaning qolgan qismi (barcha `Mapped[datetime]`
  ustunlar, `utc_now()`) allaqachon UTC standart qilib olingan; mahalliy
  vaqt mintaqasiga o'tish qolgan hamma joyni ham o'zgartirishni talab
  qilardi (katta, rejadan tashqari refaktor bo'lardi). `message_date`
  naive kelsa ham (ehtiyot chorasi) UTC deb hisoblanadi.
- `date` importi `engine.py`dan olib tashlandi (endi ishlatilmaydi,
  `datetime`/`timezone` qoldi).

### 3. models.py tozalash (X-15)

- Fayl boshidagi takrorlangan importlar (3x `Column` import qatori, 3x
  `datetime` import, 2x `relationship`) bitta toza blokka birlashtirildi.
- `Opportunity` va `SubmittedOpportunity` — eski `Column(...)` uslubidan
  qolgan klasslar bilan bir xil `Mapped[...]` / `mapped_column(...)`
  uslubiga o'tkazildi. Relationship'lar (`opportunity`/`submissions`)
  saqlanib qoldi, faqat tip annotatsiyalari bilan.
- Sxema SQLite'da sinab ko'rildi (`Base.metadata.create_all`) — barcha 11
  ta jadval muammosiz yaratildi.

### 4. store.py "email_admissions" hisoblash xatosi

- Avval: `Message.channel == "email"` bo'yicha **barcha** arxivlanmagan
  emaillar sanalardi, "admissions_count" nomiga qaramay — oddiy
  newsletter yoki har qanday email ham shu sonni oshirardi.
- Hozirgi holat: modelda emaillar uchun alohida "tur/status" ustuni
  yo'q (faqat `channel`, `text` bor; subject matn boshida saqlanadi —
  `email_worker.py`dagi `_compose_text`ga qarang). **To'liq** aniq
  filtr DB migratsiyasiz imkonsiz (yangi ustun kerak bo'lardi, bu
  rejadan tashqari katta o'zgarish). Shu sababli oraliq yechim
  qo'llanildi: qabul/ariza/stipendiya bilan bog'liq kalit so'zlar
  (`admission`, `application`, `scholarship`, `accept`, `decision`,
  `offer`, `qabul`, `ariza`, `stipendiya` va h.k.) subject qismida
  (matnning birinchi 200 belgisi) qidiriladi — faqat mos kelganlar
  sanaladi.
- **Kelgusi stage uchun eslatma:** haqiqiy to'g'ri yechim — `Message`
  jadvaliga `category`/`email_kind` ustuni qo'shish va email
  import vaqtida uni belgilash (masalan sarlavha/jo'natuvchi bo'yicha
  yoki Gemini orqali klassifikatsiya qilib). Bu alohida migratsiya
  bosqichi bo'lishi kerak.

### 5. email_client.py BASELINE_COUNT=20

- `BASELINE_COUNT` endi `EMAIL_BASELINE_COUNT` muhit o'zgaruvchisi
  orqali sozlanadi (standart qiymat hamon 20 — xatti-harakat
  o'zgarmadi, faqat ixtiyoriy qilindi).
- `email_worker.py:check_account_once()`: `result.baseline_skipped`
  (bu maydon allaqachon `FetchResult`da mavjud edi, lekin hech qayerda
  o'qilmasdi) endi tekshiriladi — agar birinchi ishga tushirishda eski
  xatlar "yangi" sifatida kelsa, aniq `logger.info` ogohlantirishi
  yoziladi (nechta xat olindi, nechtasi o'tkazib yuborildi).

## Tegilmagan, lekin tasdiqlangan narsalar

- `media_analyzer.py` — Stage 6/7 (eski, pytest-yo'naltirilgan)
  sessiyasida qilingan `to_thread`, `x-goog-api-key`, fayl hajmi/turi
  tekshiruvlari — barchasi tekshirildi, to'g'ri, tegilmadi.
- `pytest.ini` (4 ta skript-test faylni `--ignore` qilish) — tegilmadi,
  to'g'ri ishlayapti.
- `dashboard_formatter.py` ↔ `media_analyzer.py` "analysis" kaliti
  tuzatishi — tegilmadi, to'g'ri ishlayapti.
- `Opportunity.is_active` — `store.py:get_current_system_facts()` buni
  ishlatadi, lekin `models.py`da bunday ustun **yo'q**. Bu reja
  doirasidan tashqari, lekin e'tiborga olinishi kerak — agar bu yo'l
  (top_opp_result qismi, `urgent_sub` topilmaganda) ishga tushsa,
  `AttributeError` berishi mumkin. Keyingi stage buni ko'rib chiqishi
  kerak.

## Sinovdan o'tkazildi

```
cd backend && python3 -m pytest tests/ -q
→ 26 passed, 1 warning (StarletteDeprecationWarning, aloqasi yo'q)

python3 tests/test_opportunity.py          → ALL TESTS PASSED
python3 tests/test_opportunity_engine.py   → ALL ENGINE TESTS PASSED
                                              (SSRF guard forms.gle'ni to'g'ri
                                              bloklaydi — bu konteynerda DNS yo'q)
python3 tests/test_triage.py               → HAMMASI OK (14/14)
python3 tests/test_media_analyzer.py       → HAMMASI OK (9/9)
```

Qo'shimcha tekshiruv:
```
python3 -c "... Base.metadata.create_all ..."
→ Schema created OK — barcha 11 ta jadval (sources, messages, opp_profile,
  opp_settings, opp_channels, opp_sent, opp_stats, opp_groups,
  email_accounts, submitted_opportunities, opportunities)
```

## Stage 8 uchun eslatma

Asl rejadagi Stage 8 — "Xavfsizlik va qolgan X-* jadvali: `auth.py`
`compare_digest`, CORS, rate limit, `UniqueConstraint`" — bu v7'da
**tegilmadi** (Stage 6/7 doirasidan tashqarida). Qo'shimcha:

- `store.py:get_current_system_facts()` dagi `Opportunity.is_active`
  mavjud bo'lmagan ustun muammosini ko'rib chiqish tavsiya etiladi
  (yuqoriga qarang).
- `email_admissions` hisoblash — hozirgi kalit-so'z evristikasi vaqtinchalik
  yechim; agar aniqlik muhim bo'lsa, `Message.category` ustuni qo'shish
  (migratsiya) kerak bo'ladi.
- `test_strict_filter.py` (backend root'da) — hamon qo'lda diagnostika
  skripti, avtomatlashtirilmagan, bu stage doirasidan tashqarida qoldi
  (eski handoff'larda ham shunday qayd etilgan edi).

## Tekshirish checklist

- [ ] `cd backend && python3 -m pytest tests/ -q` — 26 passed bo'lishi kerak.
- [ ] `python3 tests/test_opportunity_engine.py`, `test_triage.py`,
      `test_media_analyzer.py`, `test_opportunity.py` — barchasi OK
      bo'lishi kerak (haqiqiy internet bilan SSRF bloklanishi
      kuzatilmasligi kerak, faqat chinakam ichki/lokal manzillar uchun).
- [ ] Haqiqiy `GEMINI_API_KEY` bilan: Gemini limitga yetganda yoki
      tarmoq xatosi bo'lganda endi dashboard/UI aniq "AI mavjud emas"
      holatini ko'rsatishini tekshiring (avval soxta "85% mos" chiqardi).
- [ ] Bot ishlab turganda (real Telegram sessiyasi bilan) Gemini sekin
      javob berganda ilova boshqa so'rovlarga (masalan frontend chat)
      javob berishda davom etayotganini tekshiring (to_thread tufayli
      endi block bo'lmasligi kerak).
- [ ] `EMAIL_BASELINE_COUNT=5` kabi muhit o'zgaruvchisi bilan ishga
      tushirib, baseline sonini o'zgartirish ishlashini tekshiring.

---

# Stage 8 — davomi (v8-partial dan keyin, item 8-13)

`HANDOFF_PARTIAL.md`da qayd etilgan item 1-7 allaqachon tugagan va
sinovdan o'tgan edi (shu holicha qoldirildi, tegilmadi). Bu bo'lim item
8-13'ni yopadi.

## Tugallangan

8. **telethon_client.py X-6** — o'lik ikkinchi `except Exception:` bloki
   (`_process_message_stages` oxirida, ~qator 400-403) olib tashlandi.
   Python bitta `try`ga ikkita ketma-ket `except Exception` blokini
   ishlatolmaydi — birinchisi hamma narsani ushlab olardi, ikkinchisi hech
   qachon ishga tushmasdi (o'lik kod).

9. **telethon_client.py X-7** — `asyncio.create_task(...)` natijasi endi
   modul darajasidagi `_background_tasks: set[asyncio.Task]`ga saqlanadi
   (`_spawn_background_task()` yordamchisi orqali), `add_done_callback`
   bilan tugagach o'zini to'plamdan olib tashlaydi. Bu CPython hujjatlarida
   tavsiya etilgan naqsh — saqlanmagan task'lar GC tomonidan kutilmaganda
   bekor qilinishi mumkin.

10. **telethon_client.py X-8** — media OCR/Gemini tahlili endi saqlashdan
    KEYIN, fon vazifasida (`_process_message_stages` ichida, triage'dan
    oldin) bajariladi. Fayl yuklab olish (`_maybe_download_media` —
    `has_media_file`/`media_mime`/`media_name` ustunlari uchun kerak)
    hamon saqlashdan OLDIN qoladi, chunki bu maydonlar `Message` yozuvining
    o'zida kerak. OCR natijasi tayyor bo'lgach `record.text` va
    `media_analysis_json` yangilanadi, qayta commit qilinadi va callback
    orqali (`update_payload`ga endi `text` va `media_analysis` ham
    qo'shildi) frontendga yuboriladi.

11. **store.py X-1** — `Opportunity.is_active` modelda **hech qachon
    mavjud bo'lmagan** ustun edi (tekshirildi: `models.py`da yo'q, hech
    qanday kod `models.Opportunity` qatorlarini yaratganda uni
    o'rnatmagan). Bu so'rov ishga tushganda doim `AttributeError` berardi.
    Yangi migratsiya/ustun qo'shish o'rniga, loyihada allaqachon mavjud
    izchil naqsh ishlatildi — `briefing_service.py`dagi xuddi shu
    `Opportunity` so'rovi "muddati o'tmagan" shartini
    (`deadline IS NULL OR deadline >= now`) ishlatadi; `store.py`da ham
    xuddi shu shart qo'llanildi. Qo'shimcha: `ai_chat.py`dagi ikkita bare
    `except: pass` / rollback blokiga `logger.exception` qo'shildi — bu
    xato avval butunlay jim yutilardi.

12. **store.py X-2** — `important_sources` (`["WHARTON", "IELTS", ...]`)
    va `recommended_opportunities` (`["FLEX / UWC ..."]`) qattiq yozilgan
    ro'yxatlar edi. Endi:
    - `important_sources` — eng ko'p o'qilmagan telegram xabariga ega,
      faol (`Source.is_active=True`) manbalar DB'dan (`GROUP BY source_id`,
      `ORDER BY unread_count DESC LIMIT 5`).
    - `recommended_opportunities` — eng yuqori `match_score`ga ega, hali
      muddati o'tmagan `Opportunity.title`lar (`LIMIT 3`), xuddi 3-banddagi
      (`rule_of_one_focus`) bilan izchil shart bilan.

13. **run_backfill.py X-3** — to'liq qayta yozildi:
    - `await analyze_opportunity(...)` olib tashlandi — funksiya **sync**
      (ichida sync Gemini chaqiruvi), shuning uchun `TypeError` berardi.
      Endi `asyncio.to_thread(analyze_opportunity, ...)` bilan o'raladi
      (loyihadagi boshqa joylarga — `ai_chat.py`, `service.py` — mos
      naqsh).
    - Skript avval **mavjud bo'lmagan** xom SQLite jadvallariga
      (`monitored_channels`, `processed_messages`, `opportunities`
      ustunlari `channel_id`/`message_id`/`is_relevant` bilan) yozishga
      urinar edi — bular `app/models.py`dagi haqiqiy sxemada yo'q (haqiqiy:
      `sources`, `opportunities` — `title`/`organization`/`match_score`/
      `is_paid`/`deadline`). Endi `app.database.async_session_factory` va
      haqiqiy ORM modellari (`Source`, `Opportunity`) ishlatiladi.
    - Gemini javobidagi haqiqiy kalit nomi `match_percentage` ekani
      tasdiqlandi (`match_score` emas — `gemini_analyzer.py`ga qarang),
      shunga mos tuzatildi. `ai_available=False` holati (Gemini javob
      bermagan/xato format) alohida tekshiriladi va o'tkazib yuboriladi
      (noaniq ball bilan hech narsa saqlanmaydi).
    - `deadline` maydoni Gemini'dan erkin matn sifatida keladi (masalan
      "2025-yil 20-iyun"), ISO format EMAS — xато parslashning oldini olish
      uchun faqat aniq ISO qiymat qabul qilinadi, aks holda `None` +
      `logger.info` bilan xom matn qayd etiladi (noto'g'ri "parslangan"
      sana bazaga yozilib ketmasligi uchun).
    - Oddiy takrorlanishdan himoya: bir xil `title` bilan Opportunity
      bazada bo'lsa, qayta qo'shilmaydi (`processed_messages` kabi to'liq
      kuzatuv jadvali yo'qligi sababli — bu chegara, mukammal emas, lekin
      hozirgi sxema bilan oqilona).

## Qo'shimcha topilma (stage 9 uchun, TUZATILMADI — doiradan tashqarida)

- `run_deep_audit.py:36-37` — xuddi shu `await analyze_opportunity(...)`
  xatosi (sync funksiyani `await` qilish) bu yerda ham bor. `run_backfill.py`
  bilan bir xil tuzatish (to_thread) kerak bo'ladi.
- `run_catchup.py`, `run_deep_audit.py` — xom `sqlite3` (hatto `aiosqlite`
  ham emas — sync `sqlite3`!) bilan ishlaydi, sxemasi tekshirilmagan.
  Stage 9 rejasida (`stage-9-prompt.md`, 4-band) bularni "chaqirmasdan, kod
  o'qib" ko'rib chiqish so'ralgan — shu bosqichda qoldirildi.
- **Muhim tizimli eslatma:** loyihada `app.models.Opportunity` (DB modeli)
  jadvaliga yozadigan **birorta ham ishlaydigan kod yo'q edi** stage 8
  oxirigacha (`run_backfill.py` yagona yozuvchi edi va u butunlay buzilgan
  edi). Demak production'da `opportunities` jadvali hozirgacha har doim
  bo'sh bo'lgan bo'lishi kerak — `briefing_service.py` va
  `store.py:get_current_system_facts()` har doim "imkoniyat topilmadi"
  zaxira holatini ko'rsatgan. `run_backfill.py` endi ishlaydi, lekin u
  qo'lda ishga tushiriladigan skript — muntazam/avtomatik ishga tushirish
  (masalan cron yoki `run_history.py`/engine orqali real vaqtda) hali yo'q.
  Bu katta, reja doirasidan tashqari funksional bo'shliq — stage 9 yoki
  undan keyingi stage buni alohida ko'rib chiqishi kerak.

## Sinovdan o'tkazildi

```
cd backend && SECRET_KEY=... APP_PASSWORD=... python3 -m pytest tests/ -q
→ 26 passed, 1 warning (o'zgarishsiz — HANDOFF_PARTIAL.md'dagi bazaviy holat
  bilan bir xil, regressiya yo'q)
```

Qo'shimcha qo'lda tekshiruv (avtomatlashtirilgan test yo'q edi, chunki
`store.py`ning bu funksiyasi uchun hech qanday test mavjud emas edi):

```python
# get_current_system_facts() endi AttributeError bermasdan, haqiqiy
# in-memory SQLite bazasiga nisbatan to'g'ri natija qaytarishi tekshirildi:
# {'telegram': {'unread_count': 1, 'important_sources': ['Test Kanal']},
#  'email': {'admissions_count': 0},
#  'rule_of_one_focus': "'Test Grant' arizasini tayyorlash",
#  'recommended_opportunities': ['Test Grant']}
```

`run_backfill.py` — haqiqiy Telegram sessiyasi/`GEMINI_API_KEY` bu
muhitda mavjud emasligi sababli oxirigacha ishga tushirib ko'rilmadi
(tarmoq sandboxda Telegram/Gemini domenlariga ruxsat yo'q); faqat modul
import va sintaksis tekshirildi (xatosiz). **Stage 9 uchun eslatma:**
haqiqiy `.env` (TELEGRAM_*, GEMINI_API_KEY) va tayyor Telethon sessiyasi
bilan to'liq oxiridan-oxirigacha sinovdan o'tkazish tavsiya etiladi.

## Stage 9 nimadan boshlashi kerak

1. `tests/test_email_worker_pure.py` — `stage-9-prompt.md`da qayd
   etilganidek, eskirgan funksiyalarni qidiradi (`KeyError:
   '_extract_links'`), `email_worker.py`ning haqiqiy funksiyalariga mos
   qayta yozilishi kerak.
2. Yangi testlar: `get_current_system_facts()` (stage 8 X-1/X-2 tuzatishi)
   uchun hech qanday avtomatlashtirilgan test yo'q — faqat yuqoridagi
   qo'lda tekshiruv bor. `tests/test_opportunity_store.py` kabi fayl
   qo'shish tavsiya etiladi (muddati o'tmagan/o'tgan Opportunity, bo'sh
   baza, important_sources tartibi uchun holatlar).
3. `telethon_client.py`ning yangi fon-vazifa oqimi (X-8) uchun test —
   mock Telethon event bilan, media bor xabar saqlangandan keyin
   `media_analysis_json`ning fon vazifasida yangilanishini tekshiruvchi.
4. `run_deep_audit.py` (yuqoridagi "Qo'shimcha topilma"ga qarang) — xuddi
   shu `await analyze_opportunity` xatosini tuzatish.
5. Tekshirish checklisti (HANDOFF_PARTIAL.md'dagidan qo'shimcha):
   - [ ] `run_backfill.py`ni haqiqiy `.env` bilan birinchi marta oxirigacha
     ishga tushirib ko'ring — `opportunities` jadvaliga haqiqatan yozilishi
     kerak (avval hech qachon yozmagan).
   - [ ] Fon vazifasida OCR/Gemini tahlili tugagach frontend chatda/UI'da
     xabar matni (agar rasm/audio bo'lsa) yangilanganini tekshiring (WS/polling
     orqali `update_payload`dagi yangi `text`/`media_analysis` maydoni).
