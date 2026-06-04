# Ingest Worker — Pull 방식 운영 가이드

Mac Studio에서 돌아가는 yt-dlp 인제스트 워커.
Supabase를 1초마다 폴링해 `import_status='pending'` 프로젝트를 가져와 처리한다.
Railway → Mac 직접 연결 불필요. cloudflared 불필요.

---

## 동작 방식 (Pull)

```
사용자 클릭 → Railway POST /api/import
             → projects.import_status = 'pending' 기록
             → 202 즉시 반환

Mac worker → Supabase 폴링 (1초마다)
           → pending 작업 발견 → processing 클레임
           → yt-dlp 다운로드 → Supabase Storage 업로드
           → import_status = 'success' 업데이트

브라우저 → Realtime update → success 감지 → 편집 UI 전환
```

Mac이 인터넷에서 도달 가능할 필요 없음. Supabase outbound 연결만 사용.

---

## 구성 요소

| 파일 | 역할 |
|---|---|
| `worker.py` | Supabase 폴링 루프 — yt-dlp + Storage 업로드 |
| `run-worker.sh` | pyenv + .env.local 로드 후 worker.py 실행 |
| `setup.sh` | **1회 설치 스크립트** — launchd LaunchAgent 등록 |
| `start.sh` | 수동 실행용 (테스트 전용) |
| `Dockerfile` | Docker 빌드 |

---

## 사전 준비

```bash
# .env.local에 Supabase 자격증명 확인 (프로젝트 루트)
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# Python 의존성 설치 (pyenv 3.11 환경에서)
cd workers/ingest
pip install -r requirements.txt
```

---

## 권장: 영구 설치 (한 번만 실행)

macOS launchd LaunchAgent로 등록. 이후:
- Mac 로그인 시 worker.py **자동 시작**
- 크래시 발생 시 **자동 재시작**
- Railway 환경 변수 설정 없음 (`PYTHON_WORKER_URL` 불필요)

```bash
cd workers/ingest
chmod +x setup.sh
./setup.sh
```

---

## 설치 후 일상 운영

**아무것도 할 필요 없다.** Mac을 켜고 로그인하면 자동으로 시작된다.

### 로그 확인
```bash
tail -f /tmp/galaxymap-ingest.log        # 워커 로그
tail -f /tmp/galaxymap-ingest-error.log  # 에러 로그
```

### 수동 제어
```bash
# 재시작
launchctl unload ~/Library/LaunchAgents/com.galaxymap.ingest.plist
launchctl load   ~/Library/LaunchAgents/com.galaxymap.ingest.plist
```

---

## 제거 (Uninstall)

```bash
launchctl unload ~/Library/LaunchAgents/com.galaxymap.ingest.plist
rm ~/Library/LaunchAgents/com.galaxymap.ingest.plist
```

---

## 수동 실행 (테스트용)

```bash
cd workers/ingest
./start.sh
# 또는
python worker.py
```

정상 시작 시 출력:
```
galaxymap ingest worker — polling every 3s
```

작업 수신 시:
```
[JOB] <project-uuid>
[OK]  <project-uuid>  뻔하잖아
```

---

## Docker 환경

```bash
# 프로젝트 루트에서
docker compose up ingest
```

---

## Railway 환경 변수

`PYTHON_WORKER_URL` **불필요** — 이 변수는 삭제해도 됩니다.

필수 변수는 기존과 동일:
| 변수 | 용도 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase endpoint |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
