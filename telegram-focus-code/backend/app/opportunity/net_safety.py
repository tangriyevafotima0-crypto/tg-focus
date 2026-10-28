"""net_safety.py — tashqi HTTP so'rovlari uchun umumiy SSRF himoyasi.

`scraper.py` va `gemini_analyzer.py` foydalanadigan ichki/lokal manzillarni
bloklash funksiyasi. Alohida modulga chiqarilgan — ikkala joyda bir xil
mantiq ishlatilsin va kelajakda yangi tashqi chaqiruvlar ham shu yerdan
foydalansin.
"""
from __future__ import annotations

import ipaddress
import logging
import socket
from urllib.parse import urlparse

logger = logging.getLogger("telegram_focus.net_safety")


class BlockedUrlError(Exception):
    """URL ichki/lokal manzilga ishora qilgani uchun bloklandi."""


def _is_blocked_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True  # parse bo'lmasa — xavfsizlik uchun blokla
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local       # 169.254.0.0/16 (shu jumladan 169.254.169.254 — cloud metadata)
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def assert_public_url(url: str) -> None:
    """URL tashqi (jamoat) manzilga ishora qilishini tekshiradi.

    Lokal/ichki tarmoq yoki cloud-metadata manziliga yo'naltirilgan bo'lsa
    BlockedUrlError ko'taradi. Faqat http/https sxemasiga ruxsat.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise BlockedUrlError(f"Ruxsat etilmagan sxema: {parsed.scheme!r}")

    host = parsed.hostname
    if not host:
        raise BlockedUrlError("URL'da host topilmadi")

    host_lower = host.lower()
    if host_lower in ("localhost", "metadata.google.internal"):
        raise BlockedUrlError(f"Ichki host bloklandi: {host}")

    # Host to'g'ridan-to'g'ri IP bo'lishi mumkin
    try:
        ipaddress.ip_address(host_lower)
        is_literal_ip = True
    except ValueError:
        is_literal_ip = False

    if is_literal_ip:
        if _is_blocked_ip(host_lower):
            raise BlockedUrlError(f"Ichki/lokal IP manzilga so'rov bloklandi: {host}")
        return

    # Domen — DNS orqali barcha natijalarni tekshiramiz (DNS rebinding'dan
    # to'liq himoya qilmaydi, lekin oddiy SSRF urinishlarini to'xtatadi).
    try:
        addrinfo = socket.getaddrinfo(host_lower, None)
    except socket.gaierror as e:
        raise BlockedUrlError(f"Hostni aniqlab bo'lmadi: {host} ({e})")

    for info in addrinfo:
        ip_str = info[4][0]
        if _is_blocked_ip(ip_str):
            raise BlockedUrlError(
                f"Host ichki/lokal IP'ga yo'naltiradi: {host} -> {ip_str}"
            )
