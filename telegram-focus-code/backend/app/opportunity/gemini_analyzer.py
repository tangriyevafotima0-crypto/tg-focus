import os
import re
import json
import logging
import threading
import urllib.error
import urllib.request
from typing import Dict, Any, List, Optional, Tuple
import httpx
from bs4 import BeautifulSoup

from .net_safety import BlockedUrlError, assert_public_url

logger = logging.getLogger(__name__)

# Stage 6 (X-6): Gemini/scraper so'rovlari ko'p ketma-ket chaqirilganda
# (masalan bir nechta imkoniyat bir vaqtda kelsa) bir vaqtning o'zida
# ko'pi bilan 2 ta tashqi HTTP so'rov yuborilishini cheklaydi. Bu modul
# sync funksiyalardan iborat va chaqiruvchilar ularni `asyncio.to_thread`
# orqali chaqiradi, shuning uchun oddiy `threading.Semaphore` ishlatiladi
# (asyncio.Semaphore bu yerda thread-xavfsiz bo'lmagan bo'lardi).
_EXTERNAL_CALL_SEMAPHORE = threading.Semaphore(2)

# Vaqt chegarasi: avval 25s edi, endi 8-10s (bitta sekin so'rov butun
# navbatni ushlab turmasligi uchun; MODEL_CHAIN bir nechta modelni sinab
# ko'radi, shuning uchun har bir urinish qisqa bo'lishi kerak).
_HTTP_TIMEOUT = 9.0

# ==============================================================================
# 1. FOYDALANUVChI DOIMIY XOTIRASI VA MEZONLARI
# ==============================================================================
USER_PROFILE = {
    "age": 16,
    "role": "Maktab o'quvchisi (High School Student)",
    "location": "O'zbekiston (International Applicant)",
    "target_degree": "Undergraduate / Bachelor's",
    "focus_areas": [
        "AQSh va Yevropa nufuzli universitetlariga to'liq grantlar (Full-ride scholarships)",
        "SAT va IELTS imtihonlari natijalari",
        "Biznes, moliya, investitsiya musobaqalari (Wharton Global High School Investment Competition kabi)",
        "Sun'iy intellekt, dasturlash va xalqaro olimpiadalar"
    ],
    "disqualifiers": [
        "Faqat AQSh/Yevropa fuqarolari uchun mo'ljallangan dasturlar",
        "Katta tolov (tuition/application fee) talab qiladigan tijoriy summer camplar"
    ]
}

MODEL_CHAIN = [
    "gemini-3.5-flash",
    "gemini-flash-latest",
    "gemini-3.7-flash",
    "gemini-3.5-flash-lite",
    "gemini-2.5-flash"
]

# ==============================================================================
# 2. CHIDAMLI SKRAPER (ROBUST WEB SCRAPER)
# ==============================================================================
def extract_urls(text: str) -> List[str]:
    if not text:
        return []
    url_pattern = r'(https?://[^\s<>"]+|www\.[^\s<>"]+)'
    urls = re.findall(url_pattern, text)
    cleaned = []
    for u in urls:
        u = u.rstrip(".,;!?)>")
        if not u.startswith("http"):
            u = "https://" + u
        cleaned.append(u)
    return cleaned

def scrape_webpage(url: str, max_chars: int = 4000) -> str:
    """Saytga ulanib, matnni tozalab oladi (xatoliklarga 100% chidamli).

    Stage 6: ichki/lokal manzillarga (SSRF) so'rov yuborilmaydi, TLS
    tekshiruvi yoqilgan (verify=True, standart), vaqt chegarasi qisqartirildi
    va bir vaqtdagi tashqi so'rovlar soni cheklandi.
    """
    if not url:
        return ""
    try:
        assert_public_url(url)
    except BlockedUrlError as e:
        logger.warning("Scrape bloklandi (SSRF himoyasi): %s — %s", url, e)
        return "[Bu manzilga so'rov xavfsizlik sababli bloklandi]"

    with _EXTERNAL_CALL_SEMAPHORE:
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5"
            }
            with httpx.Client(follow_redirects=True, timeout=_HTTP_TIMEOUT, headers=headers, verify=True) as client:
                resp = client.get(url)
                if resp.status_code != 200:
                    return f"[Saytga ulanib bo'lmadi: HTTP {resp.status_code}]"

                soup = BeautifulSoup(resp.text, "html.parser")
                for tag in soup(["script", "style", "nav", "footer", "header", "noscript", "svg", "form"]):
                    tag.decompose()

                raw_text = " ".join(soup.stripped_strings)
                clean_text = re.sub(r'\s+', ' ', raw_text)
                return clean_text[:max_chars]
        except Exception as e:
            logger.warning(f"Skraping xatosi ({url}): {e}")
            return f"[Saytdan ma'lumot olishda uzilish: {str(e)[:100]}]"

