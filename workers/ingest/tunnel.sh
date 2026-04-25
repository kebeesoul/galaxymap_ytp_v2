#!/bin/bash
# Cloudflare Tunnel — expose local ingest worker (localhost:8001) as public HTTPS URL.
# Paste the generated *.trycloudflare.com URL into Railway PYTHON_WORKER_URL.
set -euo pipefail
cloudflared tunnel --url http://localhost:8001
