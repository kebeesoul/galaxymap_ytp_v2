# galaxymap_ytp_v2

## Project
Music Shortform Generator — galaxymap internal tool  
Single-user creator workflow. No multi-user. No auto-publishing.

## Phase
Current: 완료  
Completed: Phase 1, Phase 2, Phase 3, Phase 4  
Current operations: OPERATIONS.md 참고
Spec: PROJECT_SPEC.md is historical context when it conflicts with code or OPERATIONS.md.

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
- Docker 권장: `docker compose up ingest-worker` 로 Python ingest worker 실행
- BGM upload HTTP worker는 별도 서비스: `docker compose up ingest-server`
- 서비스명은 항상 `docker-compose.yml`에서 확인 후 제안한다. `ingest` 서비스는 없다.
- Next.js: localhost:3000 / Python worker: localhost:8001

## Render Strategy
- Next.js: Railway 배포 (railway.json 기준)
- ingest worker / render worker: local Mac Studio only (Docker or bare process)
- Vercel / Edge function / Railway에 render/ingest worker 배포 금지
- Remotion Lambda stub 유지 — daily volume > 100 clips 시점에만 재검토 (Phase 4)

## Video File Strategy
- Current implementation downloads a single <=1080p mp4 to `sources/preview/{video_id}.mp4`.
- The same stored source is currently used by the editor preview and local Remotion render worker.
- Treat PROJECT_SPEC.md as historical context when it conflicts with code or worker READMEs.

## Current Feature Boundary
- Curator recommendation flow exists and uses Anthropic + YouTube search.
- Comment fetch, subtitle editing, BGM upload, templates, and local Remotion render exist.
- Do not add social publishing, multi-user collaboration, or auto-publishing unless explicitly requested.
- Do not move ingest/render workers to Railway, Vercel, or Edge functions.

## Do NOT build
- social publishing
- multi-user collaboration
- AI headline generation

## Constraints
- TypeScript strict mode, no `any` types
- Tailwind only, no CSS modules
- Supabase RLS: disable (single user, local dev)

## Operational Workflow
- `/api/import` only queues import work by setting `projects.import_status='pending'`.
- The Mac Studio ingest worker polls Supabase every 3s, claims pending projects, downloads via `yt-dlp`, uploads to Storage, then updates project import status.
- `/api/render` queues render work by setting `clips.render_status='pending'`.
- The local render worker polls Supabase every 3s, renders Remotion compositions, uploads MP4s to the `renders` bucket, then updates clip render status.
- BGM upload is different: `/api/upload-bgm` calls the HTTP worker at `INGEST_WORKER_URL` / `PYTHON_WORKER_URL`; localhost fallback is local dev only. Check this before debugging Railway upload failures.
- Required Storage buckets: `sources` and `renders`. Migration `20260504000000_render_storage_and_cancelled_status.sql` creates `renders` for new environments.

## Known Recurring Issues
- Delete project / delete render bugs have recurred across many PRs. Before coding another delete fix, read the related git/PR history, identify why previous fixes failed, and add or update a regression test.
- Render queue duplicate handling is risky. A regression test expects `/api/render` to return 409 for already-processing clips; check current code before changing render behavior.
- Import tests may use Supabase chain mocks that lag behind the current `/api/import` implementation. Fix the mock only after confirming route behavior.
- YouTube ingest is fragile by nature: age restriction, private/deleted videos, region lock, extractor changes, bot detection, and stale `yt-dlp` can all break imports.

## PR / Shipping Workflow
- Preferred loop: branch -> implement -> `npm run type-check` -> targeted tests -> `npm run build` when relevant -> PR -> merge.
- For chronic bugs, use forensics-first workflow: inspect previous PRs/commits, reproduce, write a regression test, then patch.
- Avoid mixing unrelated fixes in one PR unless the user explicitly asks for high-velocity batching.

## MCP / Local Config Notes
- Claude Desktop MCP server config belongs in `claude_desktop_config.json`, not generic `settings.json`.
- After MCP config changes, Claude Desktop restart is required.

## Output Formatting
- For audits, PR reviews, and long operational summaries, keep the first answer compact and complete.
- If the user asks for a single boxed report, return one code block and avoid splitting the report across messages.

## Design Rule

Follow DESIGN.md for UI/UX guidelines when applicable
Before changing any UI, read DESIGN.md and follow it as the design source of truth.
