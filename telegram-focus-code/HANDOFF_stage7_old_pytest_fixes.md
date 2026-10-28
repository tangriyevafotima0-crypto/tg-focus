# HANDOFF — Stage 7 tugadi

## Vazifa

Stage 6 oxirida aniq "keyingi stage uchun" ochiq xato qolmagan edi. Shuning
uchun bu stage so'ralgan: "ishlashiga nima halaqit bersa va to'g'ri
ishlamasa" — ya'ni butun test to'plamini chuqur tekshirib, haqiqiy
(soxta emas) xatolarni topish va tuzatish.

## Topilgan muammo 1: pytest to'rtta faylni noto'g'ri kolleksiya qilardi

`backend/tests/` ichidagi 4 ta fayl (`test_opportunity.py`,
`test_opportunity_engine.py`, `test_triage.py`, `test_media_analyzer.py`)
pytest uchun emas — ularning har birining boshida ochiq yozilgan
("pytest EMAS — oddiy assert, `__main__` orqali ishga tushadi") yoki shu
naqshga amal qiladi (qo'lda `assert`, oxirida `if __name__ == "__main__"`
yoki hatto modul darajasida `asyncio.run(...)` chaqiruvi).

`pytest tests/` ularni baribir avtomatik kolleksiya qilishga urinib,
muvaffaqiyatsiz bo'lardi: bu fayllar o'z event-loop'ini qo'lda boshqaradi
(`asyncio.get_event_loop().run_until_complete(...)` yoki modul darajasidagi
`asyncio.run()`), bu esa pytest'ning o'z event-loop boshqaruvi bilan
to'qnashadi. Natija: **21 ta soxta "FAILED"** (`test_opportunity_engine.py`
7 tasi, `test_triage.py` 14 tasi) va 1 ta kolleksiya xatosi
(`test_media_analyzer.py`, modul darajasidagi `asyncio.run` tufayli) —
holbuki bu testlarning barchasi o'zining mo'ljallangan tarzida
(`python3 tests/<fayl>.py`) **muvaffaqiyatli o'tardi**.

Bu — Stage 2 handoff'da "pytest-asyncio konfiguratsiya muammosi" deb
yozilgan narsaning aniq sababi edi: muammo konfiguratsiyada emas, bu
fayllarning umuman pytest uchun mo'ljallanmaganida edi.

### Tuzatish

**Yangi: `backend/pytest.ini`**
- `addopts` orqali shu 4 ta faylni `--ignore` qilib qo'ydi — ular endi
  pytest kolleksiyasidan butunlay chetlatiladi (ular hali ham o'z
  skript sifatida `python3 tests/<fayl>.py` orqali to'liq ishlaydi va
  tekshiriladi, pastga qarang).
- Haqiqiy pytest testlari (`test_opportunity_bot_and_lifespan.py`,
  `test_dashboard_formatter.py`, `test_email_client.py`,
  `test_email_crypto.py`, `test_email_worker_pure.py`) tegilmadi —
  ularga hech qanday maxsus asyncio sozlamasi kerak emas edi
  (allaqachon to'g'ri yozilgan).

Natija: `pytest tests/` endi **26 passed, 0 failed, 0 error** (avval: 21
failed + 1 collection error).

## Topilgan muammo 2: `media_analyzer.py` ↔ `dashboard_formatter.py` o'rtasida haqiqiy nomuvofiqlik

Bu soxta test xatosi emas edi — **ishlab turgan kodda haqiqiy kamchilik**:

`dashboard_formatter.py:format_media_analysis()` (hujjat/PDF shoxobchasi,
203-qator atrofida) allaqachon `result.get("analysis")` kutib, undan
`deadline`, `amount`, `requirements`, `summary` kalitlarini o'qirdi — lekin
`media_analyzer.py:analyze_document()` **hech qachon `"analysis"` kalitini
qaytarmasdi**. Demak PDF orqali kelgan har qanday imkoniyat uchun
dashboard doim bo'sh/standart qiymatlar bilan ko'rsatilardi ("Ko'rsatilmagan"
barcha joyda) — Gemini to'g'ri javob bergan taqdirda ham. Buni
`tests/test_media_analyzer.py` (8-band) ochib tashladi, lekin muammoning
o'zi test fayli yozilishidan oldin ham production kodda mavjud edi.

### Tuzatish

**`backend/app/opportunity/media_analyzer.py`**
- `_read_and_encode()`: endi `(b64, xato)` juftlik qaytaradi — fayl
  umuman mavjud bo'lmasa `"Fayl topilmadi"`, bor-u o'qib bo'lmasa
  `"Faylni o'qib bo'lmadi"` (ikkalasi avval bitta umumiy xabarga
  qo'shilib ketgan edi). 3 ta chaqiruvchi (`analyze_image`,
  `analyze_document`, `analyze_audio`) shu aniqroq xabarni ishlatadi.
- Yangi modul konstantasi: `MAX_FILE_BYTES = 15 * 1024 * 1024` (15 MB) —
  Gemini'ga yuborishdan oldin hujjat hajmini tekshirish uchun.
- Yangi: `_DOCUMENT_SUPPORTED_EXTS` (`.pdf` + matnli kengaytmalar) —
  `analyze_document()` endi qo'llab-quvvatlanmaydigan kengaytmani
  (`.docx` va h.k.) Gemini'ga umuman yubormasdan, aniq xato bilan
  (`"Qo'llab-quvvatlanmaydigan fayl turi (.docx)"`) rad etadi.
