# Telegram Focus — Production Deploy (v5-FINAL)

Bu qo'llanma shu zip ichidagi kodni **mavjud** serverga (eski `.env`, DB va
Telethon session'lar saqlangan holda) qanday qo'yishni tasvirlaydi. Batafsil
AWS'dan boshlab sozlash uchun `docs/AWS_SETUP.md`, kundalik ishga tushirish
uchun `docs/RUN_GUIDE.md`ga qarang — bu fayl faqat production yangilash
qadamlarini birlashtiradi.

## Talablar

- Ubuntu/Debian server, Python **3.11+** (mahalliy sinovdan 3.12 bilan
  o'tkazilgan)
- `python3-venv`, `pip` (apt: `sudo apt install python3-venv python3-pip`)
- systemd (`telegram-focus.service` nomi bilan xizmat sifatida ishga
  tushiriladi deb faraz qilinadi — agar hali yaratilmagan bo'lsa, pastdagi
  namunani ishlating)
- Mavjud `backend/.env`, `backend/data/focus.db` va `backend/*.session`
  fayllari (bular bu zip ichida **yo'q** — eski serverdan saqlanadi)

## Muhim ogohlantirish

**`.env`, `*.db` va Telethon session fayllari (`*.session`,
`*.session-journal`) bu zip'da YO'Q va bo'lmasligi kerak ham.** Ular
maxfiy kalitlar va yagona Telegram login holatini o'zida saqlaydi —
qayta yaratilsa (masalan bo'sh `.env` bilan ustidan yozilsa) autentifikatsiya
va Telegram ulanishi buziladi. Har doim eski serverdagi nusxalarni saqlab
qoling va yangi kodni ularning USTIGA emas, ULAR BILAN BIRGA joylashtiring.

## O'rnatish qadamlari (yangi server, birinchi marta)

```bash
sudo apt update && sudo apt install -y python3-venv python3-pip
cd /home/ubuntu
unzip v5-FINAL.zip -d telegram-focus
cd telegram-focus
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
# backend/.env faylini haqiqiy qiymatlar bilan to'ldiring: APP_PASSWORD,
# TELEGRAM_API_ID/HASH/PHONE, GEMINI_API_KEY, va h.k.
mkdir -p backend/data backend/logs
```

Birinchi Telethon login (interaktiv, faqat bir marta kerak):

```bash
cd backend
../venv/bin/python -m app.telethon_client
```

Telegram SMS/kod va (agar yoqilgan bo'lsa) 2FA parolini terminalga
kiriting. Bu `backend/*.session` faylini yaratadi — undan keyin saqlang.

Systemd xizmati (`/etc/systemd/system/telegram-focus.service`):

```ini
[Unit]
Description=Telegram Focus API
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/telegram-focus/backend
EnvironmentFile=/home/ubuntu/telegram-focus/backend/.env
ExecStart=/home/ubuntu/telegram-focus/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now telegram-focus
sudo systemctl status telegram-focus --no-pager
curl -s http://localhost:8000/api/health
```

## Mavjud serverni yangilash (kod-only update, bu zip uchun asosiy holat)

Bu — `.env`, DB va session'larni saqlab, faqat kodni yangilaydi:

```bash
sudo systemctl stop telegram-focus

# 1) Zaxira
cd /home/ubuntu
tar czf telegram-focus-BACKUP-$(date +%Y%m%d-%H%M%S).tar.gz telegram-focus/

# 2) Muhim fayllarni vaqtincha saqlash
mkdir -p /tmp/preserve
cp telegram-focus/backend/.env /tmp/preserve/.env
cp telegram-focus/backend/data/focus.db /tmp/preserve/focus.db 2>/dev/null || true
find telegram-focus/backend -maxdepth 1 -name "*.session*" -exec cp {} /tmp/preserve/ \;

# 3) Yangi kodni alohida joyga ochish
mkdir -p /tmp/new_code && cd /tmp/new_code
unzip -o /tmp/v5-FINAL.zip

# 4) Tasdiqlash: yangi kodda maxfiy fayllar yo'q
find /tmp/new_code -name "*.env" -o -name "*.db" -o -name "*.session*"

# 5) Kodni ustiga yozish (maxfiy fayllarni chetlab o'tib)
rsync -av --exclude='.env' --exclude='*.db' --exclude='*.session*' \
  --exclude='venv/' --exclude='__pycache__/' \
  /tmp/new_code/ /home/ubuntu/telegram-focus/

# 6) Muhim fayllarni qaytarish
cp /tmp/preserve/.env /home/ubuntu/telegram-focus/backend/.env
cp /tmp/preserve/focus.db /home/ubuntu/telegram-focus/backend/data/focus.db 2>/dev/null || true
cp /tmp/preserve/*.session* /home/ubuntu/telegram-focus/backend/ 2>/dev/null || true

# 7) Yangi kutubxonalarni o'rnatish
/home/ubuntu/telegram-focus/venv/bin/pip install -r /home/ubuntu/telegram-focus/backend/requirements.txt

# 8) Sintaksis tekshiruvi (xizmatni ishga tushirishdan OLDIN)
cd /home/ubuntu/telegram-focus/backend
/home/ubuntu/telegram-focus/venv/bin/python -m py_compile app/main.py
find app -name "*.py" -exec /home/ubuntu/telegram-focus/venv/bin/python -m py_compile {} \;

# 9) Ishga tushirish va tasdiqlash
sudo systemctl daemon-reload
sudo systemctl start telegram-focus
sleep 3
sudo systemctl status telegram-focus --no-pager
curl -s http://localhost:8000/api/health
sudo journalctl -u telegram-focus -n 40 --no-pager

# 10) Hammasi yashil bo'lsa — tozalash
rm -rf /tmp/new_code /tmp/preserve /tmp/v5-FINAL.zip
```

**Xato chiqsa, darhol qaytarish:**

```bash
sudo systemctl stop telegram-focus
cd /home/ubuntu
rm -rf telegram-focus
tar xzf telegram-focus-BACKUP-*.tar.gz
sudo systemctl start telegram-focus
```

Zaxira arxivini muammosiz ishga tushgandan keyin ham bir necha kun saqlang.

## Testlarni ishga tushirish (deploy'dan oldin, lokal yoki CI'da)

```bash
cd backend
../venv/bin/python -m pytest tests/ -v
# yoki pytest'siz to'g'ridan-to'g'ri:
../venv/bin/python tests/test_auth.py
../venv/bin/python tests/test_feed_sorting.py
```

Barcha testlar tarmoqsiz, xotiradagi SQLite bilan ishlaydi — haqiqiy
Telegram/Gemini credentials talab qilinmaydi.
