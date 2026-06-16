<!--
  project_spec.md — 이 레포의 단일 진실 공급원(single source of truth).
  규칙: 코드를 고치면 이 문서도 같은 작업에서 고친다. 안 쓰는 항목은 지우지 말고 N/A.
  태그: [CONFIRM] 사용자 확인 필요 / [UNVERIFIED] 코드에서 추출했으나 미검증 / [DECIDED] 확정.
  이 문서가 기존 PROJECT_SPEC.md(과거 설계, 일부 코드와 불일치)를 대체한다. PROJECT_SPEC.md는 폐기.
-->

# galaxymap_ytp_v2 — Project Spec

> **한 줄 목적:** YouTube 영상을 받아 자막·댓글·BGM을 입힌 음악 큐레이션/요약 클립을 만드는 웹 에디터 + 로컬 렌더 파이프라인.
> **spec 버전:** v1.0 (리빌딩 기준) · **마지막 갱신:** 2026-06-08

-----

## 0. 이 문서의 위상 (먼저 읽을 것)

- 기존 `PROJECT_SPEC.md`는 **과거 설계 문서이며 코드와 불일치** → **폐기**. 이 `project_spec.md`가 유일한 진실 공급원이다.
- `ARCHITECTURE.md`는 2026-06-03 구현 스냅샷. 이 spec과 충돌 시 **이 spec이 우선**하고, ARCHITECTURE.md는 이 spec에 맞춰 갱신/흡수한다.
- 운영 절차(Docker 명령, yt-dlp 쿠키 등)는 `OPERATIONS.md`로 분리 유지. 설계·토폴로지·데이터모델은 이 문서가 관장.

-----

## 1. Identity

- **레포명:** galaxymap_ytp_v2
- **galaxymap 군 내 위치:** galaxymap > hyple 계열 (YouTube 콘텐츠 제작 파이프라인)
- **소유/배포 단위:** Next.js 웹앱(Railway) + Mac Studio 로컬 워커(2종)
- **현재 단계:** MVP 완료 → **리빌딩(재구성·다중사용자화·스토리지 이전)**

-----

## 2. Compute Topology — “무엇이 어디서 도는가”

> 이 레포의 **상수**. 모든 job/엔드포인트는 아래 중 한 곳에 명시적으로 귀속된다.

|실행 위치                           |역할                                                                              |이 레포에서 담당하는 것                                                   |
|--------------------------------|--------------------------------------------------------------------------------|----------------------------------------------------------------|
|**Railway**                     |Next.js 14 App Router 상시 서버 (port 3000)                                         |모든 페이지·API. DB 상태 변경, 인증 검증, **R2 presigned URL 발급**. 무거운 처리 안 함|
|**Mac Studio (로컬 24h)** — Docker|`ingest-worker` (worker.py, yt-dlp) + `ingest-server` (server.py, FastAPI :8001)|YouTube source는 로컬 스크래치 후 R2 게시. BGM은 Supabase Storage 후속 이전 대상|
|**Mac Studio (로컬 24h)** — Node  |`render-worker` (tsx workers/render/worker.ts, Remotion)                        |R2 source를 로컬 스크래치로 받아 렌더. 결과 업로드는 Supabase Storage 후속 이전 대상|

**원칙 [DECIDED]:** 무거운 미디어 처리(yt-dlp/Remotion/대용량 변환)는 서버리스가 아니라 **Mac Studio 로컬 워커**에서 돈다. 이를 어기는 코드는 버그로 간주.
**배포 타겟 [DECIDED]:** **Railway** (Vercel 아님). `railway.json` 기준. 과거 Vercel 배포 URL은 폐기 대상.
**로컬↔클라우드 연결 방식 [DECIDED]:**

- 워커 ↔ 앱: **Supabase Postgres 상태 폴링(3초)**. 큐 테이블 없이 status 컬럼으로 큐 역할.
- BGM 업로드: Railway `/api/upload-bgm` → Mac `ingest-server(:8001)` HTTP 프록시. Railway에서 Mac 접근 시 `INGEST_WORKER_URL` 환경변수로 Mac 엔드포인트 지정. [CONFIRM] 이 경로의 외부 노출 방식(터널/고정IP) 운영 확정 필요.

-----

## 3. Storage Topology — “무엇이 어디에 저장되는가”

> 데이터 종류별로 저장소를 못 박는다. 섞이면 drift 난다.

|저장소                    |쓰는 데이터                                      |비고                                                                                                                                                                                                                 |
|-----------------------|--------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|**Supabase (Postgres)**|관계형 메타데이터 전부, 상태머신(import/render_status), 인증|DB·Auth·폴링은 항상 여기. zod로 입출력 검증                                                                                                                                                                                     |
|**Supabase Auth**      |사용자 계정/세션, UID 발급                           |**다중 작업자용. 이번에 활성화 (현재 미사용)**. RLS도 켠다                                                                                                                                                                             |
|**Cloudflare R2**      |영상 원본 mp4. BGM·렌더 결과 mp4도 후속 전환 대상           |Lane A source 전환 완료. S3 호환, egress 무료. DB에는 상대 객체 key만 저장 [DECIDED]                                                                                                                                              |
|**Mac 로컬 파일시스템(스크래치)** |yt-dlp 다운로드 중간물, R2에서 받은 Remotion 입력, 렌더 작업 파일|처리용 임시 공간. source PUT 또는 render job 종료 후 삭제. **경로는 `STORAGE_ROOT` env로 주입**(코드 기본값 `<repo>/workspace/`). **.gitignore 필수.** 실제 절대경로는 `.env`에만 두고 코드·문서·공개 레포엔 절대 박지 않음(사용자명 노출 방지) [DECIDED]|
|**localStorage**       |UI 경량 상태 (탭 위치, 임시 폼)                       |진실원본·민감정보 저장 금지                                                                                                                                                                                                    |

