# AGENTS.md — galaxymap_ytp_v2 AI 협업 규칙

> 이 파일은 Codex(및 모든 AI 코딩 에이전트)가 이 레포에서 작업할 때 **반드시 따르는 운영 기준**이다.
> 설계·토폴로지·데이터모델의 단일 진실 공급원은 **`PROJECT_SPEC.md`** 다. 작업 전 항상 먼저 읽는다.
> 운영 절차(Docker·yt-dlp·배포 등) 상세는 **`OPERATIONS.md`**, UI/UX는 **`DESIGN.md`** 를 따른다.
> `PROJECT_SPEC.md`는 현재 트래킹된 유일한 정본이다.

---

## ⛔ 절대 규칙 #1 — 패키지 매니저는 pnpm 전용

**npm·yarn 사용 전면 금지. 이 레포의 모든 설치/실행/스크립트는 `pnpm` 으로만 한다.**

- 명령을 제안하거나 실행할 때 **항상 `pnpm`** 으로 출력한다. `npm`/`yarn` 명령을 쓰면 규칙 위반이다.
- lockfile은 **`pnpm-lock.yaml` 만** 커밋한다. `package-lock.json`·`yarn.lock` 은 생성·커밋 금지(있으면 삭제).
- **버전: pnpm 10.x + Node 20.** (pnpm 11은 Node 22를 강제 → 현 워커와 충돌하므로 보류.) `corepack use pnpm@10` 으로 `package.json`의 `"packageManager"` 필드를 정확한 버전+해시로 고정한다.
- **Remotion/esbuild:** pnpm 기본값이 의존성 빌드 스크립트(postinstall)를 차단하므로, 렌더가 깨지면 `onlyBuiltDependencies`로 esbuild 등을 허용한다.

### 명령 대응표 (이대로만 쓴다)
| 하려는 것 | ✅ 쓴다 | ❌ 쓰지 않는다 |
|---|---|---|
| 의존성 설치 | `pnpm install` | `npm install`, `yarn` |
| 패키지 추가 | `pnpm add <pkg>` / `pnpm add -D <pkg>` | `npm install <pkg>` |
| 개발 서버 | `pnpm dev` | `npm run dev` |
| 빌드 | `pnpm build` | `npm run build` |
| 시작 | `pnpm start` | `npm start` |
| 린트 | `pnpm lint` | `npm run lint` |
| 타입체크 | `pnpm type-check` | `npm run type-check` |
| 테스트 | `pnpm test` / `pnpm test:watch` | `npm test` |
| 렌더 워커 | `pnpm render-worker` | `npm run render-worker` |
| workspace 폴더 준비 | `pnpm workspace:prepare` | 임의 수동 `mkdir` |
| 스토리지 정리 | `pnpm cleanup:storage` (`--apply`로 실제 삭제) | `node scripts/...` 직접 호출 |

- **Railway 빌드도 pnpm** 으로 동작해야 한다(railway.json / nixpacks / packageManager 필드 확인).

---

## ⛔ 절대 규칙 #2 — 토폴로지를 어기지 않는다

`PROJECT_SPEC.md` §2·§3 의 토폴로지가 이 레포의 상수다.

