#!/bin/sh
# Start FastAPI HTTP server in background, then run the pull worker in foreground.
# Both share the same env (injected via docker-compose env_file).
uvicorn server:app --host 0.0.0.0 --port 8001 &
exec python worker.py
