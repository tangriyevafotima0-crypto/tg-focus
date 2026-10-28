# Telegram Focus — xatolar va mantiqiy kamchiliklar hisoboti

**Tahlil qilingan arxiv:** `telegram-focus-clean_tar.gz` (backend ~7 000 qator Python, frontend, testlar, hujjatlar)
**Qoida:** kodga hech narsa o'zgartirilmadi. Bu faqat hisobot; tuzatish takliflari har bo'limda berilgan.

---

## 0. Qisqacha xulosa (3 daqiqada o'qish uchun)

Siz aytgan to'rtta muammoning **hammasi tasdiqlandi** va har birining aniq sababi topildi. Ko'pchiligi "bitta sabab" emas, **bir nechta xato ketma-ket** ishlayapti — shuning uchun bittasini tuzatsangiz ham ishlamay qolishi mumkin.

| # | Siz aytgan muammo | Asosiy sabab (bir gapda) | Daraja |
|---|---|---|---|
| 1 | Email qabul qilish ishlamayapti | `email_worker.py` fayli **soxta (stub) kod bilan almashtirilgan**; haqiqiy ishchi `.bak` faylda qolib ketgan | 🔴 Kritik |
| 2 | Grantlar tez-tez yangilanmayapti | Davriy tekshiruv **umuman yo'q**; `check_interval` sozlamasi hech qayerda ishlatilmaydi | 🔴 Kritik |
| 3 | AI kanallardan imkoniyatni sezmayapti | AI "darvozasi" noto'g'ri kalit nomini o'qiydi (`match_score` ≠ `match_percentage`) → **har bir post rad etiladi** | 🔴 Kritik |
| 4 | Auto-reply xato qiladi, o'zimga o'zim yozyapti | Telethon handler **o'z chiquvchi xabaringizni ham "kiruvchi" deb** qabul qiladi; auto-reply xabarning o'ziga ham javob beradi | 🔴 Kritik |

Bundan tashqari yana ko'plab kichikroq xatolar topildi; ular tegishli bo'limlarda va 6-bo'limdagi jadvalda berilgan.