- **무거운 미디어 처리(yt-dlp / Remotion 렌더 / ffmpeg / 대용량 변환)는 Mac Studio 로컬 워커에서만 돈다.** Railway(Next.js)에서 이걸 처리하려는 코드는 버그다.
- **ingest/render 워커를 Railway·Vercel·Edge function 에 배포 금지.** 워커는 Mac Studio 로컬(Docker 또는 bare process)에만 존재한다.
- **배포 타겟은 Railway.** Vercel 아님.
- **임시 source storage: R2 비활성, 로컬 workspace only.** YouTube source 바이트는 `workspace/ingest/{uid}/sources/preview/{video_id}.mp4`에 보존하고 Next.js `/api/source-file`이 서버에서 스트리밍한다. DB에는 절대경로가 아니라 `{uid}/sources/preview/{video_id}.mp4` 상대 key만 저장한다.
- **source key는 반드시 `{uid}/` prefix로 시작**(Supabase Auth UID 격리). `/api/source-url`·`/api/source-file`에서 요청자 UID와 key prefix 소유권을 검증한다.
- **절대경로 하드코딩 금지.** 로컬 경로는 `STORAGE_ROOT` 등 env로 주입(기본값 `<repo>/workspace/`). `/Users/...` 절대경로·사용자명을 코드/문서/공개 레포에 박지 않는다. 실제 경로는 `.env`(gitignore)에만. (이 레포는 **public** 이다.)
- **서버 포트는 무조건 3200.** 로컬 Next.js는 `localhost:3200`이며 `pnpm dev`가 이미 `next dev -H 127.0.0.1 -p 3200`으로 고정한다. 3000 포트로 안내하거나 실행하지 않는다.

---

## ⛔ 절대 규칙 #3 — spec drift 금지

- 작업 시작 전 `PROJECT_SPEC.md`를 **먼저 읽는다.**
- 코드를 고쳐서 토폴로지·데이터모델·job·conventions 중 하나라도 바뀌면 **같은 작업에서 `PROJECT_SPEC.md`를 갱신**한다. 코드만 고치고 spec을 안 고치면 작업은 미완이다.
- 의미 있는 결정은 spec §11 Decisions, 미해결은 §12 Known Issues에 한 줄이라도 남긴다.
- 추측으로 진단하지 않는다. 실제 코드·로그·에러를 읽고 판단하고, 검증 불가하면 "확인할 수 없다"고 말한다.

---

## 작업 컨텍스트 (요약 — 상세는 PROJECT_SPEC.md)

- **무엇:** YouTube 영상 → 자막·댓글·BGM 입힌 큐레이션/요약 클립 제작 웹 에디터 + 로컬 렌더 파이프라인.
- **흐름:** Curator → Import(yt-dlp/Mac, workspace source) → Editor → Render(Remotion/Mac) → History/Export.
- **실행:** Next.js 14 = Railway / ingest·render 워커 = Mac Studio 로컬(Docker + Node).
- **저장:** Supabase = DB·Auth·RLS·상태폴링 / Mac 로컬(`STORAGE_ROOT`, 기본 `<repo>/workspace`) = source 원본(`ingest/`), `renders/tmp/`, `exports/`, `cache/`. R2 source 경로는 credential 해결 전까지 코드에서 비활성.
- **Curator:** Gemini 2.5 Flash Lite + YouTube 검색. (Google Gemini SDK 도입 필요.)
- **사용자 모델:** **다중 작업자 + 각자 웹 접속.** Supabase Auth 로그인 → UID별 source key/workspace 폴더 격리 → 셀프 삭제(자기 폴더만).
  - ✅ multi-user(각자 계정·UID 격리)는 **한다.**
  - ❌ multi-user **collaboration**(여러 명이 같은 프로젝트를 동시 편집)은 **하지 않는다.** 작업자별 프로젝트 분리 운영.

---

## Environment

- **Node:** 20.x LTS (`nvm use 20`). **Python:** 3.11 (`pyenv local 3.11`).
- **Next.js 14.2.x 고정.** **Tailwind v3.4** — **v4 금지.**
- **ffmpeg:** Homebrew. **arm64/x64 분기 주의**(Intel Mac ↔ M1 Mac Studio). 아키텍처 불일치가 ingest/render 실패의 흔한 원인.
- **포트:** Next.js `localhost:3200` / Python worker `localhost:8001`.

---

## Docker / 서비스 규칙