- `analyze_document()`: endi fayl hajmini oldindan tekshiradi — undan
  katta fayl uchun aniq xato (`"Fayl juda katta (...) — ruxsat etilgan
  chegaradan oshdi"`), Gemini chaqirilmasdan.
- `analyze_document()`: matn chiqarilgandan keyingi Gemini so'rovi endi
  aniq JSON sxema so'raydi (`deadline`, `amount`, `requirements`,
  `summary`) va `_extract_json()` orqali `"analysis"` kalitiga
  joylaydi; `"text"` maydoni hamon hujjatdan chiqarilgan xom matn
  (o'zgarishsiz, `dashboard_formatter.py` buni ham ishlatadi). Ikkinchi
  yo'l (matn chiqmagan, to'g'ridan-to'g'ri Gemini multimodal) ham
  `"analysis": None` bilan izchil shaklga keltirildi.
- `analyze_audio()`: Gemini barcha modellarda ham javob bermasa, endi
  natijaga `"unsupported": True` qo'shiladi (avval faqat `error` matni
  bor edi, bayroq yo'q edi).

## Tegilmagan, lekin tasdiqlangan narsalar

- `app/telethon_client.py:158,166,174` — `media_analyzer`ning uchta
  funksiyasini chaqiradigan yagona haqiqiy joy. `analyze_document()`
  faqat `path.suffix.lower() == ".pdf"` bo'lsa chaqiriladi (173-qator) —
  demak yangi `.docx` rad etish yo'li bu chaqiruvchi orqali hech qachon
  ishga tushmaydi (xavfsiz, orqaga mos keluvchanlik buzilmadi).
- `dashboard_formatter.py:format_media_analysis()` — photo/audio
  shoxobchasi faqat `result.get("text")`ni o'qiydi va yuqorida
  `result.get("ok")` orqali qo'riqlangan — yangi `"unsupported"` kaliti
  bu yo'lga ta'sir qilmaydi (`ok=False` bo'lganda allaqachon `None`
  qaytadi).
- `store.py`dagi `enabled=False`, `delivery.py`, poll loop, Stage 6'dagi
  `is_relevant` tuzatishi — barchasi tekshirildi, o'zgarishsiz, hamon
  to'g'ri ishlaydi.

## Sinovdan o'tkazildi

```
cd backend && pytest tests/ -q
→ 26 passed, 1 warning (StarletteDeprecationWarning, bu stage'ga aloqasi yo'q)

python3 tests/test_opportunity.py          → ALL TESTS PASSED
python3 tests/test_opportunity_engine.py   → ALL ENGINE TESTS PASSED
python3 tests/test_triage.py               → HAMMASI OK (14/14)
python3 tests/test_media_analyzer.py       → HAMMASI OK (9/9, barchasi, shu
                                               jumladan yangi .docx rad etish,
                                               hajm chegarasi va JSON tahlil
                                               bandlari)
```

Qo'shimcha qo'lda tekshiruv: `format_media_analysis("document", ...)` endi
haqiqiy `deadline`/`amount`/`requirements` qiymatlari bilan to'ldirilgan
dashboard qaytarishi tasdiqlandi (mock Gemini JSON javobi bilan) — avval
hamisha bo'sh/standart qiymatlar qaytardi.

## Stage 8 uchun eslatma

- `test_strict_filter.py` (backend root'da) — jonli Telegram sessiyasi
  talab qiladigan qo'lda diagnostika skripti, hamon avtomatlashtirilmagan
  va bu stage doirasidan tashqarida qoldi.
- `frontend/app.js.bak` — `app.js`ning eskirgan versiyasi (joriy
  `app.js` undan 96 qator ko'p, filtr/eksport funksiyalari qo'shilgan).
  Stage 2'dagi `email_worker.py.bak` bilan bir xil holat, lekin bu safar
  frontend tomonida — hali tozalanmadi, chunki bu kod xatosi emas, oddiy
  keraksiz fayl; xohlasa, keyingi stage uni o'chirib tashlashi mumkin.
- `MAX_FILE_BYTES` qiymati (15 MB) o'zim tanlagan, loyihada oldin aniq
  belgilanmagan edi — agar haqiqiy muhitda boshqa chegara kerak bo'lsa
  (masalan Telegram'ning o'zi 20 MB cheklovi bor), oson o'zgartirish
  mumkin (bitta konstanta).
- Gemini JSON tahlil formati (`deadline`/`amount`/`requirements`/`summary`)
  `dashboard_formatter.py`ning kutgan sxemasiga mos qilib tanlandi —
  agar kelajakda dashboard formatini o'zgartirish kerak bo'lsa, ikkala
  faylni birga yangilash kerak.

## Tekshirish checklist

- [ ] `cd backend && pytest tests/ -q` ishga tushiring — 26 passed
      bo'lishi kerak, FAILED/ERROR bo'lmasligi kerak.
- [ ] Haqiqiy PDF (GEMINI_API_KEY bilan) yuklab, dashboard'da endi
      haqiqiy "Muddat:"/"To'lov/Summasi:" qiymatlari ko'rinishini
      tekshiring (avval doim "Ko'rsatilmagan" edi).
- [ ] `.docx` fayl yuborishga urinib ko'ring (agar frontend/bot orqali
      mumkin bo'lsa) — endi aniq "qo'llab-quvvatlanmaydi" xabari
      qaytishi kerak, soxta/chala natija emas.
