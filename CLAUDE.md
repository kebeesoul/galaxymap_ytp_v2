# galaxymap_ytp_v2

## Project
Music Shortform Generator — galaxymap internal tool  
Single-user creator workflow. No multi-user. No auto-publishing.

## Phase
Current: Phase 2  
Completed: Phase 1  
Spec: PROJECT_SPEC.md 참고

## Stack
- Next.js 14 (App Router) + TypeScript + Tailwind
- Supabase (DB + Storage)
- Remotion (video composition)
- Python workers: yt-dlp, ffmpeg, whisperX

## Environment
- Node: 20.x LTS (nvm use 20)
- Python: 3.11 (pyenv local 3.11)
- Next.js: 14.2.x 고정 / Tailwind: v3.4 (v4 금지)
- ffmpeg: Homebrew — arm64/x64 분기 주의 (Intel Mac ↔ M1 Mac Studio)
- Docker 권장: `docker compose up ingest` 로 Python 워커 통일 실행
- Next.js: localhost:3000 / Python worker: localhost:8001

## Render Strategy
- DEV/PROD 모두 local Mac Studio worker
- Vercel / Edge function에 render worker 배포 금지
- Remotion Lambda stub 유지 — daily volume > 100 clips 시점에만 재검토 (Phase 4)

## Video File Strategy
- Phase 1~3: 저화질 프리뷰 mp4만 사용 (편집 UI 전용, 렌더 소스 아님)
- Phase 4: 렌더 트리거 시점에 고화질 소스 별도 다운로드
- 두 파일은 절대 혼용하지 않음 — PROJECT_SPEC.md 참고

## Do NOT build
- recommendation engine
- social publishing
- multi-user collaboration
- AI headline generation
- Whisper integration (Phase 2)
- Remotion render (Phase 4)
- 고화질 렌더 소스 다운로드 (Phase 4)

## Constraints
- TypeScript strict mode, no `any` types
- Tailwind only, no CSS modules
- Supabase RLS: disable (single user, local dev)

## Design Rule

Follow DESIGN.md for UI/UX guidelines when applicable
Before changing any UI, read DESIGN.md and follow it as the design source of truth.