**폐기 [DECIDED]:** Supabase Storage 버킷(`sources`, `renders`)은 R2로 이전 후 폐기.

### 3.1 R2 키(폴더) 구조 — UID 격리 [DECIDED]

> 모든 객체 키의 최상위 prefix는 **Supabase Auth UID**. 작업자별 폴더가 물리적으로 분리된다.

```
{uid}/sources/preview/{video_id}.mp4      # 원본 영상 (미리보기/렌더 입력)
{uid}/sources/bgm/{clip_id}.mp3           # 업로드 BGM
{uid}/renders/{project_id}/{clip_id}-{preset}.mp4   # 렌더 결과
```

- `yt_source_path`에는 R2 상대 객체 key만 저장한다. `bgm_url`·`render_path`는 아직 Supabase Storage 객체 path이며 후속 Lane에서 R2 key로 전환한다.
- **격리 규칙:** Railway가 presigned URL을 발급할 때 `요청자 UID == 키의 {uid} prefix`를 반드시 검증. 불일치 시 403.

### 3.1.1 로컬 source pass-through [DECIDED]

> R2 = 진실의 원본 / Mac 로컬 = job 수명에 한정된 스크래치.

- DB는 항상 `{uid}/sources/...` R2 key를 가리키며 로컬 경로나 절대 URL을 저장하지 않는다.
- Import는 yt-dlp → `STORAGE_ROOT/{uid}/sources/...` 임시 파일 → R2 PUT → 로컬 source 즉시 삭제 순서다.
- Render는 R2 GET → job별 임시 디렉터리 → Remotion 로컬 입력 → job 종료 시 전체 삭제 순서다.
- 중간 wav·분리본 등 처리 중간재는 R2에 게시하지 않는다.

### 3.2 접근 흐름 (Auth → 인가 → 파일)

```
브라우저 ──로그인──▶ Supabase Auth (UID·세션 발급)
   │
   └──요청(영상 보기/업로드)──▶ Railway Next.js
                                   │ 1. 세션 검증 (Supabase Auth)
                                   │ 2. UID prefix 소유권 확인
                                   │ 3. R2 presigned URL 발급 (S3 SDK)
                                   ▼
브라우저 ──presigned URL──▶ Cloudflare R2 (source 직접 GET, CDN egress)
```

- ingest/render 워커(Mac)는 source에 한해 **R2 서비스 키**로 직접 PUT/GET한다. presigned 흐름은 브라우저 source playback용.

### 3.3 셀프 데이터 삭제 [DECIDED · 후속 구현]

> 각 작업자는 자기 UID 폴더의 데이터를 스스로 삭제한다.

- **삭제 단위:** 프로젝트 단위 + UID 전체 단위(계정 데이터 비우기) 둘 다 제공. [CONFIRM] 클립 단위 삭제까지 노출할지.
- **삭제 절차 (DB + R2 동시 정리, 고아 방지):**
1. Railway가 요청자 UID 소유권 검증.
1. Supabase에서 해당 row 삭제 (FK CASCADE: projects → clips → lyrics_segments/comments).
1. R2에서 `{uid}/.../{대상 prefix}` ListObjectsV2 → DeleteObjects 배치 삭제.
1. 둘 중 하나 실패 시 보상 로직(재시도 큐 또는 orphan 마킹). R2엔 트랜잭션 없음 → **DB 먼저 삭제 후 R2 정리** 순서로, 실패 잔여물은 `cleanup-orphan-storage`가 주기 청소.
- **안전장치:** 본인 UID 외 삭제 불가. 확인 모달 필수. [CONFIRM] soft-delete(휴지통) 단계 둘지 hard-delete만 할지.

-----

## 4. Stack

- **프레임워크:** Next.js 14.2.x (App Router) · TypeScript 5.7
- **런타임:** Node **20.x 고정** (`.nvmrc`=20 + `nvm alias default 20` + package.json `engines`). 개발 셸·Mac 워커 동일 버전 필수(불일치 시 Remotion/tsx 회귀).
- **패키지 매니저:** **pnpm 10.x 전용 [DECIDED]** (Node 20). 현재 `pnpm@10.34.1` 고정. npm/yarn 금지. pnpm 11은 Node 22 강제라 보류. 상세는 §9.1.
- **렌더:** Remotion 4.0.451 (`@remotion/bundler|cli|player|renderer`)
- **DB/Auth:** Supabase (`@supabase/supabase-js` 2.45.4) — Postgres + Auth + RLS
- **스토리지:** Cloudflare R2 (`@aws-sdk/client-s3` + Python boto3). source 전환 완료, BGM/render output 후속
- **LLM:** **Gemini 2.5 Flash Lite [DECIDED · 구현됨]** (Curator). **Google Gemini SDK(`@google/genai`) 도입 완료** — `lib/llm/gemini.ts`의 `generateJson<T>()`가 `responseMimeType:'application/json'` 구조화 출력 + zod 검증으로 호출한다. 기존 `@anthropic-ai/sdk`는 제거(2026-06-16). `lib/llm/anthropic.ts`는 import 경로 보존용 thin shim(→gemini 재export).
- **검증:** zod 4.3.6 (LLM 입출력·외부 API·env 전부)
- **오디오 UI:** wavesurfer.js 7
- **ingest 워커:** Python + yt-dlp (Docker), FastAPI(server.py)
- **테스트:** vitest

