#!/bin/bash
# Pull-worker wrapper — reads .env.local, loads pyenv, starts polling worker.
# Invoked by launchd LaunchAgent: auto-starts on login, auto-restarts on crash.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Load pyenv if installed
export PYENV_ROOT="${HOME}/.pyenv"
[[ -d "${PYENV_ROOT}/bin" ]] && export PATH="${PYENV_ROOT}/bin:${PATH}"
command -v pyenv &>/dev/null && eval "$(pyenv init -)"

# Read env vars from .env.local so Supabase credentials are available
ENV_FILE="${PROJECT_ROOT}/.env.local"
if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${ENV_FILE}"
  set +a
fi

cd "${SCRIPT_DIR}"
exec python worker.py
