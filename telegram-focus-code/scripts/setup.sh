#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${PROJECT_DIR}/backend"
ENV_FILE="${BACKEND_DIR}/.env"
VENV_DIR="${PROJECT_DIR}/venv"
SERVICE_NAME="telegram-focus"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

log() { printf '\n[%s] %s\n' "telegram-focus" "$*"; }
warn() { printf '\n[%s] OGohlantirish: %s\n' "telegram-focus" "$*" >&2; }
die() { printf '\n[%s] XATO: %s\n' "telegram-focus" "$*" >&2; exit 1; }

on_error() {
    local exit_code=$?
    printf '\n[%s] Buyruq muvaffaqiyatsiz tugadi (exit %s): %s\n' \
        "telegram-focus" "$exit_code" "$BASH_COMMAND" >&2
    exit "$exit_code"
}
trap on_error ERR

if [[ "${EUID}" -eq 0 ]]; then
    SUDO=""
else
    command -v sudo >/dev/null 2>&1 || die "sudo topilmadi."
    SUDO="sudo"
fi

[[ -f /etc/os-release ]] || die "/etc/os-release topilmadi; Ubuntu/Debian kerak."
# shellcheck disable=SC1091
source /etc/os-release
case "${ID:-}" in
    ubuntu|debian) ;;
    *) die "Faqat Ubuntu yoki Debian qo‘llanadi (topildi: ${ID:-noma-lum})." ;;
esac

[[ -d "${BACKEND_DIR}" ]] || die "backend/ papkasi topilmadi: ${BACKEND_DIR}"
[[ -f "${BACKEND_DIR}/requirements.txt" ]] || die "backend/requirements.txt topilmadi."

log "Pre-flight tekshiruvlari"
PYTHON_BIN="$(command -v python3.11 || true)"
if [[ -z "${PYTHON_BIN}" ]]; then
    log "Python 3.11 topilmadi; paketlar o‘rnatilmoqda."
    ${SUDO} apt-get update
    ${SUDO} apt-get install -y software-properties-common
    if ! apt-cache show python3.11-venv >/dev/null 2>&1; then
        if [[ "${ID}" == "ubuntu" ]]; then
            ${SUDO} add-apt-repository -y ppa:deadsnakes/ppa
            ${SUDO} apt-get update
        fi
    fi
    ${SUDO} apt-get install -y python3.11 python3.11-venv python3.11-dev
    PYTHON_BIN="$(command -v python3.11 || true)"
fi
[[ -n "${PYTHON_BIN}" ]] || die "python3.11 o‘rnatilmadi."