- **서비스명은 항상 `docker-compose.yml`에서 확인한 뒤 제안한다.** 추측 금지.
- Python ingest 워커: `docker compose up ingest-worker`.
- BGM 업로드 HTTP 워커는 **별도 서비스**: `docker compose up ingest-server`.
- **`ingest` 라는 서비스는 없다.** (혼동 주의.)
- **BGM 업로드는 다른 경로:** `/api/upload-bgm` → `INGEST_WORKER_URL` / `PYTHON_WORKER_URL` 의 HTTP 워커 호출. localhost fallback은 **로컬 dev 전용**. Railway 업로드 실패를 디버깅하기 전에 이 경로부터 확인한다.

---

## 코드 컨벤션

- **TypeScript strict 모드. `any` 금지.**
- **Tailwind only. CSS modules 금지.**
- zod로 LLM 출력·외부 API·env 검증(모든 외부 경계).
- 상태 전이는 **조건부 업데이트**(`WHERE status != 'processing'`)로 중복 처리를 막는다.
- **Supabase RLS 활성화**(다중 작업자). UID 단위 접근 제어.
- 마이그레이션은 순차 타임스탬프 규칙(`supabase/migrations/`). 죽은 컬럼은 마이그레이션으로 정리.

---

## Known Recurring Issues (작업 전 반드시 인지)

- **delete project / delete render 버그는 여러 PR에 걸쳐 반복 재발했다.** 또 다른 delete 수정을 코딩하기 전에, 관련 git/PR 히스토리를 먼저 읽고 **이전 수정이 왜 실패했는지** 파악한 뒤 회귀 테스트를 추가/갱신한다. (다중 작업자 + R2/DB 동시 삭제로 이 영역은 더 민감해졌다.)
- **렌더 큐 중복 처리는 위험하다.** 현재 `/api/render`는 이미 processing인 클립에 409를 기대하는 회귀 테스트가 있다. 렌더 동작을 바꾸기 전 현재 코드를 확인하고, 조건부 상태 업데이트로 **강화**하되 기존 테스트와 정합을 맞춘다.
- **Import 테스트의 Supabase chain mock이 실제 `/api/import` 구현보다 뒤처질 수 있다.** route 동작을 먼저 확인한 뒤에만 mock을 고친다.
- **YouTube ingest는 본질적으로 취약하다:** 연령 제한, 비공개/삭제 영상, 지역 락, extractor 변경, 봇 감지, 오래된 `yt-dlp` 가 모두 import를 깨뜨릴 수 있다.

---

## PR / Shipping Workflow

- 기본 루프: branch → 구현 → `pnpm type-check` → 표적 테스트 → 필요 시 `pnpm build` → PR → merge.
- **만성 버그는 forensics-first:** 이전 PR/커밋 조사 → 재현 → 회귀 테스트 작성 → 패치.
- 한 PR에 무관한 수정을 섞지 않는다(사용자가 명시적으로 배치를 요청한 경우 제외).
- **Draft PR을 방치하지 않는다.** 머지 또는 닫기로 끝낸다. spec과 PR 내용을 항상 대조.

---

## Do NOT build (명시 요청 없는 한)

- 소셜 퍼블리싱 / 자동 업로드
- multi-user **collaboration**(공동 동시 편집) — *주의: 각자 계정·UID 격리(multi-user)는 함*
- AI 헤드라인 자동 생성

---

## 기타 규칙

- **UI 변경 전 `DESIGN.md`를 읽고 그것을 디자인 단일 진실로 따른다.**
- MCP: Codex Desktop MCP 서버 설정은 `claude_desktop_config.json`에 둔다(`settings.json` 아님). 설정 변경 후 Codex Desktop 재시작 필요.
- **출력 형식:** 감사·PR 리뷰·긴 운영 요약은 첫 답을 compact하고 complete하게. 단일 boxed 리포트를 요청하면 하나의 코드블록으로 반환하고 메시지를 쪼개지 않는다.

---

*이 문서는 운영 규칙이다. 변경 시 변경 이유를 PROJECT_SPEC.md §11에 남긴다.*