**Eng muhim 5 ta tuzatish (tartib bilan):**
1. Telethon handlerga `incoming=True` qo'shish (4-bo'lim) — 1 qator, eng katta ta'sir.
2. `engine.py:62` dagi kalit nomini tuzatish (3-bo'lim) — 1 qator, AI darvozasini ochadi.
3. `email_worker.py` ni `.bak` dan tiklash (1-bo'lim).
4. Davriy `catch_up` siklini qo'shish (2-bo'lim).
5. Gemini va web-skraper chaqiruvlarini `asyncio.to_thread` ichiga olish — hozir ular butun ilovani muzlatadi (5-bo'lim).

---

## 1. Email qabul qilish ishlamayapti

### 1.1 Nima bo'lgan (asosiy sabab)

Loyihada ikkita `email_worker` bor:

| Fayl | Hajm | Nima qiladi |
|---|---|---|
| `app/email_worker.py.bak` | 289 qator | **Haqiqiy** ishchi: IMAP orqali xat oladi, bazaga yozadi, WebSocket orqali yuboradi, xato bo'lsa kutish vaqtini oshiradi (backoff) |
| `app/email_worker.py` (hozirgi) | 120 qator | **Soxta**: faqat "topshirilgan dastur javobini aniqlash" mantig'i, xat olish kodi yo'q |

Ilova hozirgisini yuklaydi. U quyidagicha ishlaydi:

```python
# email_worker.py, 17–22-qatorlar
try:
    from app.email_client import fetch_new_emails      # ← bunday funksiya YO'Q
except (ImportError, AttributeError):
    def fetch_new_emails():
        return []                                      # ← jimgina bo'sh ro'yxat
```

`email_client.py` da faqat `fetch_new` va `fetch_new_sync` bor, `fetch_new_emails` yo'q. Natija: import xatosi **jimgina yutiladi**, funksiya doim `[]` qaytaradi. Sikl har 60 soniyada ishlaydi, hech narsa qilmaydi va **logga hech qanday xato yozmaydi**. Shuning uchun ilova "ishlayotgandek" ko'rinadi.

### 1.2 Bog'liq xatolar

| # | Xato | Joyi | Oqibati |
|---|---|---|---|
| E-2 | `check_account_locked` stubda oddiy (sync) funksiya, `False` qaytaradi | `email_worker.py:119-120` | Router `await check_account_locked(...)` qiladi (`routers/email.py:223`) → `TypeError` → "Hozir tekshirish" tugmasi **500 xato** beradi |
| E-3 | Stub o'zining alohida sync SQLite ulanishini ochadi | `email_worker.py:8-11` | `database.py:93-102` da aynan shu naqsh **"database is locked" xatolari uchun olib tashlangani** yozilgan. Xato qaytib kelgan |
| E-4 | Sync DB chaqiruvi `async` siklda | `email_worker.py:103-115` | Har 60 soniyada event loop bloklanadi |
| E-5 | `send_telegram_alert` funksiyasi `delivery.py` da yo'q | `email_worker.py:24-28` | Javob kelganda ham Telegramga bildirishnoma ketmaydi, faqat logga yoziladi |
| E-6 | Mavjud test endi yiqiladi | `tests/test_email_worker_pure.py` | **Tekshirildi:** `KeyError: '_extract_links'` — test yo'q bo'lgan funksiyalarni qidiradi |
| E-7 | Domen bo'yicha moslashtirish noto'g'ri | `email_worker.py:69-86` | Holatidan qat'i nazar **barcha** topshiruvlarni ko'radi; `org_name in sender_domain` — qism-satr tekshiruvi (masalan, tashkilot `mit` bo'lsa, `smith.com` ham mos keladi); allaqachon "qabul qilindi" holatini "javob keldi"ga qaytarib yuboradi |
| E-8 | `opportunities` jadvaliga yozuvchi kod topilmadi | butun loyiha | "Topshirilgan dastur ↔ email" funksiyasi amalda bo'sh ma'lumot ustida ishlaydi |

### 1.3 Haqiqiy ishchida (`.bak`) ham topilgan kamchiliklar

- **Birinchi ishga tushishda eski 20 ta xat "yangi" bo'lib kiradi.** `email_client.py:18,334` (`BASELINE_COUNT = 20`) — oxirgi 20 ta xat o'qilmagan deb saqlanadi va ekranga yuboriladi.
- **Email xabarlari hech qachon triage (tasniflash) qilinmaydi.** `classify_message` faqat `telethon_client.py:364` da chaqiriladi. Ya'ni qabul xati kelsa ham "Daraja 3 — shoshilinch" deb belgilanmaydi.
- **`store.py` da "email_admissions" ga barcha emaillar sanaladi** (`Message.channel == "email"`), faqat qabul xatlari emas. Brifingdagi raqam noto'g'ri.
- **Parolni shifrlash o'zi yozilgan** (`email_crypto.py`: HMAC + XOR). Ishlaydi, lekin standart emas. `cryptography` kutubxonasidagi `Fernet` xavfsizroq va qisqaroq.
- **Outlook/Hotmail qo'llab-quvvatlanmaydi** (OAuth2 kerak) — bu xato emas, lekin foydalanuvchi bilishi kerak.

### 1.4 Tuzatish rejasi

1. `email_worker.py` ni `email_worker.py.bak` dan tiklash.
2. Stubdagi **foydali** g'oyani (xat kelganda topshirilgan dasturga bog'lash) tiklangan ishchining ichiga **async** ko'rinishda qo'shish — `check_account_once` ichida, `session.commit()` dan keyin:

```python
# check_account_once() ichida, xatlar saqlangandan keyin
for record, parsed in created:
    await link_to_submission(session, parsed)   # yangi async funksiya
```

3. `link_to_submission` da: faqat `status == "submitted"` bo'lganlarni olish; domen bo'yicha **aniq** moslik (`==` yoki `.endswith("." + domen)`), `org_name in domain` ni olib tashlash.
4. `delivery.py` ga `send_telegram_alert(text)` ni yozish (yoki `delivery.send_to_chat` dan foydalanish).
5. Import xatosini yutmaslik: `try/except ImportError` o'rniga to'g'ridan-to'g'ri import — xato bo'lsa ilova ishga tushishda darrov yiqilsin.

---

## 2. Grantlar tez-tez yangilanmayapti

### 2.1 Asosiy sabab

`engine.py` boshidagi izoh o'zi aytadi: **"real-vaqt … polling YO'Q"**. Ya'ni tizim faqat ikki holatda ishlaydi:

1. Telethon orqali **yangi xabar kelgan paytda** (real-vaqt).
2. Ilova **ishga tushganda bir marta** (`catch_up`, `main.py:141`).

Boshqa hech qanday davriy tekshiruv yo'q.

