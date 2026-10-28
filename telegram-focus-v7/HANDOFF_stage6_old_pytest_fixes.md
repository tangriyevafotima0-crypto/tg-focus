# HANDOFF — Stage 6 tugadi

## Boshlanishdagi tekshiruv

Stage 5 handoff'da ko'rsatilgan ochiq bandlarning aksariyati **kodga tegishli
emas** yoki **allaqachon bajarilgan** ekani tasdiqlandi:

- `store.py`dagi `DEFAULT_SETTINGS["enabled"] = False` — bu sozlama qiymati,
  kod xatosi emas. Tegilmadi (handoff'da aytilganidek).
- `delivery.py` — to'liq yozilgan va `engine.py:_save_match()` ichida
  (`delivery.deliver(text, userbot_client=...)`) hamda `bot_commands.py` va
  `routers/opportunity.py`da to'liq ishlatilayotgani tasdiqlandi (fayl
  docstring'ida "Stage 6" deb yozilgan — demak bu oldinroq, boshqa sessiyada
  qilingan, HANDOFF.md asosiy fayliga yozilmay qolgan). Tegilmadi.
- Poll loop (`main.py:_opportunity_poll_loop`) — Stage 3'da qo'shilgan,
  kodda joyida, alohida o'zgartirish talab qilmadi.
- `parser.py`, matcher'dagi Stage 5 tuzatishi — tekshirildi, o'zgarishsiz
  to'g'ri ishlayapti (`tests/test_opportunity.py` — ALL TESTS PASSED).

## Topilgan va tuzatilgan yagona haqiqiy band

Stage 5 handoff'da aytilgandek: `engine.py:_ai_confirms()` ichida
`result.get("is_relevant", True)` tekshiruvi bor edi, lekin
`gemini_analyzer.analyze_opportunity_deeply()` JSON sxemasida `is_relevant`
kaliti UMUMAN yo'q edi — demak bu tekshiruv har doim `True` bo'lib, o'lik kod
edi (haqiqiy filtr faqat `match_percentage < 70` orqali ishlardi).

## O'zgargan fayllar

**`backend/app/opportunity/gemini_analyzer.py`**
- `analyze_opportunity_deeply()` ichidagi Gemini JSON sxemasiga `is_relevant`
  kaliti qo'shildi, aniq ko'rsatma bilan: faqat (a) post umuman
  imkoniyat/musobaqa e'loni bo'lmasa (oddiy suhbat, reklama, yangilik), yoki
  (b) `disqualifiers` ro'yxatidagi shartga **aniq va shubhasiz** mos kelsa —
  `false`. Shubhali/noaniq holatda `true` qoldirish aytib o'tildi, chunki
  yakuniy qaror baribir `match_percentage` orqali qabul qilinishi kerak —
  `is_relevant` yagona darvoza bo'lib qolmasligi uchun (xuddi Stage 5'dagi
  `is_real_opportunity()` muammosi — haddan tashqari qattiq birlamchi
  darvoza — takrorlanmasligi uchun ataylab yumshoq qilib yozildi).