# ==============================================================================
# 3. GEMINI API VA XATOLIKLARGA CHIDAMLI MULOQOT
# ==============================================================================
def call_gemini_raw(contents: list, system_instruction: str, max_tokens: int = 3000) -> str:
    """Gemini modellar zanjiridan birinchi muvaffaqiyatli javobni qaytaradi.

    Stage 6: API kalit endi URL ichida emas, `x-goog-api-key` sarlavhasida
    (loglarga/proksi tarixiga tushib qolmasligi uchun). Vaqt chegarasi
    qisqartirildi, bir vaqtdagi so'rovlar soni cheklandi va har bir
    muvaffaqiyatsiz urinish aniq sabab bilan logga yoziladi (avval
    `except Exception: continue` — sabab butunlay yo'qolardi).
    """
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        return ""

    # Stage 6 (X-5): API kalit endi so'rov tanasiga emas, URL query string'iga
    # ham qo'yilmaydi — `x-goog-api-key` sarlavhasiga ko'chirildi, shunda u
    # server/proksi loglariga, brauzer tarixiga yoki Referer sarlavhalariga
    # tushib qolish xavfi kamayadi (`urllib.request` darajasida saqlanadi —
    # test to'plami buni mock qiladi, shuning uchun httpx'ga o'tkazilmadi).
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": api_key,
    }

    with _EXTERNAL_CALL_SEMAPHORE:
        for model in MODEL_CHAIN:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            payload = {
                "contents": contents,
                "systemInstruction": {"parts": [{"text": system_instruction}]},
                "generationConfig": {"temperature": 0.2, "maxOutputTokens": max_tokens}
            }
            try:
                req = urllib.request.Request(
                    url, data=json.dumps(payload).encode("utf-8"), headers=headers
                )
                # Vaqt chegarasi: avval 25s edi, endi _HTTP_TIMEOUT (9s) —
                # bitta sekin so'rov butun navbatni ushlab turmasligi uchun.
                # TLS tekshiruvi standart ssl kontekst bilan yoqilgan holda
                # qoladi (avval bu yerda hech qachon o'chirilmagan edi).
                with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as resp:
                    status = getattr(resp, "status", 200)
                    data = json.loads(resp.read().decode("utf-8"))
                    ans = data.get("candidates", [])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                    if ans.strip():
                        return ans.strip()
                    logger.warning("Gemini (%s): bo'sh javob qaytdi (status=%s), keyingi modelga o'tilmoqda", model, status)
            except urllib.error.HTTPError as e:
                # Xatolarni yutmaslik (X-7): avval `except Exception: continue`
                # sabab va status kodini butunlay yashirardi. Endi 429/404 va
                # boshqa HTTP xatolar farqlanadi va logga yoziladi.
                if e.code == 429:
                    logger.warning("Gemini (%s): 429 — limitga yetildi, keyingi modelga o'tilmoqda", model)
                elif e.code == 404:
                    logger.warning("Gemini (%s): 404 — model topilmadi, keyingi modelga o'tilmoqda", model)
                else:
                    logger.warning("Gemini (%s): HTTP xato %s, keyingi modelga o'tilmoqda", model, e.code)
            except urllib.error.URLError as e:
                if isinstance(e.reason, TimeoutError) or "timed out" in str(e.reason).lower():
                    logger.warning("Gemini (%s): vaqt tugadi (%ss), keyingi modelga o'tilmoqda", model, _HTTP_TIMEOUT)
                else:
                    logger.warning("Gemini (%s): tarmoq xatosi — %s, keyingi modelga o'tilmoqda", model, e.reason)
            except TimeoutError:
                logger.warning("Gemini (%s): vaqt tugadi (%ss), keyingi modelga o'tilmoqda", model, _HTTP_TIMEOUT)
            except Exception as e:
                logger.exception("Gemini (%s): kutilmagan xato — %s", model, e)
    return ""