-----

## 5. Architecture

**상단 메뉴 (우상단 네비, 4개 · 비선형):** `Curation` | `Select` | `Editor` | `History`

- **Curation** (참고 전용): 곡 추천·영상·설명문구 **열람만**. 프로젝트 생성/import 안 함(read-only 영감 보드). Gemini 추천 + YouTube 검색 결과 표시.
- **Select** (작업 진입점): **YouTube 링크 입력 컴포넌트** → `projects` 생성 + `import_status='pending'`. 실제 작업의 시작점.
- **Editor**: 클립 편집(WaveformEditor 구간선택 → 자막/댓글/BGM/스타일/프리뷰) + 렌더 트리거.
- **History**: 렌더 결과(Supabase Storage, 후속 R2 이전) 열람·다운로드.

```
작업 흐름:   Select(링크 입력) → Import(yt-dlp/Mac) → Editor → Render(Remotion/Mac) → History
참고(흐름 밖): Curation — 독립 열람 메뉴, import로 이어지지 않음
```

**핵심 모듈**

- `app/curation` — 추천·영상·설명문구 read-only 열람 (Gemini + YouTube)
- `app/select` — YouTube 링크 입력 → projects 생성 + import 트리거
- `app/editor/[id]` — 클립 편집(자막/댓글/BGM/스타일/프리뷰)
- `app/history` — 렌더 결과 목록(폴링 갱신) + 열기/다운로드
- `app/api/*` — 상태 변경 + presigned URL 발급(무거운 처리 없음)
- `lib/curator`, `lib/llm` — Gemini 호출·톤 변환
- `remotion/` — LayoutA/B/C 컴포지션 + 레이어(Video/Subtitle/Comment)
- `workers/ingest`, `workers/render` — Mac 로컬 워커

**데이터 흐름:** Select가 status를 pending으로 기록 → Mac 워커가 폴링으로 픽업 → 로컬 처리 → source를 R2에 게시 → DB에 상대 key·성공상태 기록 → UI 폴링으로 반영.

-----

## 6. Data Model (Supabase)

|테이블                    |핵심 컬럼                                                                                                                                                                                                                                                                                                                   |관계                                                        |비고                                                             |
|-----------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------|---------------------------------------------------------------|
|`projects`             |artist, song_title, source_url, **ip_owner**(bool), ip_confirmed_at, yt_video_id, yt_title, yt_duration_sec, yt_thumbnail_url, **yt_source_path**(=R2 key), import_status, import_error, **processing_started_at**, song_lyrics, song_lyrics_timestamps(jsonb), description_base, description_styled, description_tone(ref_01/02/03), **owner_uid**|1—N clips · 1—N track_recommendations                     |owner_uid=auth.uid(). processing_started_at=ingest claim UTC 시각. ~yt_hq_source_path 죽은컬럼~|
|`templates`            |name, config_json(jsonb)                                                                                                                                                                                                                                                                                                |1—N clips                                                 |**시드(3행)·전역 read-only.** Remotion 레이아웃. 폐기 금지                  |
|`clips`                |project_id, template_id, start/end_sec, label, render_status(+cancelled), render_path(Supabase Storage path, 후속 R2), render_error, render_preset(fast/balanced/quality), render_progress, bgm_url(Supabase Storage path, 후속 R2), bgm_volume, bgm_start_sec, original_volume, subtitle_style(jsonb), comment_style(jsonb), **bar_enabled**|N—1 projects/templates · 1—N lyrics/comments/text_overlays|소유권은 project 상속. bar_enabled=상/하단 검정 바(각 15% 고정)|
|`text_overlays`        |clip_id, **zone**(top/bottom), content, x, y, rotation, font_key, size, color, align, effect, z_index, start_sec, end_sec                                                                                                                                                                                               |N—1 clips                                                 |**자유 텍스트** — 검정 바 위 배치. 좌표·크기 전부 상대값. 소유권 상속                   |
|`lyrics_segments`      |clip_id, text, start_sec, end_sec, “order”                                                                                                                                                                                                                                                                              |N—1 clips                                                 |소유권 상속                                                         |
|`comments`             |clip_id, username, body, likes_count, source, is_selected                                                                                                                                                                                                                                                               |N—1 clips                                                 |소유권 상속                                                         |
|`track_recommendations`|batch_id, rank(1-3), artist, song_title, release_year, genre, reason, role(popular/reliable/wildcard), popularity_estimate(1-10), topic, era, genre_filter, yt_video_id, yt_title, yt_search_status(pending/found/not_found), used, used_project_id, **owner_uid**                                                      |FK→projects (ON DELETE SET NULL)                          |**독립 owner_uid** (Curation에서 프로젝트 전 존재)                        |
|`tone_presets`         |key(ref_01/02/03 unique), label, description, reference_text, is_active                                                                                                                                                                                                                                                 |독립                                                        |**시드(3행)·전역 read-only.** 폐기 금지                                 |
|`worker_health`        |worker_id(PK), last_beat_at, note                                                                                                                                                                                                                                                                                         |독립                                                        |service_role 워커가 upsert. authenticated는 SELECT only. ingest UI 오프라인 판정에 사용|

