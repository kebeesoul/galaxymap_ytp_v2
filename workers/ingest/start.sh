#!/bin/bash
# Start the ingest worker + Cloudflare Tunnel together.
# Worker binds to localhost:8001, tunnel exposes it as a public HTTPS URL.
set -euo pipefail

# Launch FastAPI worker in background
uvicorn server:app --host 0.0.0.0 --port 8001 &
WORKER_PID=$!

# Ensure worker is killed when this script exits
trap "kill $WORKER_PID 2>/dev/null || true" EXIT

# Run Cloudflare Tunnel in foreground (prints public URL to stdout)
cloudflared tunnel --url http://localhost:8001

wait