# ==============================================================================
# 4. CHUQUR IMKONIYAT VA MOLIYAVIY TAHLIL (ROBUST OPPORTUNITY ANALYZER)
# ==============================================================================
def analyze_opportunity_deeply(post_text: str, web_url: Optional[str] = None) -> Dict[str, Any]:
    urls = extract_urls(post_text)
    target_url = web_url or (urls[0] if urls else "")
    web_text = scrape_webpage(target_url) if target_url else ""

    sys_prompt = f"""Sen o'ta talabchan 'Chief of Staff' va saralovchisan.
FOYDALANUVChI XOTIRASI:
{json.dumps(USER_PROFILE, ensure_ascii=False, indent=2)}

VAZIFA: Ushbu e'lon va sayt matnini o'rganib, quyidagi JSON formatida aniq tahlil ber.
Faqat toza JSON qaytar, begona so'z qo'shma:
{{
  "title": "Imkoniyat yoki Musobaqa nomi",
  "organization": "Tashkilotchi",
  "is_free": true yoki false,
  "cost_type": "Mutlaqo bepul" | "To'liq grant (stipendiya bilan)" | "Pullik (badal talab qilinadi)",
  "cost_details": "Narx, badal yoki to'liq stipendiya miqdori",
  "is_relevant": true yoki false — FAQAT quyidagi holatlarda false qo'y: (a) bu post
    umuman imkoniyat/musobaqa/grant e'loni EMAS (masalan oddiy suhbat, reklama,
    tabriknoma, yangilik bo'lsa), yoki (b) "disqualifiers" ro'yxatidagi shartlardan
    biriga to'g'ridan-to'g'ri va shubhasizlik bilan tegishli ekani matndan aniq
    ko'rinib tursa. Shubhali yoki noaniq holatlarda true qo'y — qaror oxir-oqibat
    match_percentage orqali qabul qilinadi, shuning uchun is_relevant yagona yagona
    darvoza bo'lmasligi kerak.
  "match_percentage": 0 dan 100 gacha raqam,
  "match_reasons": ["Mos kelgan jihatlar"],
  "unfit_reasons": ["To'g'ri kelmagan sabablar (yosh, fuqarolik, katta summa)"],
  "deadline": "Oxirgi ariza sanasi yoki 'Ko'rsatilmagan'",
  "one_sentence_verdict": "Foydalanuvchiga 1 jumlalik qat'iy tavsiya"
}}
"""
    prompt = f"XABAR MATNI:\n{post_text}\n\nSAYTDAN OLINGAN MATN ({target_url}):\n{web_text}"
    raw = call_gemini_raw([{"parts": [{"text": prompt}]}], sys_prompt, max_tokens=3000)

    if not raw:
        # Stage 6: Gemini umuman javob bermadi (kalit yo'q, tarmoq xatosi,
        # barcha modellar 429/404 qaytardi va h.k.) — avval bu holatda ham
        # o'ylab topilgan "85% mos" soxta natija qaytarilardi, bu esa
        # foydalanuvchini AI haqiqatan baholagan deb chalg'itardi. Endi aniq
        # "AI mavjud emas" holati qaytariladi; regex/zaxira qoliplar esa
        # faqat yordamchi ma'lumot sifatida (is_free/cost_type) beriladi,
        # match_percentage va is_relevant esa "noma'lum" deb belgilanadi —
        # chaqiruvchi (_ai_confirms) buni bloklamaydigan holat sifatida
        # o'qishi kerak (result["ai_available"] == False).
        is_paid = bool(re.search(r'\bfee\b|\$|payment|tuition|\bpullik\b|\btolov\b', post_text + web_text, re.I))
        is_free = bool(re.search(r'fully funded|\bfree\b|\bbepul\b|stipendiya|scholarship', post_text + web_text, re.I))
        return {
            "title": "Tahlil qilingan imkoniyat",
            "organization": "Xabardan olindi",
            "is_free": not is_paid or is_free,
            "cost_type": "Mutlaqo bepul / Grant" if is_free else ("Pullik" if is_paid else "Aniq ko'rsatilmagan"),
            "cost_details": "AI mavjud emas — saytga kirib qo'lda aniqlashtirish tavsiya etiladi",
            "is_relevant": None,
            "match_percentage": None,
            "match_reasons": [],
            "unfit_reasons": ["Yashirin tolovlar bo'lishi mumkin"] if is_paid else [],
            "deadline": "Ko'rsatilmagan",
            "one_sentence_verdict": "AI tahlili hozircha mavjud emas — ma'lumotlar faqat matn qidiruvidan.",
            "ai_available": False,
        }

    try:
        clean = re.sub(r'^```json\s*', '', raw, flags=re.MULTILINE)
        clean = re.sub(r'\s*```$', '', clean, flags=re.MULTILINE).strip()
        parsed = json.loads(clean)
        parsed.setdefault("ai_available", True)
        return parsed
    except Exception:
        # Gemini javob berdi, lekin JSON buzilgan (format xatosi) — bu ham
        # haqiqiy AI bahosi EMAS, shuning uchun xuddi "javob yo'q" holati
        # kabi aniq belgilanadi, o'ylab topilgan foiz qaytarilmaydi.
        logger.warning("Gemini javobini JSON qilib o'qib bo'lmadi: %r", raw[:200])
        return {
            "title": "Tahlil qilingan imkoniyat",
            "organization": "Xabardan olindi",
            "is_free": None,
            "cost_type": "Aniq ko'rsatilmagan",
            "cost_details": "AI javobi noto'g'ri formatda keldi — qo'lda tekshiring",
            "is_relevant": None,
            "match_percentage": None,
            "match_reasons": [],
            "unfit_reasons": [],
            "deadline": "Ko'rsatilmagan",
            "one_sentence_verdict": "AI javobini o'qib bo'lmadi — qo'lda ko'rib chiqish tavsiya etiladi.",
            "ai_available": False,
        }