**`check_interval` (600 soniya) — "o'lik sozlama".** U bazada saqlanadi, UI da ko'rsatiladi, bot buyrug'i bilan o'zgartiriladi — lekin **hech qaysi sikl uni o'qimaydi** (butun loyihada `grep` qilindi: faqat saqlash/ko'rsatish joylari bor).

### 2.2 Nima uchun bu amalda "yangilanmaslik"ka olib keladi

| # | Holat | Natija |
|---|---|---|
| G-1 | Telegram ulanishi uzilsa (Mac uyquga ketsa, Wi-Fi o'chsa) | `telethon_client.py:454-457` qayta ulanadi, lekin **uzilish paytidagi postlar hech qachon o'qilmaydi**. Telethon'da `catch_up=True` yoqilmagan |
| G-2 | Ilova ishga tushganda imkoniyat-motor o'chiq bo'lsa | `catch_up` shunda qaytib ketadi (`engine.py:253`) va **keyin yoqsangiz ham qayta ishlamaydi** |
| G-3 | Yangi kanal qo'shilsa | Faqat "baseline" o'rnatiladi (`engine.py:266-273`) — eski postlar ataylab o'tkazib yuboriladi. Bu to'g'ri, lekin foydalanuvchiga aytilmaydi |
| G-4 | Bir kanalda 200 dan ko'p yangi post bo'lsa | `_MAX_NEW_PER_CHANNEL = 200` — qolganlari keyingi qayta ishga tushishgacha kutadi |

### 2.3 Tuzatish

`main.py` ga davriy sikl qo'shing (mavjud `_start_task` bilan):

```python
async def _opportunity_poll_loop() -> None:
    await asyncio.sleep(30)
    while True:
        try:
            settings = await opportunity_store.get_settings()
            if settings.get("enabled"):
                client = get_client()                       # RuntimeError bo'lsa — keyingi aylanishda
                await opportunity_catch_up(client, message_manager.broadcast)
            interval = max(int(settings.get("check_interval", 600)), 60)
        except asyncio.CancelledError:
            raise
        except RuntimeError:
            interval = 30                                   # Telegram hali ulanmagan
        except Exception:
            logger.exception("Imkoniyat davriy tekshiruvi xatosi")
            interval = 300
        await asyncio.sleep(interval)

# lifespan ichida:
_start_task(app, "opportunity_poll", _opportunity_poll_loop)
```

Qo'shimcha: `TelegramClient(SESSION_PATH, api_id, api_hash, catch_up=True)` (`telethon_client.py:423`).

---

## 3. AI kanallardagi imkoniyatlarni sezmayapti

Bu eng chuqur muammo: **bir nechta mustaqil xato** ketma-ket ishlab, har bir postni yo'q qiladi. Men buni haqiqiy kod bilan sinab ko'rdim (3.5-bo'lim).

### 3.1 🔴 AI darvozasi har bir postni rad etadi

`engine.py:62-68`:

```python
score = result.get("match_score", 0) or 0          # ← "match_score" ni qidiradi
is_relevant = result.get("is_relevant", True)
if not is_relevant or score < _AI_MIN_SCORE:       # _AI_MIN_SCORE = 70
    return False                                    # ← RAD
```

Lekin `gemini_analyzer.py` (prompt 128-qator va zaxira 152-qator) natijani **`match_percentage`** nomi bilan qaytaradi. `match_score` degan kalit u yerda **umuman yo'q**.

Natija: `score` doim `0` → `0 < 70` → **har bir post rad etiladi**. Gemini 95% bersa ham.

**Tekshiruv natijasi** (haqiqiy `analyze_opportunity` chaqirildi, GEMINI kaliti yo'q holatda):
```
AI natija kalitlari: [..., 'match_percentage', ...]     ← 'match_score' yo'q
engine o'qigan score = 0 | _AI_MIN_SCORE = 70 | tasdiqlandimi: False
Gemini 95% bersa ham engine score = 0 -> RAD
```

Bu xatoni testlar ham tutmaydi — `_ai_confirms` va `analyze_opportunity` uchun hech qaysi testda qamrov yo'q.

**Tuzatish (1 qator):**
```python
score = result.get("match_percentage") or result.get("match_score") or 0
```
Va eng yaxshisi — ikki modul o'rtasidagi "shartnoma"ni yagona nomga keltirish va uni test bilan qulflash.

### 3.2 🔴 Ball chegarasi juda baland — oddiy bepul grant ham o'tmaydi

`min_score` standarti 40 (`models.py:133`). Matcher esa ball beradi: muddat 30 kundan uzoq bo'lsa **+5**, bepul bo'lsa **+25**. Ya'ni yosh/sinf ko'rsatilmagan oddiy bepul grant jami **30 ball** oladi → **rad**.

**Tekshiruv natijasi:**
```
"UZ bepul grant, muddat 45 kun"  score=30   ← min_score 40 dan past → tashlanadi
"EN fully funded"                score=27   ← tashlanadi
```

### 3.3 🟠 Muddatni (deadline) topa olmaydi

`parser.py:_extract_deadline` faqat qat'iy ro'yxatdagi iboralar yonidagi sanani qidiradi. **Tekshiruv natijasi:**

| Post matni | Topildimi? |
|---|---|
| `Muddat: 12-oktabr 2026` | ✅ |
| `Muddati: 12-oktabr 2026` | ❌ (ro'yxatda `"muddat:"` bor, `"muddati:"` yo'q) |
| `Ariza 12-oktabrgacha` | ❌ (`-gacha` — o'zbek postlarida **eng ko'p** uchraydigan shakl) |
| `20-dekabrgacha topshiring` | ❌ |
| `Deadline: 12 October 2026` | ❌ (inglizcha oy nomlari yo'q) |
| `Deadline: 2026-12-01` | ✅ |

Muddat topilmasa `+2` ball beriladi — ya'ni ball yana pasayadi (3.2 ga qarang). Teskari tomoni ham bor: **muddati o'tgan** post faqat sana topilgandagina rad etiladi.

### 3.4 🟠 Rus va ingliz tilidagi postlar kesib tashlanadi

`matcher.py:is_real_opportunity` imkoniyat so'zlarini faqat o'zbekcha (va bir necha inglizcha: grant, scholarship, camp, summer, internship) ro'yxatdan qidiradi.

**Tekshiruv natijasi:** rus tilidagi postga *"Бесплатная стипендиальная программа для школьников 15-18 лет. Заявки до 15 декабря 2026"* → `score = -1000`, sabab: *"Imkoniyat emas (oddiy xabar/suhbat)"*.

O'zbek Telegram kanallarining katta qismi rus va ingliz tilida yozadi. Yetishmaydigan so'zlar: `fellowship`, `program`, `apply`, `fully funded`, `стипендия`, `программа`, `заявк`, `конкурс`, `олимпиада` va h.k.

### 3.5 🟠 AI — asosiy emas, ikkinchi darajali filtr

Hozirgi tartib: **regex → ball → AI**. AI faqat regex o'tkazgan postlarni ko'radi. Ya'ni regex (3.2–3.4 dagi kamchiliklari bilan) o'tkazmagan post uchun AI hech qachon chaqirilmaydi. "AI sezmayapti" degan taassurotning sababi shu ham.

**Taklif:** arzon oldindan-filtr (havola yoki imkoniyat so'zi bor, 3 tilda) → **AI birinchi bo'lib baholaydi** (tuzilgan JSON: `is_opportunity`, `score`, `deadline`, `is_free`, `eligible`) → regex faqat zaxira.

### 3.6 🟠 Rasmli postlar umuman ko'rilmaydi

`engine.py:39` — `_MIN_TEXT_LEN = 40`. Telegram'dagi imkoniyat e'lonlarining ko'pi **plakat-rasm + qisqa izoh**. Handler (`telethon_client.py:221`) faqat `event.message.message` (izoh)ni uzatadi. OCR (`media_analyzer`) bor, lekin u faqat "kuzatilgan manba" yo'li uchun ishlaydi va natijasi imkoniyat-motorga **uzatilmaydi**.

### 3.7 🟡 Boshqa AI xatolari

- **Profil ikki joyda, ular mos emas.** AI promptlari qattiq yozilgan `USER_PROFILE` (`gemini_analyzer.py:15`) dan foydalanadi; UI dagi profil esa bazadagi `OppProfile`. UI da profilni o'zgartirsangiz AI bilmaydi. Shuningdek `engine.py:78` da `is_student` standarti `False`, `matcher.Profile` da `True`.
- **Xatolar ko'rinmaydi.** `call_gemini_raw` (`gemini_analyzer.py:104-105`): `except Exception: continue` — 429 (limit), 404 (model nomi noto'g'ri), tarmoq xatosi — **hammasi jimgina**. Beshta modelni aylanib chiqib `""` qaytaradi. Nega ishlamayotganini bilishning imkoni yo'q.
- **Model nomlarini tekshiring.** `MODEL_CHAIN` da `gemini-3.5-flash`, `gemini-3.7-flash`, `gemini-3.5-flash-lite` bor. Men bu nomlarning mavjudligini **tekshira olmadim** (tarmoq yo'q). Agar noto'g'ri bo'lsa, zanjirning yarmi doim bekor, va xato ko'rinmaydi.
- **Ehtimoliy:** "o'ylovchi" (thinking) Gemini modellarida `maxOutputTokens=400` (triage) o'ylash tokenlari bilan to'lib, javob kesilib qolishi mumkin → JSON o'qilmaydi → zaxira heuristika. Tekshirib ko'rish kerak (`thinkingBudget: 0` sinab ko'ring).
- **Soxta zaxira javoblar.** Gemini ishlamasa `analyze_opportunity_deeply` (143-157) "85% mos, ko'rib chiqish mumkin" deb **to'qib** javob beradi; `generate_chat_response` esa "Xabaringizni qabul qildim…" deydi. Foydalanuvchi AI javob berdi deb o'ylaydi. Zaxira regexi ham xato: `fee` — `coffee`, `feeling` ga; `\$` — har qanday dollar belgisiga mos keladi.
- **API kaliti URL ichida** (`gemini_analyzer.py:91`) — proksi/loglarda ko'rinishi mumkin. `x-goog-api-key` sarlavhasidan foydalaning.
- **Vaqt mintaqasi.** `date.today()` (mahalliy) va `message_date.date()` (UTC) aralashadi (`engine.py:210-211`). Toshkent UTC+5, kechqurun "bugun"/"kecha" 1 kunga siljishi mumkin.

---

## 4. Auto-reply xatolari va "o'zimga o'zim yozyapti"

### 4.1 🔴 Asosiy sabab: o'z xabaringiz "kiruvchi" deb qabul qilinadi

`telethon_client.py:425-428`:
```python
client.add_event_handler(
    lambda event: _handle_new_message(event, on_new_filtered_message),
    events.NewMessage,                 # ← incoming=True YO'Q
)
```

Filtrsiz `NewMessage` **sizning o'zingiz yozgan xabarlarni ham** oladi. Keyin kod:
- ularni `direction="in"` (kiruvchi) deb saqlaydi (`telethon_client.py:288` — qattiq yozilgan);
- triage qiladi (masalan, "iltimos, kitobni qaytaring" deb yozsangiz — bu 2-daraja);
- `send_executive_reply` chaqiradi → "Men Zafarning shaxsiy AI assistentiman…" deb **sizning o'z xabaringizga javob yozadi**.

`event.out`, `incoming=`, `get_me()` tekshiruvi butun loyihada **yo'q** (qidirildi).

### 4.2 🔴 Auto-reply o'zining javobiga ham javob beradi (aylana)

`send_reply` yuborgan xabar ham Telethon'da yangi `NewMessage` hodisasini keltirib chiqaradi. Handler uni yana "kiruvchi" deb saqlaydi. Takror javobdan faqat `_was_recently_auto_replied` himoya qiladi — u esa `media_type="auto_reply"` belgisini qidiradi, bu belgi **javob yuborilgandan keyin** alohida yozuvda qo'yiladi (`auto_responder.py:119-126`). Oraliqda **poyga holati (race condition)** bor: hodisa belgidan oldin kelsa, himoya ishlamaydi → ikki marta javob.
Agar belgini yozishda xato chiqsa — xabar yuborilgan, lekin belgi yo'q → 24 soatlik cheklov ishlamaydi → **spam**.

### 4.3 🔴 `source_id == 14` — qattiq yozilgan raqam

`auto_responder.py:88`:
```python
is_unmonitored_dm = message.source_id == 14
if not is_unmonitored_dm and level != 2:
    return ...wrong_level
```

- 14-raqam faqat sizning bazangizda "dm_unmonitored" bo'lishi **tasodifiga** bog'liq. Boshqa bazada (yoki 14-manba oddiy guruh bo'lsa) — **o'sha guruhdagi har bir xabarga** daraja tekshirilmasdan javob ketadi.
- `telethon_client.py:381` esa xuddi shu narsani `identifier == "dm_unmonitored"` bilan tekshiradi. **Ikki joyda ikki xil mantiq.**
- "dm_unmonitored" manbasini yaratuvchi kod **yo'q** — faqat qidiriladi (`telethon_client.py:252-258`). `.bak` da avtomatik yaratish bor edi, hozirgisidan olib tashlangan. Qo'lda qo'shilmagan bazada shaxsiy xabarlar **jimgina tashlab yuboriladi**.
- Daraja mosligi: `telethon_client.py:382` javobni daraja **1 va 2** uchun chaqiradi, `auto_responder.py` faqat **2** ni qabul qiladi.

### 4.4 🟠 Boshqa auto-reply xatolari

| # | Xato | Joyi | Tavsif |
|---|---|---|---|
| A-5 | Chat turi tekshirilmaydi | `auto_responder.py:95-99` | Guruhda ham javob **ochiq, sizning akkauntingizdan** yoziladi (24 soatda har guruhga 1 marta). Kanalda esa yozib bo'lmaydi → xato |
| A-6 | Ko'rsatilgan javob ≠ yuborilgan javob | `auto_responder.py:106` | Gemini yozgan `triage_auto_reply` UI da ko'rinadi, lekin **doim** qattiq yozilgan `TEXT_TEMPLATE` yuboriladi. "Yubordim" bosilganda ham (`routers/messages.py:444`) |
| A-7 | Yo'nalish tekshirilmaydi | `auto_responder.py:74-90` | `message.direction == "in"` tekshiruvi yo'q |
| A-8 | `media_type` ustuni belgi sifatida ishlatilgan | `auto_responder.py:43,125` | Frontend `media_type="auto_reply"` ni rasm/fayl deb ko'rsatishga urinishi mumkin |
| A-9 | Shaxsiy chat va "Saqlangan xabarlar" | `telethon_client.py:252` | `event.is_private` o'zingizning "Saved Messages" va o'zingiz yozgan DM larni ham o'z ichiga oladi |
| A-10 | Shablon qattiq yozilgan | `auto_responder.py:30-39` | Ism ("Zafar") va til doim bir xil — ruscha/inglizcha yozgan odamga ham o'zbekcha |

### 4.5 🟠 Triage (tasniflash) xatolari

- **Media bo'sh matn = "bo'sh xabar" = tashlab yuboriladi.** `triage.py:70-71`: matn bo'sh bo'lsa Daraja 0. Lekin rasm/PDF/video yuborilsa va OCR ishlamasa (yoki video/stiker bo'lsa) matn bo'sh — **muhim hujjat ham "bo'sh xabar" deb yo'q qilinadi**. Tuzatish: `message.media_type` bor bo'lsa Daraja 1 dan past tushirmaslik.
- **Spam tekshiruvi shoshilinch tekshiruvdan oldin keladi** (`triage.py:192-202`). Haqiqiy "Wharton admission … click here to view" xabari spam (Daraja 0) bo'lib ketadi.
- **Kalit so'zlar juda keng** (`triage.py:97-102`): `congratulations`, `urgent`, `acceptance` — spam xabarlar ("Congratulations, you won!") **Daraja 3 (favqulodda)** bo'ladi. Qism-satr tekshiruvi (`kw in norm`) so'z chegarasini hisobga olmaydi.
- **Har bir noaniq xabar uchun Gemini chaqiriladi** — guruh yozishmalarida bu ko'p so'rov va bepul limitga tez yetish demakdir.

### 4.6 Tuzatish

**1) Handler (eng muhim, 1 qator):**
```python
events.NewMessage(incoming=True)
```
va `_handle_new_message` boshiga mudofaa sifatida:
```python
if event.out or getattr(event.message, "out", False):
    return
```
(Agar o'z xabarlaringizni ham arxivda ko'rmoqchi bo'lsangiz — `direction="out"` bilan saqlang, lekin **triage va auto-reply'ga yubormang**.)

**2) Auto-responder:**
```python
# 14 o'rniga
src = await session.get(Source, message.source_id)
is_unmonitored_dm = bool(src and src.identifier == "dm_unmonitored")

if message.direction != "in":                 return ...("wrong_direction")
if message.chat_id is None or message.chat_id < 0:   # faqat shaxsiy chat
    return ...("not_private")
```

**3) Poyga holatini yo'qotish:** javobni yuborishdan **oldin** `direction="out", media_type="auto_reply"` yozuvini yarating (zaxira qiling), yuborilgach yangilang; yuborish xato bersa — o'chiring.

**4) Telegram xabarlariga noyoblik:** `(chat_id, telegram_message_id, channel)` bo'yicha `UniqueConstraint` — takror saqlanishning oldini oladi.

**5) "dm_unmonitored" manbasini ishga tushishda yaratish** (`init_db` ichida, mavjud bo'lmasa).

---

## 5. Ilovani muzlatadigan xato (barcha yuqoridagilarga ta'sir qiladi)

Quyidagi funksiyalar **sinxron** (to'xtatuvchi) tarmoq chaqiruvlari, lekin `async` kod ichida to'g'ridan-to'g'ri chaqiriladi:

| Funksiya | Qayerdan chaqiriladi | Eng yomon kutish |
|---|---|---|
| `call_gemini_raw` (`urllib`, 25 s × 5 model) | `triage.py:141`, `gemini_analyzer.py`, `ai_chat.py` | ~125 soniya |
| `scrape_webpage` (`httpx.Client`, 25 s) | `engine._ai_confirms` → `analyze_opportunity` | 25 soniya |
| `generate_chat_response` | `ai_chat.py:82` (`post_ai_chat`) | ~150 soniya |

Python'da `async` funksiya ichidagi sync chaqiruv **butun event loop'ni** to'xtatadi: shu vaqt davomida Telegram xabarlari, WebSocket, API — **hammasi qotadi**. Gemini sekin javob bergan har bir paytda ilova "osilib qoladi".

**Tuzatish:**
```python
result = await asyncio.to_thread(analyze_opportunity, opp.raw_text, url)
raw    = await asyncio.to_thread(gemini_analyzer.call_gemini_raw, contents, prompt, 400)
```
Eng yaxshisi — `urllib` o'rniga `httpx.AsyncClient`, vaqt chegarasini 8–10 soniyaga tushirish va `asyncio.Semaphore(2)` bilan bir vaqtdagi so'rovlarni cheklash.

---

## 6. Qolgan barcha topilmalar (jadval)

🔴 kritik · 🟠 yuqori · 🟡 o'rta · ⚪ past

| ID | Daraja | Fayl:qator | Tavsif | Tuzatish |
|---|---|---|---|---|
| X-1 | 🟠 | `store.py:388` | `Opportunity.is_active` — modelda bunday ustun **yo'q** → `AttributeError`. `ai_chat.py` buni `try/except` bilan yutadi, shuning uchun AI "faktlar"siz ishlaydi, xato ko'rinmaydi | Ustun qo'shing yoki shartni olib tashlang; `except` ichida `logger.exception` |
| X-2 | 🟡 | `store.py:~400` | Brifing: `important_sources` (`WHARTON`, `IELTS`…) va `recommended_opportunities` (`"FLEX / UWC…"`) **qattiq yozilgan** — haqiqiy ma'lumot emas | Bazadan oling |
| X-3 | 🟠 | `run_backfill.py:71` | `await analyze_opportunity(...)` — funksiya sinxron → `TypeError`. Shuningdek `monitored_channels`, `processed_messages` jadvallari **mavjud emas**; `INSERT` ustunlari (`channel_id`, `message_id`, `summary`…) `Opportunity` modelida yo'q | Qayta yozish yoki o'chirish |
| X-4 | 🟡 | `run_deep_audit.py`, `test_strict_filter.py` | Xuddi shu `match_score` kalit xatosi | 3.1 bilan birga |
| X-5 | 🟠 | `scraper.py`, `gemini_analyzer.py:66` | Kanal postidagi **istalgan** havola ochiladi (SSRF: `http://localhost`, `169.254.169.254` kabi ichki manzillar ham). `verify=False` — TLS tekshiruvi o'chirilgan | Ichki IP'larni bloklash, `verify=True` |
| X-6 | 🟡 | `telethon_client.py:398-401` | Ikkita `except Exception:` — ikkinchisi **hech qachon ishlamaydi** (o'lik kod, eski refaktor qoldig'i) | O'chirish |
| X-7 | 🟡 | `telethon_client.py:341` | `asyncio.create_task(...)` natijasi saqlanmaydi — Python hujjatiga ko'ra bunday vazifa ish o'rtasida yig'ib olinishi (garbage collection) mumkin | Vazifalarni `set` da saqlash |
| X-8 | 🟡 | `telethon_client.py:262-296` | Media yuklash va OCR tahlili xabarni **saqlashdan oldin** kutiladi — sekin Gemini xabarni ekranga kechiktiradi | Avval saqlash, tahlilni fonda qilish |
| X-9 | 🟡 | `engine.py:44-69` | AI xato bersa yoki javob bermasa `_ai_confirms` `True` qaytaradi ("fail-open"), ya'ni AI ishlamay qolsa filtr jimgina o'chadi — 3.1 dagi xato esa aksincha ("fail-closed"). Ikki xil xatti-harakat bir funksiyada | Bitta aniq qoida tanlang va logga yozing |
| X-10 | 🟡 | `engine.py:201-203` | `last_seen` post **qayta ishlanishidan oldin** yangilanadi; ishlov paytida xato chiqsa post abadiy yo'qoladi | Ishlovdan keyin yangilang |
| X-11 | 🟡 | `triage.py:78-80` | `word_count <= 2 and ...` — o'lik kod (yuqorida allaqachon qaytgan) | O'chirish |
| X-12 | 🟡 | `auth.py` `login()` | Parol `!=` bilan solishtiriladi (vaqt hujumiga ochiq); `APP_PASSWORD` bir vaqtda imzo kaliti — parolni almashtirsangiz barcha sessiyalar bekor | `hmac.compare_digest`; alohida `SECRET_KEY` |
| X-13 | ⚪ | `auth.py` | Tezlik chegarasi (5/daq) IP bo'yicha; teskari proksi ortida hamma bir IP ko'rinadi | `X-Forwarded-For` sozlash |
| X-14 | 🟡 | `main.py:183-194` | `allow_credentials=True` bilan CORS — `ALLOWED_ORIGINS` ga `*` qo'ymang | Faqat aniq manzillar |
| X-15 | 🟡 | `models.py:1-12` | Import takrorlari (`Column`, `datetime` 3-4 marta); `Opportunity`/`SubmittedOpportunity` eski `Column` uslubida, qolganlari `Mapped` — aralash | Tozalash |
| X-16 | 🟡 | `models.py:217,239` | `datetime.utcnow` (Python 3.12 da eskirgan, vaqt mintaqasiz) — boshqa jadvallarda esa mintaqali; `store.py:380` da taqqoslashda qo'lda `tzinfo` qo'shiladi | Hammasini `utc_now` ga |
| X-17 | 🟡 | `telethon_client.py:178` | Telegram xabarlari uchun takror himoyasi yo'q (email'da bor) | 4.6-4 |
| X-18 | ⚪ | arxivda | `.bak` fayllar (`app.js.bak` 1686 qator, `telethon_client.py.bak`, …) — chalkashlik va xatoning asosiy sababi (1-bo'lim) | Git'ga o'ting, `.bak` larni o'chiring |
| X-19 | 🟡 | `email_client.py:301-303` | 2 MB dan katta xat: faqat sarlavha olinadi, matn "[...faqat sarlavha]" — qabul xati katta ilova bilan kelsa mazmuni ko'rinmaydi | Matn qismini alohida so'rash (`BODYSTRUCTURE`) |
| X-20 | 🟡 | `email_client.py:342-353` | Biror xat olinmasa (`continue`), baribir `new_last_uid = max(found)` yoziladi — **o'sha xat abadiy o'tkazib yuboriladi** (vaqtinchalik tarmoq xatosida ham) | Muvaffaqiyatsiz UID'dan oldingi eng katta UID gacha suring |

---

## 7. Men nimani tekshirdim va nimani tekshirmadim

**Tekshirdim (kod bilan, natijalar yuqorida):**
- Barcha `.py` fayllar sintaksis jihatdan to'g'ri (`compileall` — xatosiz).
- `parser.py` + `matcher.py` ni 5 ta haqiqiy ko'rinishdagi post bilan ishga tushirdim (3.2, 3.3, 3.4 natijalari).
- `engine._ai_confirms` mantig'ini haqiqiy `gemini_analyzer.analyze_opportunity` natijasi bilan sinadim (3.1).
- `tests/test_email_worker_pure.py` ni ishga tushirdim — yiqiladi (1.2, E-6).
- `.bak` va joriy fayllarni `diff` bilan solishtirdim.

**Tekshira olmadim (sababi bilan):**
- **Ilovani to'liq ishga tushira olmadim** — bu muhitda tarmoq, Telethon, FastAPI va sizning `.env`/Telegram sessiyangiz yo'q. Shuning uchun 4-bo'limdagi "o'zimga o'zim yozish" zanjiri **kod o'qish orqali** aniqlandi, jonli sinov orqali emas. Mantiqiy zanjir aniq, lekin tuzatgandan keyin sinab ko'ring.
- Gemini model nomlarining mavjudligi va ularning hozirgi javob formati.
- `frontend/app.js` (1782 qator) — faqat email API chaqiruvlari tekshirildi (backend bilan mos). Qolgani chuqur o'qilmadi.
- To'liq o'qilmagan modullar: `bot_commands.py`, `briefing_service.py`, `media_analyzer.py`, `dashboard_formatter.py`, `resolve.py`, `formatting.py`, `routers/sources.py`, `scripts/*.sh`. Bularda ham xato bo'lishi mumkin.
- Arxivda `.env` yo'q (yaxshi — "clean"), shuning uchun API kalitlari/parollar to'g'ri sozlanganmi — bilmayman. Agar `GEMINI_API_KEY` o'rnatilmagan bo'lsa, AI umuman ishlamaydi (kod buni jimgina o'tkazib yuboradi).

---

## 8. Tavsiya etilgan tuzatish tartibi

| Qadam | Nima | Vaqt | Ta'siri |
|---|---|---|---|
| 1 | `NewMessage(incoming=True)` + `event.out` tekshiruvi | 5 daq | "O'zimga o'zim yozish" to'xtaydi |
| 2 | `engine.py:62` — `match_percentage` | 5 daq | AI darvozasi ochiladi |
| 3 | `email_worker.py` ni `.bak` dan tiklash + `check_account_locked` | 15 daq | Email ishlaydi |
| 4 | `auto_responder.py:88` — `14` ni identifikator bilan almashtirish, `direction`/chat turi tekshiruvi | 20 daq | Auto-reply xavfsiz bo'ladi |
| 5 | Gemini/skraper chaqiruvlarini `to_thread` ga o'tkazish | 30 daq | Ilova muzlamaydi |
| 6 | Davriy `catch_up` sikli + `catch_up=True` | 30 daq | Grantlar muntazam yangilanadi |
| 7 | Parser: `muddati`, `-gacha`, inglizcha/ruscha oylar va kalit so'zlar; `min_score` ni 20–25 ga tushirish yoki AI-birinchi tartibga o'tish | 1–2 soat | Ko'proq real imkoniyat topiladi |
| 8 | Triage: media-bo'sh xabar, spam/emergency tartibi, so'z chegarasi | 1 soat | Muhim xabarlar yo'qolmaydi |
| 9 | Qolgan jadvaldagi (X-*) xatolar | kerak bo'lganda | Barqarorlik, xavfsizlik |
| 10 | Testlar: `_ai_confirms`, `incoming` filtri, auto-reply aylanasi, email worker | 1–2 soat | Xatolar qaytib kelmaydi |

> **Muhim eslatma (1–2-qadamlar haqida):** 1-qadamni qilmasdan 4-qadamni (yoki auto-reply'ni yoqishni) qilmang — hozirgi holatda auto-reply yoqilgan bo'lsa, u o'z xabaringizga va odamlarga kutilmagan javob yuborishda davom etadi. Agar shoshilinch bo'lsa, `settings.json` da `auto_reply_enabled` ni vaqtincha `false` qilib qo'ying.

---

*Hisobot oxiri. Tuzatishni xohlasangiz, qaysi qadamdan boshlashni ayting — kodni o'zgartirib, har bir o'zgarishni sinab beraman.*
