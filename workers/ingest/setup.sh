#!/bin/bash
# One-time setup: register ingest worker as macOS LaunchAgent.
# After this runs, worker.py starts automatically on every login and restarts on crash.
# No cloudflared needed — worker connects outbound to Supabase only.
set -euo pipefail

LAUNCHAGENT_LABEL="com.galaxymap.ingest"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LAUNCHAGENT_PLIST="${HOME}/Library/LaunchAgents/${LAUNCHAGENT_LABEL}.plist"

export PYENV_ROOT="${HOME}/.pyenv"
[[ -d "${PYENV_ROOT}/bin" ]] && export PATH="${PYENV_ROOT}/bin:${PATH}"
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"
command -v pyenv &>/dev/null && eval "$(pyenv init -)"

echo ""
echo "=== galaxymap ingest worker — 설치 ==="
echo ""

# ── Step 1: Python 의존성 확인 ────────────────────────────────────────────────
echo "[1/2] Python 의존성 설치..."
if command -v pyenv &>/dev/null; then
  pyenv exec python -m pip install -r "${SCRIPT_DIR}/requirements.txt"
else
  python3 -m pip install -r "${SCRIPT_DIR}/requirements.txt"
fi
echo "      완료"

# ── Step 2: LaunchAgent 등록 ──────────────────────────────────────────────────
echo ""
echo "[2/2] LaunchAgent 등록..."
chmod +x "${SCRIPT_DIR}/run-worker.sh"

mkdir -p "${HOME}/Library/LaunchAgents"
cat > "${LAUNCHAGENT_PLIST}" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCHAGENT_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${SCRIPT_DIR}/run-worker.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>${SCRIPT_DIR}</string>
    <key>StandardOutPath</key>
    <string>/tmp/galaxymap-ingest.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/galaxymap-ingest-error.log</string>
    <key>ThrottleInterval</key>
    <integer>5</integer>
</dict>
</plist>
PLIST

launchctl unload "${LAUNCHAGENT_PLIST}" 2>/dev/null || true
launchctl load "${LAUNCHAGENT_PLIST}"
echo "      완료"

# ── 완료 ────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  ✅  설치 완료                                          ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║                                                          ║"
echo "║  Railway 환경 변수: PYTHON_WORKER_URL 불필요             ║"
echo "║  워커가 Supabase를 직접 폴링합니다 (outbound only)       ║"
echo "║                                                          ║"
echo "║  자동 시작: Mac 로그인 시 worker.py 자동 실행            ║"
echo "║  자동 재시작: 크래시 발생 시 5초 후 자동 복구            ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  로그 확인:"
echo "    tail -f /tmp/galaxymap-ingest.log"
echo "    tail -f /tmp/galaxymap-ingest-error.log"
echo ""
echo "  서비스 수동 제어:"
echo "    중지: launchctl unload ~/Library/LaunchAgents/${LAUNCHAGENT_LABEL}.plist"
echo "    시작: launchctl load   ~/Library/LaunchAgents/${LAUNCHAGENT_LABEL}.plist"
echo ""