# ==============================================================================
# 5. CHAT VA UI KONTEKSTINI JONLI TAHLIL QILISH
# ==============================================================================
def generate_chat_response(message: str, history: List[Dict[str, Any]], facts: Dict[str, Any], current_context: Optional[Dict[str, Any]] = None) -> Tuple[str, str]:
    recent_msgs = "\n".join(facts.get("recent_messages", [])[-15:])
    
    # Ekranda ochiq turgan joy
    screen_info = ""
    if current_context:
        tab = current_context.get("active_tab", "Telegram")
        source = current_context.get("active_source", "Umumiy")
        visible = current_context.get("visible_items", "")
        screen_info = (
            f"\n[FOYDALANUVChINING HOZIRGI EKRAN HOLATI]:\n"
            f"- Bo'lim: {tab} | Manba: {source}\n"
            f"- Ekranda ochiq xabarlar:\n{visible[:1200]}\n"
        )

    # Savolda havola bo'lsa, uni darhol skraping qilish
    urls = extract_urls(message)
    scraped_part = ""
    if urls:
        scraped_part = f"\n\n[SAVOLDAGI HAVOLA SAYTI O'QILDI ({urls[0]})]:\n{scrape_webpage(urls[0], 2500)}\n"

    # Ekranda ochiq turgan imkoniyat kartasida havola bo'lsa, uni ham o'qib olish
    if not urls and current_context:
        visible = current_context.get("visible_items", "") or ""
        screen_urls = re.findall(r"\[HAVOLA: (https?://[^\]]+)\]", visible)
        if screen_urls:
            scraped_part = (
                f"\n\n[EKRANDAGI IMKONIYAT HAVOLASI O'QILDI ({screen_urls[0]})]:\n"
                f"{scrape_webpage(screen_urls[0], 2500)}\n"
            )

    sys_instruct = f"""Sen 16 yoshli o'quvchining shaxsiy 'Chief of Staff' (katta akasi)san.
FOYDALANUVChI XOTIRASI:
{json.dumps(USER_PROFILE, ensure_ascii=False, indent=2)}

QOIDALAR:
- Har bir fikr va jumlani oxirigacha mantiqan yakunla. Hech qachon ro'yxat yoki gap o'rtasida to'xtab qolma (YARIMTA GAP BILAN TO'XTAMA).
1. Foydalanuvchi hozir ekranning qaysi qismida turganini to'liq ko'rib turibsan.
2. Agar u 'buni tekshir', 'xatga nima deymiz', 'bular nima haqida' desa, to'g'ridan-to'g'ri ochiq turgan xabarlarga va tanlangan manbaga qarab javob ber.
3. Imkoniyatlar va kurslar bo'yicha: pullimi yoki tekin, yoshiga to'g'ri keladimi - vaqtini tejash uchun ochiqchasiga ayt.
4. Uslub: O'zbekcha, o'ta londa, aniq, dalillarga asoslangan do'stona aka uslubi."""

    contents = []
    for h in history[-5:]:
        role = "user" if h.get("sender") == "user" else "model"
        contents.append({"role": role, "parts": [{"text": h.get("text", "")}]})

    full_prompt = (
        f"{screen_info}\n"
        f"BAZADAGI ASOSIY XABARLAR:\n{recent_msgs}\n"
        f"{scraped_part}\n"
        f"SAVOL: {message}"
    )
    contents.append({"role": "user", "parts": [{"text": full_prompt}]})

    ans = call_gemini_raw(contents, sys_instruct, max_tokens=3000)
    if not ans:
        ans = "Xabaringizni qabul qildim. Hozirgi ochiq xabarlar va asosiy maqsadlarimiz bo'yicha ishlashda davom etamiz."
    return ans, "gemini-screen-aware"

