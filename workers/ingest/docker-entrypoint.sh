#!/bin/sh
# Always use the latest yt-dlp — YouTube changes its API frequently and old versions break.
pip install -q -U yt-dlp
# Start FastAPI HTTP server in background, then run the pull worker in foreground.
# Both share the same env (injected via docker-compose env_file).
# yt-dlp version is pinned in requirements.txt — rebuild with --no-cache to upgrade.
uvicorn server:app --host 0.0.0.0 --port 8001 &
exec python -u worker.py
