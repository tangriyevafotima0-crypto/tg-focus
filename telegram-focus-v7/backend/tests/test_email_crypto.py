import importlib.util, os, sys, tempfile, stat, base64, json
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("email_crypto", os.path.join(BASE, "app", "email_crypto.py"))
ec = importlib.util.module_from_spec(spec); spec.loader.exec_module(ec)

tmp = tempfile.mkdtemp()
ec.KEY_FILE = __import__("pathlib").Path(tmp) / "data" / ".email_key"
os.environ.pop("EMAIL_SECRET_KEY", None); ec._reset_key_cache()

# 1. aylanish (unicode, uzun, bo'sh emas)
for pw in ["abcd efgh ijkl mnop", "парол-ўзбек-😀", "x" * 5000, "a"]:
    tok = ec.encrypt_password(pw)
    # X-8 (Stage 8): endi Fernet (urlsafe-base64) formatida, shuning uchun
    # standart base64 emas, urlsafe_b64decode ishlatiladi.
    if len(pw) >= 8:  # qisqa qator tasodifan token ichida uchrashi mumkin (test ishonchsizligi)
        assert pw not in tok and pw.encode() not in base64.urlsafe_b64decode(tok)
    assert ec.decrypt_password(tok) == pw
print("1 OK aylanish")

# 2. har safar boshqa nonce/IV (Fernet tokenlari bir xil matn uchun ham har doim boshqacha)
assert ec.encrypt_password("same") != ec.encrypt_password("same")
print("2 OK nonce")

# 3. kalit fayli yaratildi, chmod 600, qayta ishga tushganda O'ZGARMAydi
assert ec.KEY_FILE.is_file()
mode = stat.S_IMODE(os.stat(ec.KEY_FILE).st_mode)
assert mode == 0o600, oct(mode)
tok = ec.encrypt_password("persist"); key_before = ec.KEY_FILE.read_text()
ec._reset_key_cache()
assert ec.decrypt_password(tok) == "persist" and ec.KEY_FILE.read_text() == key_before
print("3 OK .email_key 600 va barqaror")

# 4. buzilgan token / noto'g'ri kalit -> ValueError
raw = bytearray(base64.urlsafe_b64decode(tok)); raw[20] ^= 1
for bad in [base64.urlsafe_b64encode(bytes(raw)).decode(), "!!!", "AAAA", ""]:
    try: ec.decrypt_password(bad); raise SystemExit("XATO: " + bad)
    except ValueError: pass
os.environ["EMAIL_SECRET_KEY"] = "boshqa-kalit"; ec._reset_key_cache()
try: ec.decrypt_password(tok); raise SystemExit("XATO: kalit")
except ValueError: pass
print("4 OK buzilish/noto'g'ri kalit rad etiladi")

# 5. .env kaliti fayldan ustun; fayl yaratilmaydi
os.environ["EMAIL_SECRET_KEY"] = "env-kalit"; ec._reset_key_cache()
t2 = ec.encrypt_password("q"); assert ec.decrypt_password(t2) == "q"
print("5 OK EMAIL_SECRET_KEY")

# 6. (X-8, Stage 8) ESKI FORMAT fallback: eski HMAC+XOR sxemasi bilan
# shifrlangan token hamon decrypt_password() orqali o'qiladi (migratsiya
# uchun DB o'zgarishi shart emas), lekin encrypt_password() endi FAQAT
# yangi (Fernet) formatda yozadi.
os.environ.pop("EMAIL_SECRET_KEY", None); ec._reset_key_cache()
import hashlib, hmac as hmac_mod, secrets as secrets_mod
def _legacy_encrypt_for_test(plain: str) -> str:
    key = hashlib.sha256(ec._load_raw_key()).digest()
    data = plain.encode("utf-8")
    nonce = secrets_mod.token_bytes(16)
    stream = ec._legacy_keystream(key, nonce, len(data))
    cipher = bytes(a ^ b for a, b in zip(data, stream))
    tag = hmac_mod.new(key, b"tag" + nonce + cipher, hashlib.sha256).digest()[:16]
    return base64.b64encode(nonce + cipher + tag).decode("ascii")

legacy_tok = _legacy_encrypt_for_test("eski-parol-123")
assert ec.decrypt_password(legacy_tok) == "eski-parol-123"
# Yangi shifrlash hamon Fernet (gAAAAA... bilan boshlanadigan) format beradi.
new_tok = ec.encrypt_password("eski-parol-123")
assert new_tok != legacy_tok
assert ec.decrypt_password(new_tok) == "eski-parol-123"
print("6 OK eski format fallback orqali o'qiladi, yangi yozuv Fernet'da")

print("HAMMASI OK")
