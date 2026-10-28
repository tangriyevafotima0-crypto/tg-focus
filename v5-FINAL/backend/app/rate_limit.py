"""Butun ilova bo'ylab bitta umumiy slowapi Limiter instansi.

main.py va routerlar (auth.py, ai_chat.py) shu yerdan import qiladi —
aylanma import (circular import) muammosining oldini olish uchun.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
