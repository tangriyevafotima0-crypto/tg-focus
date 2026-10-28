"""Butun ilova bo'ylab bitta umumiy slowapi Limiter instansi.

main.py va routerlar (auth.py, ai_chat.py) shu yerdan import qiladi —
aylanma import (circular import) muammosining oldini olish uchun.
"""

import os

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

# X-13 (Stage 8): standart `get_remote_address` har doim `request.client.host`
# dan foydalanadi — agar ilova teskari proksi (nginx, Cloudflare va h.k.)
# ortida ishlasa, bu barcha so'rovlar bitta IP (proksi IP'i) dan kelayotgandek
# ko'rinishiga olib keladi, va tezlik chegarasi (masalan login uchun 5/minute)
# amalda butun dunyo uchun umumiy bitta hisoblagichga aylanadi.
#
# Yechim: TRUST_PROXY_HEADERS=true o'rnatilgandagina (ya'ni deploy ma'lum bir
# ishonchli proksi ortida ekani aniq bo'lsa) `X-Forwarded-For` sarlavhasining
# BIRINCHI qiymati (asl mijoz IP'i — proksi zanjiridagi eng chapdagi) olinadi.
# Bu bayroq o'chirilgan holatda (standart) hech narsa o'zgarmaydi — hamon
# `request.client.host` ishlatiladi, chunki ishonchsiz muhitda X-Forwarded-For
# sarlavhasiga istalgan mijoz o'zi xohlagan qiymatni yozib, tezlik chegarasini
# chetlab o'tishi (yoki boshqa IP'ni bloklatib qo'yishi) mumkin.
_TRUST_PROXY_HEADERS = os.getenv("TRUST_PROXY_HEADERS", "false").lower() == "true"


def get_client_ip(request: Request) -> str:
    if _TRUST_PROXY_HEADERS:
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            # "client, proxy1, proxy2" — birinchisi asl mijoz.
            first_ip = forwarded_for.split(",")[0].strip()
            if first_ip:
                return first_ip
    return get_remote_address(request)


limiter = Limiter(key_func=get_client_ip)