### 6.1 Auth & RLS [DECIDED]

- **가입:** 초대/관리자 생성제. 공개 sign-up **비활성**(Supabase 대시보드에서 끔). **provider = 이메일+비밀번호 [DECIDED]**. 운영 규모 **최대 5인**이라 계정은 대시보드에서 수동 발급. 첫 계정 = 소유자 본인(= owner_uid 기준).
- **owner_uid 범위:** `projects`·`track_recommendations`에만. 하위 테이블은 project join으로 상속.
- **RLS 정책:**
  - `projects`, `track_recommendations`: `owner_uid = auth.uid()` (SELECT/INSERT/UPDATE/DELETE).
  - `clips`/`lyrics_segments`/`comments`/`text_overlays`: `EXISTS(상위 project where owner_uid = auth.uid())`.
  - `tone_presets`·`templates`: authenticated는 **SELECT only**(쓰기 차단). 둘 다 전역 시드, 폐기 금지.
- **워커는 RLS 우회:** ingest/render 워커는 모든 사용자의 pending을 처리해야 하므로 **service_role 키** 사용. service_role은 `.env`에만, 클라이언트·공개 레포 노출 절대 금지. ingest 워커는 project의 owner_uid를 읽어 source R2 key의 `{uid}/`에 반영.
- **Auth 통합 (구현 순서):**
1. Supabase 대시보드: 공개 가입 끄기 + 소유자 계정 수동 생성(최대 5인 수동 발급).
1. `@supabase/ssr` 설치 → `lib/supabase/server.ts`·`client.ts`(쿠키 세션).
1. `middleware.ts`: 비로그인 시 보호 라우트(`/curation`·`/select`·`/editor`·`/history`) → `/login` 리다이렉트.
1. `app/login`: 이메일+비밀번호 폼(가입 폼 없음). 상단 네비에 로그아웃.
1. presign API: `auth.uid()`로 요청자 확인 → R2 키 `{uid}/` prefix 대조(Phase 3와 완성).
- **워커 예외:** ingest/render 워커는 로그인하지 않고 **service_role 키로 RLS 우회**(모든 사용자 pending 처리). 키는 `.env`에만, 공개 레포·브라우저 노출 금지. ingest 워커는 project.owner_uid를 source R2 key에 반영.

**상태머신**

- `import_status`: null → pending → processing → success | failed (재시도: failed/success → pending)
- `render_status`: null → pending → processing → success | failed (재렌더: processing 제외 → pending, processing은 409)
- 전이 주체: null→pending = Railway API / pending→processing 이후 = Mac 워커(원자적)

**죽은 컬럼(베이스라인에서 제외)**

- `projects.yt_hq_source_path` — 단일소스 전략으로 미사용 (코드 참조 제거 동반 필요)
- `clips.transcribe_status` — whisperX 제거 후 미사용 (코드 참조 제거 동반 필요)

-----

## 7. Jobs & Flows

> 각 job은 **[runs]** 와 **[stores]** 를 태깅한다.

|Job/Flow         |트리거                              |주기       |[runs]           |[stores]                           |책임                               |
|-----------------|---------------------------------|---------|-----------------|-----------------------------------|---------------------------------|
|import(ingest)   |`/api/import` → status=pending   |1초 폴링    |Mac Studio       |로컬 스크래치 → **R2 source PUT** + Supabase(meta)|UID key 저장 후 로컬 source 삭제. 원자 claim·부팅 self-heal 유지|
|worker heartbeat|ingest 워커 독립 태스크            |30초       |Mac Studio       |Supabase `worker_health`             |다운로드 처리와 독립적으로 `worker_id='ingest'` last_beat_at upsert. UI는 2분 stale 또는 행 없음이면 offline 표시|
|stale ingest reaper|pg_cron                         |2분        |Supabase         |Supabase `projects`                  |processing_started_at이 15분 초과한 processing을 failed + timeout 오류로 전환|
|bgm upload       |`/api/upload-bgm` → ingest-server|on-demand|Mac Studio(:8001)|Supabase Storage + Supabase (후속 R2)|BGM 수신·게시                        |
|render           |`/api/render` → status=pending   |3초 폴링    |Mac Studio       |**R2 source GET** → 로컬 스크래치 → Supabase Storage(render 결과, 후속 이전)|Remotion은 로컬 source를 읽고 job 종료 시 스크래치 삭제|
|curator recommend|`/api/curator/*`                 |on-demand|Railway          |Supabase                           |Claude+YT 추천                     |
|source presign   |`GET /api/source-url?project_id=...`|on-demand|Railway          |R2(1시간 GET 서명)                     |Auth user·project owner_uid·key UID prefix를 모두 검증|
|self-delete      |`/api/projects/[id]` DELETE 등    |on-demand|Railway          |Supabase DB/Storage                 |R2 source 삭제는 후속 구현 필요          |
|orphan cleanup   |`pnpm cleanup:storage`           |수동/주기    |Mac or Railway   |Supabase Storage                   |R2 source cleanup은 후속 구현 필요        |

-----

## 8. LLM & External APIs

- **LLM:** **Gemini 2.5 Flash Lite** (Curator). `@google/genai`로 호출, `gemini-2.5-flash-lite` 모델. 구조화 JSON 출력 + zod 검증(`lib/llm/gemini.ts`). `@anthropic-ai/sdk`는 폐기(2026-06-16).
- **외부 API:** YouTube Data API v3 (메타데이터·댓글·검색). rate limit 주의.
- **검증:** 모든 LLM 출력·YT 응답·env를 zod로 강제.

