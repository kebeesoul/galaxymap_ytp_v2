#!/bin/bash
# One-time setup: Named Cloudflare Tunnel (permanent URL) + launchd auto-start.
# After this runs, uvicorn + cloudflared start automatically on every Mac login.
# Railway PYTHON_WORKER_URL is set ONCE and never changes.
set -euo pipefail

TUNNEL_NAME="galaxymap-ingest"
LAUNCHAGENT_LABEL="com.galaxymap.ingest"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LAUNCHAGENT_PLIST="${HOME}/Library/LaunchAgents/${LAUNCHAGENT_LABEL}.plist"

echo ""
echo "=== galaxymap ingest worker — 영구 설치 ==="
echo ""

# ── Step 1: cloudflared ─────────────────────────────────────────────────────
if ! command -v cloudflared &>/dev/null; then
  echo "[1/5] cloudflared 설치 (brew)..."
  brew install cloudflared
else
  echo "[1/5] cloudflared $(cloudflared --version | head -1) — 이미 설치됨"
fi

# ── Step 2: Cloudflare 계정 로그인 ──────────────────────────────────────────
echo ""
echo "[2/5] Cloudflare 계정 로그인..."
echo "      브라우저가 열리면 허용 버튼을 클릭하세요."
cloudflared tunnel login

# ── Step 3: Named tunnel 생성 (이미 있으면 재사용) ──────────────────────────
echo ""
echo "[3/5] Named tunnel '${TUNNEL_NAME}' 설정..."
if ! cloudflared tunnel list 2>/dev/null | grep -q "${TUNNEL_NAME}"; then
  cloudflared tunnel create "${TUNNEL_NAME}"
  echo "      터널 생성 완료"
else
  echo "      기존 터널 재사용"
fi

# 터널 ID 추출
TUNNEL_ID=$(cloudflared tunnel list --output json 2>/dev/null \
  | python3 -c "
import sys, json
tunnels = json.load(sys.stdin)
match = [t for t in tunnels if t.get('name') == '${TUNNEL_NAME}']
print(match[0]['id'] if match else '')
" 2>/dev/null)

if [[ -z "${TUNNEL_ID}" ]]; then
  echo "ERROR: 터널 ID를 찾을 수 없습니다."
  echo "       'cloudflared tunnel list' 로 확인 후 다시 실행하세요."
  exit 1
fi

TUNNEL_URL="https://${TUNNEL_ID}.cfargotunnel.com"
CREDS_FILE="${HOME}/.cloudflared/${TUNNEL_ID}.json"

# cloudflared config 작성 (~/.cloudflared/config.yml)
cat > "${HOME}/.cloudflared/config.yml" << EOF
tunnel: ${TUNNEL_ID}
credentials-file: ${CREDS_FILE}
logfile: /tmp/cloudflared.log
loglevel: warn
ingress:
  - service: http://localhost:8001
EOF
echo "      ~/.cloudflared/config.yml 작성 완료"

# ── Step 4: cloudflared 시스템 서비스 등록 (sudo) ───────────────────────────
echo ""
echo "[4/5] cloudflared 시스템 서비스 등록 (sudo 필요)..."
sudo cloudflared service install
# 이미 설치된 경우를 위해 stop/start
sudo launchctl stop com.cloudflare.cloudflared 2>/dev/null || true
sudo launchctl start com.cloudflare.cloudflared 2>/dev/null || true
echo "      cloudflared 서비스 등록 완료 (로그인 없이도 자동 시작)"

# ── Step 5: uvicorn LaunchAgent 등록 ────────────────────────────────────────
echo ""
echo "[5/5] uvicorn LaunchAgent 등록..."
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

# 기존 에이전트 언로드 후 재등록
launchctl unload "${LAUNCHAGENT_PLIST}" 2>/dev/null || true
launchctl load "${LAUNCHAGENT_PLIST}"
echo "      uvicorn LaunchAgent 등록 완료 (로그인 시 자동 시작)"

# ── 완료 ────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  ✅  설치 완료                                          ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║                                                          ║"
echo "║  Railway PYTHON_WORKER_URL (한 번만 입력):              ║"
echo "║  ${TUNNEL_URL}"
echo "║                                                          ║"
echo "║  이 URL은 영구적입니다 — 재시작해도 바뀌지 않습니다.   ║"
echo "║                                                          ║"
echo "║  자동 시작: Mac 로그인 시 uvicorn + cloudflared 자동     ║"
echo "║  자동 재시작: 크래시 발생 시 5초 후 자동 복구           ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  로그 확인:"
echo "    uvicorn:     tail -f /tmp/galaxymap-ingest.log"
echo "    cloudflared: tail -f /tmp/cloudflared.log"
echo ""
echo "  서비스 수동 제어:"
echo "    중지: launchctl unload ~/Library/LaunchAgents/${LAUNCHAGENT_LABEL}.plist"
echo "    시작: launchctl load   ~/Library/LaunchAgents/${LAUNCHAGENT_LABEL}.plist"
echo ""
