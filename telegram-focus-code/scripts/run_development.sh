#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${PROJECT_DIR}/backend"
VENV_DIR="${PROJECT_DIR}/.venv"
DEV_ENV="${BACKEND_DIR}/.env.development"

if [[ ! -f "${DEV_ENV}" ]]; then
    cp "${BACKEND_DIR}/.env.development.example" "${DEV_ENV}"
    chmod 600 "${DEV_ENV}"
    printf 'backend/.env.development yaratildi. Telegram qiymatlarini kiriting, keyin skriptni qayta ishga tushiring.\n'
    exit 1
fi

if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
    command -v python3.11 >/dev/null 2>&1 || {
        printf 'Python 3.11 topilmadi.\n' >&2
        exit 1
    }
    python3.11 -m venv "${VENV_DIR}"
fi

"${VENV_DIR}/bin/python" -m pip install -q -r "${BACKEND_DIR}/requirements.txt"
mkdir -p "${BACKEND_DIR}/data"

set -a
# shellcheck disable=SC1090
source "${DEV_ENV}"
set +a

cd "${BACKEND_DIR}"
exec "${VENV_DIR}/bin/uvicorn" app.main:app \
    --reload \
    --host "${BACKEND_HOST:-127.0.0.1}" \
    --port "${BACKEND_PORT:-8001}"