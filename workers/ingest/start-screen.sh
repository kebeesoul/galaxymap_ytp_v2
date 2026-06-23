#!/bin/bash
# Start the pull ingest worker in a detached screen session.
# Use this when macOS LaunchAgent cannot access a repo under Desktop/Documents.
set -euo pipefail

SESSION_NAME="galaxymap-ingest"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
STDOUT_LOG="/tmp/galaxymap-ingest.log"
STDERR_LOG="/tmp/galaxymap-ingest-error.log"

if ! command -v screen >/dev/null 2>&1; then
  echo "screen is required for detached ingest worker mode." >&2
  exit 1
fi

screen -S "${SESSION_NAME}" -X quit >/dev/null 2>&1 || true
: > "${STDOUT_LOG}"
: > "${STDERR_LOG}"

screen -dmS "${SESSION_NAME}" bash -lc \
  "cd \"${PROJECT_ROOT}\" && \"${SCRIPT_DIR}/run-worker.sh\" >> \"${STDOUT_LOG}\" 2>> \"${STDERR_LOG}\""

screen -ls || true