PYTHON_VERSION=$("${PYTHON_BIN}" -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')
"${PYTHON_BIN}" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' \
    || die "Python 3.11 yoki undan yangi versiya kerak (topildi: ${PYTHON_VERSION})."
log "Python ${PYTHON_VERSION} topildi."

default_port="8000"
if [[ -f "${ENV_FILE}" ]]; then
    # shellcheck disable=SC1090
    set -a
    source "${ENV_FILE}"
    set +a
    default_port="${BACKEND_PORT:-8000}"
else
    log "Interaktiv konfiguratsiya"
    read -r -p "Telegram API ID (faqat raqam): " telegram_api_id
    [[ "${telegram_api_id}" =~ ^[0-9]+$ ]] || die "API ID faqat raqamlardan iborat bo‘lishi kerak."

    read -r -s -p "Telegram API Hash: " telegram_api_hash
    printf '\n'
    [[ -n "${telegram_api_hash}" ]] || die "API Hash bo‘sh bo‘lishi mumkin emas."

    read -r -p "Telegram telefon raqami (+998XXXXXXXXX): " telegram_phone
    [[ "${telegram_phone}" =~ ^\+998[0-9]{9}$ ]] \
        || die "Telefon raqami +998XXXXXXXXX formatida bo‘lishi kerak."

    read -r -p "Backend porti [8000]: " selected_port
    selected_port="${selected_port:-8000}"
    [[ "${selected_port}" =~ ^[0-9]+$ ]] || die "Port raqam bo‘lishi kerak."
    default_port="${selected_port}"

    printf '\nAPI ID: %s\nTelefon: %s\nPort: %s\n' \
        "${telegram_api_id}" "${telegram_phone}" "${default_port}"
    read -r -p "Shu sozlamalarni saqlaymi? [y/N] " confirm
    [[ "${confirm}" =~ ^[Yy]$ ]] || die "Sozlamalar saqlanmadi."

    umask 077
    tmp_env="$(mktemp "${BACKEND_DIR}/.env.tmp.XXXXXX")"
    cat > "${tmp_env}" <<EOF
TELEGRAM_API_ID=${telegram_api_id}
TELEGRAM_API_HASH=${telegram_api_hash}
TELEGRAM_PHONE=${telegram_phone}
DATABASE_URL=sqlite+aiosqlite:///./data/focus.db
BACKEND_HOST=0.0.0.0
BACKEND_PORT=${default_port}
ALLOWED_ORIGINS=http://localhost:${default_port}
EOF
    chmod 600 "${tmp_env}"
    mv -f "${tmp_env}" "${ENV_FILE}"
    unset telegram_api_id telegram_api_hash telegram_phone
    log "backend/.env 600 huquq bilan yaratildi."
fi

[[ "${default_port}" =~ ^[0-9]+$ ]] || die "BACKEND_PORT noto‘g‘ri."
(( default_port >= 1 && default_port <= 65535 )) || die "Port 1–65535 oralig‘ida bo‘lishi kerak."

if command -v ss >/dev/null 2>&1 && ss -ltn "( sport = :${default_port} )" | tail -n +2 | grep -q .; then
    warn "Port ${default_port} band."
    read -r -p "Boshqa port tanlang (bekor qilish uchun bo‘sh qoldiring): " alternative_port
    [[ -n "${alternative_port}" ]] || die "Port bandligi hal qilinmadi."
    [[ "${alternative_port}" =~ ^[0-9]+$ ]] || die "Yangi port raqam bo‘lishi kerak."
    default_port="${alternative_port}"
    (( default_port >= 1 && default_port <= 65535 )) || die "Port 1–65535 oralig‘ida bo‘lishi kerak."
fi

log "Virtual muhit tayyorlanmoqda"
if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
    "${PYTHON_BIN}" -m venv "${VENV_DIR}"
fi
"${VENV_DIR}/bin/python" -m pip install --upgrade pip
"${VENV_DIR}/bin/python" -m pip install -r "${BACKEND_DIR}/requirements.txt"

mkdir -p "${BACKEND_DIR}/data"
chmod 750 "${BACKEND_DIR}/data"

if [[ -f "${BACKEND_DIR}/app/telethon_client.py" ]]; then
    log "Telethon birinchi login jarayoni boshlanadi."
    (
        cd "${BACKEND_DIR}"
        "${VENV_DIR}/bin/python" -m app.telethon_client
    )
    session_file=$(find "${BACKEND_DIR}" -maxdepth 1 -type f -name \*.session -print -quit)
    [[ -n "${session_file}" ]] || die "Login tugadi, lekin .session fayli topilmadi."
    chmod 600 "${session_file}"
    log "Telethon session fayli yaratildi."
else
    warn "backend/app/telethon_client.py hali yo‘q; login Bosqich 2 dan keyin bajariladi."
fi

if [[ -f "${BACKEND_DIR}/app/main.py" ]]; then
    host="${BACKEND_HOST:-0.0.0.0}"
    cat > "/tmp/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Telegram Focus backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=${BACKEND_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${VENV_DIR}/bin/uvicorn app.main:app --host ${host} --port ${default_port}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    ${SUDO} install -m 644 "/tmp/${SERVICE_NAME}.service" "${SERVICE_FILE}"
    rm -f "/tmp/${SERVICE_NAME}.service"
    ${SUDO} systemctl daemon-reload
    ${SUDO} systemctl enable "${SERVICE_NAME}"
    ${SUDO} systemctl restart "${SERVICE_NAME}"

    sleep 5
    if ! ${SUDO} systemctl is-active --quiet "${SERVICE_NAME}"; then
        warn "Service ishga tushmadi. Oxirgi loglar:"
        ${SUDO} journalctl -u "${SERVICE_NAME}" -n 30 --no-pager || true
        die "Service xatosini yuqoridagi logdan tuzating."
    fi

    if command -v curl >/dev/null 2>&1 && ! curl --fail --silent --show-error \
        "http://127.0.0.1:${default_port}/docs" >/dev/null; then
        warn "Service active, ammo /docs healthcheck muvaffaqiyatsiz."
        ${SUDO} journalctl -u "${SERVICE_NAME}" -n 30 --no-pager || true
        die "Backend healthcheck muvaffaqiyatsiz."
    fi
    log "Service ishga tushdi: ${SERVICE_NAME}"
else
    warn "backend/app/main.py hali yo‘q; systemd va healthcheck Bosqich 3 dan keyin bajariladi."
fi

log "Sozlash yakunlandi."