- Mahalliy fallback (`except` blokidagi, Gemini javob bermasa yoki JSON
  buzilgan bo'lsa ishlaydigan) lug'atga ham `"is_relevant": True` qo'shildi
  — bu holatda ma'lumot yo'qligi sababli qat'iy rad etib bo'lmaydi, shuning
  uchun ataylab doim `True` (regex/`match_percentage` natijasiga tayaniladi,
  AI darvozasi hech qachon bloklamaydi).

**`backend/app/opportunity/engine.py`** — tegilmadi (o'zgarishsiz qoldi;
`_ai_confirms()` allaqachon `is_relevant`ni to'g'ri o'qiydigan edi, faqat
ma'lumot kelmasdi).

## Tekshirildi

```python
# Fallback endi is_relevant=True qaytaradi (API kalit yo'q holat):
analyze_opportunity_deeply("Yangi grant imkoniyati: https://forms.gle/xyz987 bepul deadline bor")
→ {..., "is_relevant": True, "match_percentage": 85, ...}

# _ai_confirms endi haqiqiy filtr sifatida ishlaydi:
is_relevant=False, match_percentage=95   → _ai_confirms() = False (rad etildi)
is_relevant yo'q (eski xatti-harakat)     → _ai_confirms() = True (mos — orqaga
                                             mos keluvchanlik buzilmadi)
result is None (AI chaqirilmadi/kalit yo'q) → _ai_confirms() = True
```

## Sinovdan o'tkazildi

```
python3 backend/tests/test_opportunity.py
→ ALL TESTS PASSED

pytest backend/tests/test_opportunity_bot_and_lifespan.py \
       backend/tests/test_dashboard_formatter.py \
       backend/tests/test_email_client.py \
       backend/tests/test_email_crypto.py \
       backend/tests/test_email_worker_pure.py -q
→ 21 passed
```

`test_opportunity_engine.py` va `test_triage.py` — pytest-asyncio plagin
konfiguratsiya qilinmagani sababli (loyihada hech qanday `pytest.ini`/
`pyproject.toml`/`conftest.py` yo'q) kolleksiya darajasida muvaffaqiyatsiz —
bu **stage 2 handoff'da ham qayd etilgan, bu stage'dan oldin ham mavjud
bo'lgan** muhit muammosi, `gemini_analyzer.py`/`engine.py`ga aloqasi yo'q.
Ataylab tegilmadi (Stage 2 handoff'da "Stage 9 (testlar)" ko'lamiga
tegishli deb belgilangan edi — shu qarorga rioya qilindi).
`test_media_analyzer.py` ham xuddi shunday, oldindan mavjud, bu
stage'ga aloqasi yo'q muammo (modul darajasida `asyncio.run` chaqirilgani
sababli kolleksiyada yiqiladi).

## Tegilmagan, lekin e'tiborga olinishi kerak narsalar

- `opportunity.enabled` UI/DB orqali yoqilganini tasdiqlash — hamon kodga
  tegishli emas, foydalanuvchi tomonidan tekshirilishi kerak.
- Pytest-asyncio konfiguratsiyasi (`test_opportunity_engine.py`,
  `test_triage.py`, `test_media_analyzer.py`) — Stage 9 ko'lamida qoldirildi.
- `test_strict_filter.py` (backend root'da, `tests/` papkasida emas) — jonli
  Telegram sessiyasi/API ID talab qiladigan qo'lda diagnostika skripti,
  avtomatlashtirilgan test emas; konteynerda kerakli kalitlar yo'qligi sababli
  ishga tushirib bo'lmadi (kutilgan holat).

## Stage 7 uchun eslatma

- Agar haqiqiy muhitda `is_relevant=False` juda tez-tez chiqsa (AI haddan
  tashqari qattiq bo'lsa), bu promptni yana ham yumshatish yoki uni butunlay
  o'chirib, faqat `match_percentage`ga qaytish kerak bo'lishi mumkin — buni
  kuzatish tavsiya etiladi.
- `delivery.py`, poll loop va `enabled` sozlamasi — barchasi tasdiqlangan,
  ishlaydi; Stage 7 ularga qaytmasa ham bo'ladi, agar yangi xato
  topilmasa.

## Tekshirish checklist

- [ ] Real GEMINI_API_KEY bilan bir nechta haqiqiy e'lonni sinab ko'ring —
      `is_relevant` juda tez-tez `false` qaytarmasligini kuzating (agar shunday
      bo'lsa, promptni yumshatish kerak).
- [ ] `python3 backend/tests/test_opportunity.py` o'z muhitingizda ham
      ishga tushiring.
- [ ] Oldin AI bosqichiga yetib borgan, lekin noto'g'ri (masalan spam yoki
      oddiy suhbat) post endi `is_relevant=false` orqali to'g'ri rad
      etilayotganini real misolda tekshiring.