### 8.1 렌더 속도 — "display mode 5" 판단 [2026-06-16]

> 다른 레포(g-ytp-v1, 순수 ffmpeg 파이프라인)의 `displayMode 5` 개념을 이 레포에 적용 가능한지 조사한 결과.

- **v1 `displayMode` (`["0","2","5","full"]`)는 타이틀 카드 표시 방식**이고, v1의 "1시간→72초(약 43배)"는 *모드 번호*가 아니라 **"정적 배경 이미지 + 짧은 오버레이라 화면이 안 변하는 구간을 ffmpeg `-c copy`로 stream-copy"** 한 결과다. `0`=전체 copy, `2`/`5`=오버레이 5초 구간만 인코딩+나머지 copy(fast-path), `full`=상시 표시라 fast-path 없음→전체 재인코딩(0.9배).
- **이 레포(v2)에는 그대로 이식 불가 [DECIDED]:** (1) 엔진이 다름 — v2는 Remotion(헤드리스 Chrome 프레임 렌더)이라 displayMode·copy 경로 개념이 없다. (2) **결정적 차이 — 배경이 정지 이미지가 아니라 움직이는 유튜브 영상**(`VideoLayer`의 `OffthreadVideo`)이라 "정적 스틸→루프 copy" 트릭이 성립하지 않는다. (3) 클립 전체에 BGM 믹싱+`original_volume` 조절을 하므로 **오디오 stream-copy 원천 불가**.
- **채택 방향 [DECIDED]:** v2의 현실적 가속은 **Remotion 네이티브 레버 튜닝**으로 한다(아래 §8.2). v1식 segment stream-copy 하이브리드(오버레이 없는 구간만 소스 copy)는 keyframe 정렬·오디오 별도 mux·바/자막 상시표시 시 이득 소멸 등 제약이 커, 별도 POC 대상으로 §12에 보류 등록.

### 8.2 렌더 워커 속도 레버 (`workers/render/worker.ts`) [구현됨 2026-06-16]

- `hardwareAcceleration:'if-possible'` — h264_videotoolbox 자동 사용+SW 폴백. 기존 23줄짜리 깨지기 쉬운 `overrideFfmpegCommand` videotoolbox 수술을 **제거**하고 전 프리셋에 적용.
- `imageFormat:'jpeg'` + `jpegQuality:90` — 프레임 캡처 가속(화질 손실 무시 가능).
- `x264Preset` — 소프트웨어 프리셋 인코딩 가속(`balanced`=veryfast, `quality`=medium).
- `offthreadVideoCacheSizeInBytes` ↑(2GB) — OffthreadVideo 소스 프레임 재추출 회피(영상 기반 컴포지션이라 효과 큼).
- `chromiumOptions:{gl:'angle'}` — Apple Silicon 권장 GL 백엔드 고정.
- `cancelSignal`(`makeCancelSignal`) — 15분 타임아웃이 `renderMedia`를 **실제 취소**(기존 `Promise.race`는 poll만 reject하고 Chromium/ffmpeg 잔존 → 다음 job과 경합).

-----

## 9. Conventions

> 이 레포만의 규칙. 새 규칙이 생기면 여기 추가.

### 9.1 패키지 매니저 — pnpm 10.x 전용 [DECIDED · 강제]

- **버전 라인: pnpm 10.x + Node 20** (현 스택 호환). pnpm 11은 Node 22를 강제하므로 **지금은 보류**(Node 22 전환 시 별도 검토).
- **npm·yarn 사용 전면 금지.** 모든 설치/실행은 `pnpm`.
- 버전 고정: 레포에서 `corepack use pnpm@10` 실행 → `package.json`의 `"packageManager": "pnpm@10.x.x+sha..."`가 정확한 패치+해시로 자동 기입된다(임의 숫자 박지 말 것).
- **Remotion/esbuild 빌드 스크립트 주의:** pnpm은 기본적으로 의존성 postinstall(빌드 스크립트)을 차단한다. Remotion 렌더가 깨지면 설정에 `onlyBuiltDependencies: [esbuild, ...]`로 허용. [CONFIRM] 설치 후 렌더 정상동작 검증.
- **lockfile은 `pnpm-lock.yaml`만.** `package-lock.json`·`yarn.lock`은 삭제하고 `.gitignore`에 추가.
- 명령 대응표:
  - `npm install` → `pnpm install`
  - `npm run dev|build|start|lint|test` → `pnpm dev|build|start|lint|test`
  - `npm run render-worker` → `pnpm render-worker`
  - `node scripts/x.mjs` → `pnpm cleanup:storage` 등 스크립트 경유
- **Railway 빌드:** pnpm으로 install/build 하도록 설정(`railway.json` 또는 nixpacks/`packageManager` 필드). [CONFIRM] 현재 railway.json 빌드 커맨드 확인·교체 필요.
- AI(Claude Code 포함)는 명령 제안 시 **항상 pnpm**으로 출력. npm 명령을 쓰면 규칙 위반.

### 9.2 기타

