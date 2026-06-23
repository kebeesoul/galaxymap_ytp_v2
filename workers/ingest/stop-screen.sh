#!/bin/bash
# Stop the detached pull ingest worker session started by start-screen.sh.
set -euo pipefail

SESSION_NAME="galaxymap-ingest"

screen -S "${SESSION_NAME}" -X quit >/dev/null 2>&1 || true
screen -ls || true
