# galaxymap_ytp_v2

## Project
Music Shortform Generator — galaxymap internal tool  
Single-user creator workflow. No multi-user. No auto-publishing.

## Phase
Current: 완료 (Phase 1–4 all shipped)  
**주의:** PROJECT_SPEC.md는 과거 설계 문서로 일부 내용이 현재 구현과 다를 수 있음.  
실제 동작 기준은 코드, `workers/ingest/README.md`, `workers/render/README.md` 우선.

## Stack
- Next.js 14 (App Router) + TypeScript + Tailwind
- Supabase (DB + Storage)
- Remotion (video composition, local render worker)
- Python workers: yt-dlp, ffmpeg (whisperX 제거됨 — 수동 타임코드 전용)
- Anthropic Claude API (큐레이터 추천/문구 생성)
- YouTube Data API (영상 검색/보강)

## What's Already Built (건드리지 말 것)
아래는 이미 구현 완료. "Do NOT build" 목록이 과거 문서에 있어도 아래는 실제 존재함:
- Curator (곡 추천 + 메모 생성)
- YouTube 댓글 불러오기 / 선택
- 가사 자막 타임코드 편집 (tap-to-sync)
- BGM 업로드 + 볼륨/시작위치 설정
- 스타일 템플릿 (LayoutA/B/C)
- Remotion 로컬 렌더 (render worker)
- History / Export 페이지

## Core Architecture — Queue 구조 이해 필수

**영상 인제스트 (Import Video):**
1. `/api/import` → `projects.import_status = 'pending'` 만 씀 (직접 처리 안 함)
2. Mac Studio의 `ingest-worker` (Docker) 가 Supabase를 3s 폴링 → yt-dlp 다운로드

**렌더:**
1. `/api/render` → `clips.render_status = 'pending'` 만 씀 (직접 처리 안 함)
2. Mac Studio의 `npm run render-worker` 가 Supabase를 3s 폴링 → Remotion 렌더

**BGM 업로드 (예외 — 유일하게 HTTP 직접 호출):**
- `/api/upload-bgm` → `INGEST_WORKER_URL` (없으면 `http://localhost:8001`) 로 프록시
- Railway 배포 환경에서는 Mac의 8001 포트가 외부 접근 가능해야 작동
- 로컬 전용 사용 시 문제 없음

## Environment
- Node: 20.x LTS (`nvm use 20`)
- Python: 3.11 (`pyenv local 3.11`)
- Next.js: 14.2.x 고정 / Tailwind: v3.4 (v4 금지)
- ffmpeg: Homebrew — arm64/x64 분기 주의 (Intel Mac ↔ M1 Mac Studio)
- Next.js: localhost:3000 / ingest-server: localhost:8001

## Docker — 실제 서비스명 사용
```bash
# 인제스트 전체 (BGM 서버 + Import 워커 동시 실행)
docker compose up -d

# 개별 실행
docker compose up -d ingest-server   # BGM 업로드 HTTP 서버 (port 8001)
docker compose up -d ingest-worker   # YouTube 다운로드 폴링 워커

# 이미지 재빌드 (yt-dlp 업데이트 시 필수)
docker compose build --no-cache ingest-worker

# 로그
docker compose logs -f ingest-worker
```
`docker compose up ingest` 는 서비스명이 없어서 오류 — 위 명령 사용.

## Render Worker
```bash
npm run render-worker   # tsx workers/render/worker.ts
```
최초 실행 시 Remotion 번들링 ~30초 소요. 이후 3s 폴링.

## Required Env Vars
```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
ANTHROPIC_API_KEY=
YOUTUBE_API_KEY=
# Optional
SUPABASE_SERVICE_ROLE_KEY=   # render worker 권장
INGEST_WORKER_URL=            # Railway → Mac BGM 업로드 시 필요
```

## Supabase Storage Buckets (수동 확인 필요)
- `sources` — 영상 preview mp4, BGM 파일
- `renders` — 렌더 결과 mp4

두 bucket이 Supabase 콘솔에 존재하지 않으면 업로드 실패. migration은 자동 생성 안 함.

## Known Issues / Recurring Risks

**렌더 중복 처리 가드 (`/api/render`)**
- `clips.render_status = 'processing'` 인 클립에 재렌더 요청 시 현재 202 반환 (테스트 기대는 409)
- render worker가 무거운 작업이므로 운영 전 수정 우선순위 높음
- `__tests__/api/render.test.ts` 실패 중

**테스트 mock 불일치 (`/api/import`)**
- `__tests__/api/import.test.ts` 의 mock이 현재 `.select().eq().single()` 체인 미지원
- 실제 코드 버그 아님, mock 갱신 필요

**yt-dlp YouTube 봇 감지**
- Docker 이미지가 오래됐으면 다운로드 실패 (`docker compose build --no-cache`)
- `workers/ingest/cookies.txt` 마운트 시 인증 쿠키 사용 (지역 제한 우회)
- 생성: `yt-dlp --cookies-from-browser chrome --cookies workers/ingest/cookies.txt <url>`

**Supabase HTTP/2 ConnectionTerminated**
- ingest-worker가 Supabase 연결 오류로 재시작할 수 있음 (`[POLL ERR]` 로그)
- 코드에서 3회 연속 오류 시 클라이언트 재생성으로 처리함

## Bug Fix Protocol
1. **Forensics-first**: 재현 확인 → 코드 원인 파악 → 수정 순서
2. 버그를 단순히 숨기거나 우회하지 말 것 (예: --no-verify 금지)
3. 반복 발생 버그는 Known Issues에 추가

## PR / Git Protocol
- 개발 브랜치: `claude/analyze-repo-structure-iUgga`
- 모든 변경은 PR → 머지 순서
- push 후 PR 없으면 draft PR 자동 생성
- `git push -u origin <branch>` 사용

## MCP 설정
- 파일 위치: `~/.claude/claude_desktop_config.json`
- context7: `npx @upstash/context7-mcp@latest`
- Claude Code 재시작 후 적용

## Render Strategy
- Next.js: Railway 배포 (railway.json 기준)
- ingest worker / render worker: local Mac Studio only
- Railway에 render/ingest worker 배포 금지

## Video File Strategy (현재 구현 기준)
- 단일 소스: 1080p 이하 mp4 (편집 + 렌더 모두 이 파일 사용)
- `sources/preview/{video_id}.mp4` 에 저장
- 저화질/고화질 이중 구조 없음 (Phase 4 설계에서 단순화됨)

## Constraints
- TypeScript strict mode, no `any` types
- Tailwind only, no CSS modules
- Supabase RLS: disable (single user, local dev)

## Design Rule
Follow DESIGN.md for UI/UX guidelines when applicable.  
Before changing any UI, read DESIGN.md and follow it as the design source of truth.
