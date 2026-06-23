#!/bin/bash
# Manual test run — load .env.local and start the pull worker directly.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

export PYENV_ROOT="${HOME}/.pyenv"
[[ -d "${PYENV_ROOT}/bin" ]] && export PATH="${PYENV_ROOT}/bin:${PATH}"
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"
export PYTHONUNBUFFERED=1
command -v pyenv &>/dev/null && eval "$(pyenv init -)"

ENV_FILE="${PROJECT_ROOT}/.env.local"
if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${ENV_FILE}"
  set +a
fi

cd "${SCRIPT_DIR}"
if command -v pyenv &>/dev/null; then
  exec pyenv exec python worker.py
fi

exec python3 worker.py
