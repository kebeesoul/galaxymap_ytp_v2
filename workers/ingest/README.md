# Ingest Worker — 영구 설치 가이드

로컬 Mac Studio에서 돌아가는 yt-dlp 인제스트 워커.
Railway(Next.js)가 이 워커를 호출해 YouTube 영상을 다운로드하고 Supabase Storage에 업로드한다.

---

## 구성 요소

| 파일 | 역할 |
|---|---|
| `server.py` | FastAPI 워커 — POST `/ingest` |
| `run-worker.sh` | uvicorn 실행 래퍼 (pyenv + .env.local 자동 로드) |
| `setup-tunnel.sh` | **1회 설치 스크립트** — Named Tunnel + launchd 등록 |
| `start.sh` | 수동 실행용 (테스트 전용) |
| `tunnel.sh` | Quick tunnel 단독 실행 (테스트 전용) |
| `Dockerfile` | Docker 빌드 |

---

## 권장: 영구 설치 (한 번만 실행)

Named Cloudflare Tunnel + macOS launchd 조합. 설치 후에는:
- Mac 로그인 시 uvicorn + cloudflared **자동 시작**
- 크래시 발생 시 **자동 재시작**
- Railway `PYTHON_WORKER_URL` **한 번만 입력, 영구 고정**

### 사전 준비

```bash
# 1. Homebrew로 cloudflared 설치
brew install cloudflared

# 2. Python 의존성 설치 (pyenv 3.11 환경에서)
cd workers/ingest
pip install -r requirements.txt
```

### 설치 실행

```bash
cd workers/ingest
chmod +x setup-tunnel.sh
./setup-tunnel.sh
```

스크립트가 순서대로 처리:
1. cloudflared 설치 확인
2. Cloudflare 계정 로그인 (브라우저 열림 → 허용 클릭)
3. Named tunnel `galaxymap-ingest` 생성 → **영구 URL 발급**
4. cloudflared 시스템 서비스 등록 (sudo, 부팅 시 자동 시작)
5. uvicorn LaunchAgent 등록 (로그인 시 자동 시작)

완료 후 출력:
```
╔══════════════════════════════════════════════════════════╗
║  ✅  설치 완료                                          ║
╠══════════════════════════════════════════════════════════╣
║  Railway PYTHON_WORKER_URL (한 번만 입력):              ║
║  https://xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.cfargotunnel.com
╚══════════════════════════════════════════════════════════╝
```

### Railway에 URL 입력 (1회)

1. Railway 대시보드 → 프로젝트 → **Variables** 탭
2. `PYTHON_WORKER_URL` = 위에서 출력된 `https://xxxx.cfargotunnel.com`
3. Save → Railway 자동 재배포

> **이후로 URL은 바뀌지 않는다.** Mac 재시작, cloudflared 업데이트, 크래시 등 무관.

---

## 설치 후 일상 운영

**아무것도 할 필요 없다.** Mac을 켜고 로그인하면 자동으로 시작된다.

### 로그 확인
```bash
tail -f /tmp/galaxymap-ingest.log        # uvicorn 접근 로그
tail -f /tmp/galaxymap-ingest-error.log  # uvicorn 에러 로그
tail -f /tmp/cloudflared.log             # 터널 연결 상태
```

### 수동 제어
```bash
# uvicorn 재시작
launchctl unload ~/Library/LaunchAgents/com.galaxymap.ingest.plist
launchctl load   ~/Library/LaunchAgents/com.galaxymap.ingest.plist

# cloudflared 재시작
sudo launchctl stop  com.cloudflare.cloudflared
sudo launchctl start com.cloudflare.cloudflared
```

### 동작 확인
```bash
curl https://xxxx.cfargotunnel.com/docs   # Swagger UI 응답 확인
# 또는 로컬에서 직접
curl http://localhost:8001/docs
```

---

## 제거 (Uninstall)

```bash
# uvicorn LaunchAgent 제거
launchctl unload ~/Library/LaunchAgents/com.galaxymap.ingest.plist
rm ~/Library/LaunchAgents/com.galaxymap.ingest.plist

# cloudflared 서비스 제거
sudo cloudflared service uninstall

# Named tunnel 삭제 (선택)
cloudflared tunnel delete galaxymap-ingest
```

---

## 수동 실행 (테스트용)

launchd 설치 없이 빠르게 테스트하려면:

```bash
# 워커 + 터널 동시 실행 (Quick tunnel — URL이 매번 바뀜)
./start.sh

# 터널만 실행 (워커가 이미 돌고 있을 때)
./tunnel.sh
```

> Quick tunnel은 재시작마다 URL이 바뀌므로 Railway Variables를 매번 업데이트해야 한다.

---

## Docker 환경

```bash
# 프로젝트 루트에서
docker compose up ingest
```

Docker 컨테이너가 8001 포트를 로컬에 바인딩한다. Railway → 컨테이너 접근에는 여전히 Cloudflare Tunnel (또는 다른 터널) 필요.

---

## 엔드포인트

`POST /ingest`

```json
// Request
{ "url": "https://www.youtube.com/watch?v=..." }

// Response
{
  "video_id": "ZtLB7VTm1IM",
  "title": "뻔하잖아",
  "duration_sec": 213,
  "thumbnail_url": "https://...",
  "preview_path": "preview/ZtLB7VTm1IM.mp4"
}
```

Swagger UI: `http://localhost:8001/docs` 또는 `https://xxxx.cfargotunnel.com/docs`
