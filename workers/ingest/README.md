# Ingest Worker — Local + Cloudflare Tunnel

로컬 Mac Studio에서 돌아가는 yt-dlp 인제스트 워커. Railway에 배포된 Next.js 앱이 이 워커를 호출해서 YouTube 영상을 가져온다. Railway는 외부망이므로 로컬 `localhost:8001`에 직접 접근할 수 없어 **Cloudflare Tunnel**로 공용 HTTPS URL을 노출한다.

---

## 구성 요소

| 파일 | 역할 |
|---|---|
| `server.py` | FastAPI 워커 (POST `/ingest`) |
| `Dockerfile` | 컨테이너 빌드 |
| `requirements.txt` | Python 의존성 |
| `tunnel.sh` | Cloudflare Tunnel 단독 실행 |
| `start.sh` | 워커 + 터널 동시 실행 (권장) |

---

## 1. 사전 준비

### Python/uv 환경 (네이티브 실행 시)
```bash
cd workers/ingest
pip install -r requirements.txt
```
또는 Docker 환경 사용:
```bash
docker compose up ingest
```

### Cloudflare Tunnel 설치 (Mac)
```bash
brew install cloudflared
```
Linux: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

> ⚠️ 계정 로그인 불필요 — `--url` 모드(quick tunnel)는 익명 `*.trycloudflare.com` 주소를 발급한다.

---

## 2. 실행 방법

### 권장: 워커 + 터널 동시 실행
```bash
cd workers/ingest
chmod +x start.sh
./start.sh
```

실행 후 터미널에 이런 로그가 출력됨:
```
2026-04-25T02:00:00Z INF +--------------------------------------------------------------+
2026-04-25T02:00:00Z INF |  Your quick Tunnel has been created! Visit it at (it may    |
2026-04-25T02:00:00Z INF |  take some time to be reachable):                           |
2026-04-25T02:00:00Z INF |  https://bright-amber-foo-bar.trycloudflare.com             |
2026-04-25T02:00:00Z INF +--------------------------------------------------------------+
```

이 `https://bright-amber-foo-bar.trycloudflare.com` 주소가 `PYTHON_WORKER_URL` 값이다.

### 분리 실행 (워커를 이미 다른 곳에서 돌리는 경우)
```bash
# 터미널 1: 워커
uvicorn server:app --host 0.0.0.0 --port 8001

# 터미널 2: 터널만
./tunnel.sh
```

---

## 3. Railway에 URL 입력

1. Railway 대시보드 → 프로젝트 선택 → **Variables** 탭
2. `PYTHON_WORKER_URL` 편집 (없으면 신규 추가)
3. 값: `https://bright-amber-foo-bar.trycloudflare.com` (끝에 슬래시 금지)
4. Save → Railway가 자동 재배포

확인:
```bash
curl https://bright-amber-foo-bar.trycloudflare.com/docs
# FastAPI Swagger UI가 표시되면 성공
```

---

## 4. ⚠️ 주의사항

### 터널 URL은 재시작마다 바뀐다
`cloudflared tunnel --url` (quick tunnel) 모드는 **프로세스 재시작 시 새 URL 발급**. 로컬 Mac을 끄거나 `start.sh`를 다시 실행하면:
1. 새 URL 확인
2. Railway Variables에서 `PYTHON_WORKER_URL` 업데이트
3. Railway 재배포 대기

**영구 URL이 필요하면** Cloudflare 계정 로그인 + named tunnel 설정:
```bash
cloudflared tunnel login
cloudflared tunnel create galaxymap-ingest
cloudflared tunnel route dns galaxymap-ingest ingest.example.com
cloudflared tunnel run galaxymap-ingest
```

### 워커가 내려가면 Import는 영구 `pending` 상태
Next.js `/api/import`는 202 즉시 반환 후 백그라운드로 워커를 호출하기 때문에, 워커 다운 시 axios 120s 타임아웃을 기다렸다가 `failed`로 전환된다. 업무 중에는 `start.sh`를 terminal 세션에서 계속 띄워두거나 `tmux` / `screen`에서 돌리는 것을 권장.

### 로그 확인
```bash
# uvicorn 접근 로그 + cloudflared 연결 상태가 한 터미널에 섞여서 출력됨
# 따로 보고 싶으면 분리 실행 모드 사용
```

### 방화벽
로컬 서버이므로 8001번 포트가 외부에 노출되지 않는다 — 터널만 public 접점. 방화벽 설정 불필요.

---

## 5. 엔드포인트

`POST /ingest` — Body: `{ "url": "https://www.youtube.com/watch?v=..." }`
Response: `{ video_id, title, duration_sec, thumbnail_url, preview_path }`

Swagger UI: `https://<tunnel-url>/docs`