- zod 검증 의무 (모든 외부 경계).
- 상태 전이는 **조건부 업데이트**로 (`WHERE status != 'processing'`) — 중복 처리 가드. (§12 Issue)
- R2 객체 키는 **반드시 `{uid}/` prefix**로 시작.
- **절대경로 하드코딩 금지.** 로컬 경로는 `STORAGE_ROOT` 등 env로 주입하고, 코드/문서/공개 레포에 `/Users/...` 절대경로·사용자명을 박지 않는다. 실제 경로는 `.env`(gitignore)에만.
- 코드 변경 시 이 `project_spec.md` 동시 갱신(spec drift 금지).

-----

## 10. Build Status (Phases) — 리빌딩

|Phase|범위                                                                                              |상태    |PR/메모                                                                          |
|-----|------------------------------------------------------------------------------------------------|------|-------------------------------------------------------------------------------|
|0    |문서 단일화(PROJECT_SPEC.md 삭제, 이 spec 확정) + PR 4개 닫기                                                |☑ 완료  |#75/#77/#82/#85 closed, PROJECT_SPEC.md 삭제됨                                    |
|1    |pnpm 전환 + Node 20 통일(lock 교체, packageManager 10.34.1, railway.json, .gitignore, .nvmrc, engines)|☑ 완료  |`phase1/pnpm-migration` 브랜치, type-check 통과, push 대기                            |
|2    |**DB 베이스라인 재설정(squash)** + `owner_uid` + Supabase Auth(이메일/비번) + RLS                            |☐ todo|init SQL 작성됨. 5개만 재생성, 시드 2개 보존. 데이터 폐기(A) 확정                                  |
|3    |R2 이전 + presign API + UID 격리                                                                      |◐ source 완료|source PUT/GET/presign 코드 완료. 실제 R2 full ingest와 BGM/render 결과 전환은 운영·후속 검증 필요|
|4    |**워크플로우 재편** (메뉴화: Curation read-only / Select 진입점 / Editor / History)                          |☑ 완료  |4개 상단 메뉴 연결, Select가 owner_uid 프로젝트 생성의 단일 진입점                              |
|5    |중복 가드(Issue 1·2·8) + 남은 죽은 코드(lambda.ts, worker.mjs)                                            |☐ todo|죽은 컬럼은 Phase 2 베이스라인에 흡수됨                                                      |
|6    |**WYSIWYG 자유 텍스트 오버레이** (검정 바 위 배치)                                                             |☑ 완료  |공유 BarLayer/TextOverlayLayer + Moveable 드래그·리사이즈·회전 + text_overlays 저장             |

-----

## 11. Decisions