def generate_welcome_briefing(facts: Dict[str, Any]) -> Tuple[str, str]:
    tg = facts.get("telegram", {}).get("unread_count", 0)
    rule = facts.get("rule_of_one_focus", "Universitet arizalari")
    prompt = f"Yangi xabarlar: {tg} ta. Asosiy fokus: {rule}. O'quvchiga 2 jumla bilan samimiy salom va kunlik start vazifasini ayt."
    ans = call_gemini_raw([{"parts": [{"text": prompt}]}], "Sen Chief of Staff mentorisan. O'zbekcha qisqa javob ber.")
    return ans or f"Assalomu alaykum! Bazada {tg} ta yangi Telegram xabari bor. Asosiy diqqatni '{rule}' vazifasiga qaratamiz!", "gemini-intelligence"

# ==============================================================================
# 6. ROUTERLAR UCHUN XATOSIZ IMPORT ALIASLARI (ZERO-REGRESSION)
# ==============================================================================
def generate_ai_briefing(payload: Any = None, *args, **kwargs) -> str:
    if isinstance(payload, dict):
        res, _ = generate_welcome_briefing(payload)
        return res
    res, _ = generate_welcome_briefing({})
    return str(res)

def analyze_opportunity(post_text: str = "", web_url: Optional[str] = None, *args, **kwargs) -> Dict[str, Any]:
    # STAGE 9: Magistratura/PhD grantlarini maktab o'quvchisi uchun 0 ball qilish
    _check = str(post_text).lower()
    _disqualify = ["master's", "masters", "magistratura", "phd", "postgraduate", "doktorantura", "university graduates"]
    if any(k in _check for k in _disqualify):
        return {
            "title": "Nomuvofiq grant",
            "summary": "Maktab o'quvchisiga to'g'ri kelmaydi (Magistratura/PhD)",
            "match_percentage": 0,
            "match_score": 0,
            "is_eligible": False,
            "category": "other",
            "ai_available": True
        }
    return analyze_opportunity_deeply(post_text, web_url)