- `2026-06-03` — 배포는 **Railway 확정**(Vercel 폐기) : 상시 프로세스가 폴링/프록시에 유리, 기존 문서 의도와 정합.
- `2026-06-03` — 파일 스토리지 **Cloudflare R2 확정** : 영상은 egress가 비용 지배 → egress 무료인 R2가 최적. Supabase Storage 폐기.
- `2026-06-03` — **UID별 R2 폴더 격리** : Supabase Auth UID를 키 최상위 prefix로. 작업자별 물리 분리 + presign 시 소유권 검증.
- `2026-06-03` — 단일 사용자 → **다중 작업자 + 웹 접속**으로 전제 변경 : Auth/RLS 활성화·중복 가드가 필수로 승격.
- `2026-06-03` — **pnpm 전용** : npm/yarn 금지, lockfile 단일화.
- `2026-06-03` — 작업 파일은 Mac 로컬 스크래치 처리, 최종물만 R2 게시(하이브리드) : 다중 동시 접속 시 Mac 대역폭 병목 회피. 렌더 입력은 항상 로컬에서 읽어 처리속도 손실 없음.
- `2026-06-03` — pnpm **10.x + Node 20** 라인 확정 : pnpm 11은 Node 22 강제 → 현 워커(`nvm use 20`)와 충돌, 리빌딩 중 런타임 변수 최소화.
- `2026-06-03` — Curator LLM = **Gemini 2.5 Flash Lite**(MVP) : 필요 시 교체.
- `2026-06-03` — Mac 스크래치 경로 = `<repo>/storage/` : 레포 하위에 두되 .gitignore로 커밋 차단.
- `2026-06-03` — PR #75 main 반영 **실증**(next.config.mjs에 `staleTimes:{dynamic:0}` 존재) → Draft는 중복 잔재, 닫기.
- `2026-06-03` — **PR 4개(#75/#77/#82/#85) 전부 닫기 확정** : 모두 main에 이미 반영된 뒤 남은 Draft 잔재로 간주.
- `2026-06-03` — Curator는 **Google Gemini SDK**로 호출(REST 아님) : Google SDK 도입 필요.
- `2026-06-03` — 로컬 경로 **env(`STORAGE_ROOT`)화** : 레포가 public이라 절대경로·사용자명 노출 방지 + 폴더 이동 내성 확보(.env 한 줄로 경로 변경).
- `2026-06-03` — **Node 20 통일** : 실환경 Node 22 감지됐으나 개발 셸·Mac 워커 모두 20으로 일원화(`nvm alias default 20` + `.nvmrc`=20 + `engines`). Remotion/tsx 워커 회귀 방지. pnpm은 10.34.1 유지(11 불필요).
- `2026-06-08` — **Lane A source pass-through** : ingest는 boto3 R2 PUT 후 로컬 source를 즉시 삭제하고, render worker는 R2 GET으로 job 임시 디렉터리에 받아 사용 후 삭제한다. 브라우저는 Railway의 1시간 presigned GET만 사용하며 Auth UID·owner_uid·key prefix가 모두 일치해야 한다.
- `2026-06-03` — **워크플로우 메뉴화** : 선형(Curator→Import→…)을 폐기하고 상단 메뉴 4개(Curation/Select/Editor/History)로 재편. **Curation은 import로 안 이어지는 read-only 참고 보드**, **Select가 YouTube 링크 입력 = 작업 진입점**.
- `2026-06-03` — **Auth/RLS = A/A/A** : (D1) 초대/관리자 생성제, 공개 가입 비활성. (D2) owner_uid는 projects·track_recommendations에만, 하위는 project 상속. (D3) tone_presets는 전역 공유 read-only.
- `2026-06-03` — **마이그레이션 squash(베이스라인 재설정)** : 26개 누더기 + 죽은 컬럼을 클린 init 1개로 통합. **데이터 폐기(A) 확정**(projects/clips 0행, track_rec 38행 — 무손실). 단 **시드 2개(templates·tone_presets) 보존**(drop 안 함, RLS만 추가).
- `2026-06-03` — **Auth = 이메일+비밀번호, 운영 최대 5인** : 공개 가입 비활성, 계정은 Supabase 대시보드 수동 발급. 내부 도구라 OAuth 외부설정 불필요. 인원 증가 시 OAuth 재검토.
- `2026-06-05` — **자유 텍스트 오버레이(Phase 6)** : 가사 자막은 기존 위치 고정(건드리지 않음). 상/하단 검정 바(각 15% 고정) 위에만 자유 텍스트 배치. 별도 `text_overlays` 테이블(zone=top/bottom, 좌표·크기 전부 상대값). 검정 바는 `clips.bar_enabled`로 분리(기존 subtitle_style에서 이전).
- `2026-06-05` — **폰트 12종 고정**(전부 구글폰트, `lib/fonts.ts` 단일 레지스트리·에디터/Remotion 공유) : 영문 montserrat/inter/bebas/playfair/oswald/roboto + 한글 noto_kr/gmarket/nanum_square/gowun/black_han/jua. Pretendard는 jua로 교체(구글폰트 통일). 무제한 폰트는 렌더·로딩 부담이라 12종 enum 강제.
- `2026-06-06` — **폰트 로딩 구현** : 10종은 `@remotion/google-fonts`, Gmarket Sans·NanumSquare는 해당 패키지 미지원으로 로컬 폰트 자산과 `@remotion/fonts`를 사용. 브라우저와 Remotion은 `lib/fonts.ts`의 동일한 `font_key` 정의를 공유.
- `2026-06-06` — **service_role 클라이언트 분리** : `lib/supabase/service-role.ts`는 서버·로컬 워커 전용이며 RLS를 우회한다. 활성 ingest/render worker의 anon key fallback을 제거해 service_role 누락 시 즉시 실패하도록 고정.
- `2026-06-06` — **Auth 문지기 구현** : `/curation`·`/select`·`/editor`·`/history`와 하위 경로를 쿠키 세션으로 보호하고, `/login`과 정적 자산은 미들웨어 인증 검사에서 제외한다.
- `2026-06-06` — **워크플로우 메뉴 구현** : `/editor`가 프로젝트 목록을 직접 제공하고 구형 `/projects`·`/projects/new`는 각각 `/editor`·`/select`로 리다이렉트한다. 프로젝트·추천 생성은 `owner_uid`를 필수로 기록하며 구형 스키마 fallback을 허용하지 않는다.
- `2026-06-06` — **자유 텍스트 WYSIWYG 구현** : 에디터 Player와 최종 Remotion 렌더가 동일한 `BarLayer`·`TextOverlayLayer`를 사용한다. Moveable 조작값은 zone 내부 상대좌표와 화면높이 비율로 `text_overlays`에 저장한다.
- `2026-06-06` — **렌더 중복 가드 복구** : `/api/render`는 `render_status is null or != processing`인 행만 원자적으로 pending 전환하고, 이미 processing이면 409를 반환한다. stale processing 복구는 Mac 워커 시작 로직이 담당한다.
- `2026-06-06` — **상단 네비 단일화** : 루트 `app/layout.tsx`의 AppNav만 전역 렌더하며, 페이지별 DashboardNav와 Editor 상세의 중복 History 진입점은 폐기한다.
- `2026-06-16` — **LLM 공급자 = Gemini 확정(코드 정합)** : 스펙은 Gemini였으나 코드가 `@anthropic-ai/sdk`였던 drift를 해소. `@google/genai`(`gemini-2.5-flash-lite`)로 교체하고 anthropic 의존성 제거. `generateJson` 인터페이스는 보존(`lib/llm/anthropic.ts`는 shim).
- `2026-06-16` — **"display mode 5" 비이식 + Remotion 레버 채택** : v1의 ffmpeg stream-copy fast-path는 v2(Remotion·움직이는 영상 배경·전구간 BGM 믹싱)에 성립하지 않음. 대신 hardwareAcceleration/jpeg/x264Preset/offthread 캐시/gl:angle/cancelSignal로 가속(§8.1·§8.2). segment stream-copy 하이브리드는 POC 보류(§12).
- `2026-06-16` — **API 코드 가드 하드닝** : `/api/*`가 미들웨어 밖이고 RLS는 Phase 2(미적용)라 cross-tenant 노출 상태였음. RLS 활성화/마이그레이션 컷오버는 보류하고, 각 라우트에 `getUser()`+owner_uid 소유권 검증을 추가(방어적). `/api/debug` 삭제, `render/cancel` 결과 검증 수정. 데드코드 제거: `lib/rendering/lambda.ts`·`local.ts`, `workers/render/worker.mjs`.
- `2026-06-08` — **ingest reaper 신뢰성 설계** : claim은 `processing_started_at=now()`를 원자 기록하고, Supabase pg_cron `reap_stale_ingest`가 2분마다 15분 초과 processing을 failed로 전환한다. 워커 부팅 self-heal도 동일 조건만 처리하며, 다운로드와 독립된 30초 heartbeat 태스크는 `worker_health(worker_id='ingest')`에 upsert한다. UI 오프라인 기준은 heartbeat 2분 stale이다.

-----

## 12. Known Issues / Backlog

- [ ] **Gate 2 Lane B 운영 수용 테스트** — 코드(B-2/B-4)는 구현됨. Mac ingest 워커 재기동 후 heartbeat 갱신, 처리 중 강제 종료 후 최대 17분 내 pg_cron failed 전환, 재기동 self-heal을 라이브 작업으로 검증해야 Gate 2 전체 통과로 판정한다.
- [ ] **Lane A 운영 수용 테스트** — R2 실키로 50MB 초과 1080p full ingest, 버킷 `{uid}/sources/...` 객체, Editor presigned 재생, 타 UID 403을 확인해야 source Gate를 통과한다.
- [ ] **R2 자격증명 AccessDenied** — 2026-06-08 현재 설정으로 HeadBucket·ListObjectsV2·UID prefix PutObject가 모두 403/AccessDenied. Cloudflare에서 토큰의 대상 bucket=`gv2-sources`, 권한=`Object Read & Write`, account/endpoint 일치를 재발급·확인한 뒤 운영 수용 테스트를 재실행한다.
- [ ] **R2 후속 범위** — 이번 Lane A는 source만 전환했다. BGM·render output·삭제/orphan cleanup은 아직 Supabase Storage 경로이므로 별도 전환이 필요하다.
- [ ] **R2 source 삭제 보상** — 프로젝트 삭제가 아직 Supabase Storage만 지우므로 R2 source 객체가 남는다. source key 소유권 검증 후 DeleteObject와 orphan cleanup을 후속 Lane에 추가한다.
- [x] **PR #75/#77/#82/#85 — 전부 닫기 확정.** 모두 main에 이미 반영된 뒤 남은 Draft 잔재. (#75는 next.config.mjs로 실증, 나머지 동일 패턴으로 간주.)
- [x] **Google Gemini SDK 도입 완료**(`@google/genai`, `gemini-2.5-flash-lite`) + Curator 호출부 gemini로 정리, anthropic 의존성 제거 (2026-06-16).
- [ ] **렌더 segment stream-copy 하이브리드 POC** — 오버레이 없는 구간만 소스 mp4 stream-copy + 오버레이 구간만 Remotion 렌더 후 `-c copy` concat. 제약: keyframe 정렬, 오디오(전구간 BGM 믹싱)는 항상 재인코딩·별도 mux, `bar_enabled`/자막 상시표시 시 이득 소멸. 자막 밀도 높은 큐레이션 클립 특성상 이득 편차 큼 → 별도 설계·POC 후 판단(§8.1).
- [ ] **API 가드 → RLS 승격** — 현재는 라우트별 `getUser()`+owner 코드 가드만. Phase 2 RLS 활성화 시 DB 레벨에서도 강제되도록 이중화(코드 가드는 방어적으로 유지).
- [ ] **Phase 2: DB 베이스라인 재설정(squash)** — init SQL 작성 완료. 적용 시 5개 테이블(projects·clips·lyrics_segments·comments·track_recommendations)만 drop&재생성, **시드 2개(templates·tone_presets)는 보존하고 RLS만 추가**. 브랜치 검증 후 운영 전환.
- [ ] **RLS + Auth 활성화** — Phase 2에 포함. service_role 워커 우회 구조 검증.
- [ ] 죽은 컬럼(`hq_source_path`, `transcribe_status`)·whisperX 잔재 — **Phase 2 베이스라인에서 자연 제외**(별도 DROP 마이그레이션 불요).
- [x] **검정 바 컬럼 이전** — `subtitle_style` JSON의 바 키를 제거하고, 에디터·토글·Remotion·render worker를 `clips.bar_enabled`로 통일. 상/하단 높이 15%와 검정색은 레이어 코드 상수로 고정.
- [x] **워크플로우 재편(Phase 4)** — Curation 참고 보드 / Select 링크입력·프로젝트 생성 / Editor 프로젝트 목록·편집 / History 렌더 결과를 상단 네비로 연결.
- [x] **죽은 코드 제거 완료**(2026-06-16): `lib/rendering/lambda.ts`·`lib/rendering/local.ts`(빈 stub, 참조 0), `workers/render/worker.mjs`(발산된 죽은 워커 — 폐기 대상 Supabase Storage `sources`에서 읽고 anon key 사용). 실 워커는 `workers/render/worker.ts`(tsx).
- [ ] `INGEST_WORKER_URL` 외부 노출 방식(터널/고정IP) 운영 확정.
- [ ] Curator = Gemini 2.5 Flash Lite (Google SDK 호출). [CONFIRM] 기존 `@anthropic-ai/sdk`의 실제 용도 확인.
- [ ] 동시 편집 충돌 정책(낙관적 잠금 or 프로젝트 분리 규칙).
- [ ] Mac 스크래치 경로·보존정책 확정.
