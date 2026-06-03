# galaxymap_ytp_v2 — 아키텍처 & 설계 문서

> 작성일: 2026-06-03  
> 현재 구현 기준. PROJECT_SPEC.md는 과거 설계 문서로 일부 내용이 실제 코드와 다름.

---

## 목차

1. [전체 시스템 구조](#1-전체-시스템-구조)
2. [파일 트리](#2-파일-트리)
3. [데이터베이스 스키마](#3-데이터베이스-스키마)
4. [워크플로우 상세](#4-워크플로우-상세)
5. [API 엔드포인트 목록](#5-api-엔드포인트-목록)
6. [데이터 상태 머신](#6-데이터-상태-머신)
7. [알려진 이슈 & 쟁점](#7-알려진-이슈--쟁점)
8. [인프라 & 배포](#8-인프라--배포)

---

## 1. 전체 시스템 구조

```
┌─────────────────────────────────────────────────────────┐
│                    Railway (클라우드)                     │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │            Next.js 14 App (port 3000)           │    │
│  │                                                  │    │
│  │  Pages: /projects  /editor/[id]  /history       │    │
│  │  APIs:  /api/import  /api/render  /api/curator  │    │
│  │         /api/upload-bgm  /api/comments/fetch    │    │
│  └───────────────────┬─────────────────────────────┘    │
└──────────────────────┼──────────────────────────────────┘
                       │ read/write
                       ▼
┌──────────────────────────────────────────────────────────┐
│                  Supabase (DB + Storage)                  │
│                                                          │
│  Tables: projects, clips, lyrics_segments,               │
│          comments, track_recommendations, tone_presets   │
│  Buckets: sources (영상+BGM)  /  renders (결과물)        │
└──────────┬─────────────────────────────┬─────────────────┘
           │ polling (3s)                │ polling (3s)
           ▼                             ▼
┌─────────────────────┐    ┌────────────────────────────────┐
│   Mac Studio        │    │   Mac Studio                   │
│                     │    │                                │
│  Docker             │    │  Node.js                       │
│  ┌───────────────┐  │    │  ┌──────────────────────────┐ │
│  │ ingest-worker │  │    │  │   render-worker           │ │
│  │ (worker.py)   │  │    │  │   (worker.ts)             │ │
│  │ yt-dlp 다운로드│  │    │  │   Remotion 렌더           │ │
│  └───────────────┘  │    │  └──────────────────────────┘ │
│  ┌───────────────┐  │    └────────────────────────────────┘
│  │ ingest-server │  │
│  │ (server.py)   │  │
│  │ port 8001     │  │◄── Next.js /api/upload-bgm 프록시
│  └───────────────┘  │
└─────────────────────┘
```

### 핵심 설계 원칙

**Queue 구조**: Next.js API는 DB 상태만 변경하고 실제 처리는 하지 않는다.  
실제 무거운 작업(yt-dlp 다운로드, Remotion 렌더)은 Mac Studio의 워커가 폴링으로 처리.

**유일한 예외 — BGM 업로드**: `/api/upload-bgm` → `localhost:8001` 직접 HTTP 프록시.  
Railway 환경에서는 `INGEST_WORKER_URL` 환경변수로 Mac의 8001 포트를 외부 노출해야 작동.

---

## 2. 파일 트리

```
galaxymap_ytp_v2/
├── CLAUDE.md                    # AI 협업 컨텍스트 문서 (운영 기준)
├── DESIGN.md                    # UI/UX 디자인 가이드라인
├── PROJECT_SPEC.md              # 과거 설계 문서 (일부 미반영)
├── ARCHITECTURE.md              # 이 파일
├── docker-compose.yml           # ingest-server + ingest-worker
├── next.config.mjs              # staleTimes.dynamic=0 설정
├── railway.json                 # Railway 배포 설정
├── tailwind.config.ts
├── tsconfig.json
├── vitest.config.ts
├── editor-demo.html             # 스탠드얼론 UI 데모 (서버 불필요)
│
├── app/                         # Next.js App Router
│   ├── layout.tsx
│   ├── page.tsx                 # / → /projects 리다이렉트
│   │
│   ├── projects/                # Curator & 프로젝트 목록
│   │   ├── page.tsx
│   │   ├── CuratorBoard.tsx     # 곡 추천 + Import Video UI
│   │   ├── ProjectList.tsx
│   │   ├── new/page.tsx
│   │   └── [id]/page.tsx
│   │
│   ├── editor/[id]/             # 클립 편집기
│   │   ├── page.tsx
│   │   └── EditorClient.tsx
│   │
│   ├── history/                 # 렌더 결과 히스토리
│   │   ├── page.tsx
│   │   └── HistoryPanel.tsx
│   │
│   ├── export/                  # Export 페이지
│   │   ├── page.tsx
│   │   └── ExportList.tsx
│   │
│   └── api/
│       ├── import/
│       │   ├── route.ts         # POST: import_status='pending' 설정
│       │   └── status/route.ts  # GET: import 상태 조회
│       ├── render/
│       │   ├── route.ts         # POST: render_status='pending' 설정
│       │   ├── status/route.ts  # GET: 렌더 상태 조회
│       │   └── cancel/route.ts  # POST: 렌더 취소
│       ├── upload-bgm/route.ts  # POST: ingest-server로 프록시
│       ├── clips/[id]/route.ts  # PATCH/DELETE: 클립 수정/삭제
│       ├── comments/fetch/route.ts  # POST: YouTube 댓글 fetch
│       ├── projects/
│       │   ├── route.ts         # GET/POST: 프로젝트 목록/생성
│       │   └── [id]/route.ts    # PATCH/DELETE: 프로젝트 수정/삭제
│       ├── curator/
│       │   ├── generate-base/route.ts   # Claude로 소개 문구 생성
│       │   ├── recommend/route.ts       # 곡 추천
│       │   ├── pick/route.ts            # 추천곡 선택
│       │   ├── add-manual/route.ts      # 수동 곡 추가
│       │   ├── tone-presets/route.ts    # 톤 프리셋 관리
│       │   └── transform-tone/route.ts  # 톤 변환
│       ├── health/route.ts
│       └── debug/route.ts
│
├── components/
│   ├── audio/BgmEditor.tsx       # BGM 업로드 + 볼륨/시작점 설정
│   ├── video-editor/
│   │   ├── ClipEditor.tsx        # 클립 편집 메인 (자막/코멘트/BGM/스타일)
│   │   ├── VideoPreview.tsx      # 원본 영상 미리보기
│   │   └── WaveformEditor.tsx    # WaveSurfer 파형 + 클립 구간 선택
│   ├── subtitle-editor/
│   │   └── SubtitleEditor.tsx    # 자막 타임코드 편집 (tap-to-sync)
│   ├── comment-card/
│   │   └── CommentCard.tsx       # 댓글 카드 UI
│   ├── template-picker/
│   │   └── TemplatePicker.tsx    # LayoutA/B/C 선택
│   ├── preview/CanvasPreview.tsx  # Remotion Player 미리보기
│   └── dashboard/nav.tsx
│
├── remotion/
│   ├── Root.tsx                  # Remotion composition 루트
│   ├── types.ts                  # RenderInput, ClipInput, Segment, Comment 타입
│   └── compositions/
│       ├── LayoutA.tsx           # 자막 + 코멘트 레이아웃
│       ├── LayoutB.tsx           # 자막만 레이아웃
│       ├── LayoutC.tsx           # 코멘트만 레이아웃
│       └── layers/
│           ├── VideoLayer.tsx    # 영상 + BGM Audio
│           ├── SubtitleLayer.tsx # 자막 오버레이
│           └── CommentLayer.tsx  # 댓글 오버레이
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts             # 브라우저용 Supabase 클라이언트
│   │   ├── server.ts             # 서버용 Supabase 클라이언트
│   │   └── types.ts              # 자동 생성 DB 타입
│   ├── curator/
│   │   ├── memo.ts               # Claude로 소개 문구 생성
│   │   ├── recommend.ts          # 곡 추천 로직
│   │   ├── modulation.ts         # 톤 변환
│   │   ├── tone-prompt-builder.ts
│   │   ├── parse-yt.ts
│   │   └── youtube-search.ts    # YouTube Data API 검색
│   ├── llm/
│   │   ├── anthropic.ts          # Anthropic SDK 래퍼
│   │   └── types.ts
│   ├── rendering/
│   │   ├── local.ts              # Remotion 로컬 렌더 유틸
│   │   └── lambda.ts             # Lambda stub (미사용)
│   ├── youtube/
│   │   ├── metadata.ts           # YouTube 메타데이터 fetch
│   │   └── parser.ts
│   ├── utils/
│   │   ├── template.ts
│   │   ├── time.ts
│   │   └── worker.ts             # getIngestWorkerUrlWithFallback()
│   └── types.ts
│
├── workers/
│   ├── ingest/
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   ├── worker.py             # yt-dlp 다운로드 폴링 워커
│   │   ├── server.py             # BGM 업로드 FastAPI 서버 (port 8001)
│   │   └── docker-entrypoint.sh
│   └── render/
│       ├── worker.ts             # Remotion 렌더 폴링 워커
│       └── worker.mjs
│
├── supabase/migrations/          # 26개 순차 마이그레이션
│   ├── 20260423000000_init.sql
│   └── ... (아래 DB 스키마 섹션 참고)
│
├── __tests__/
│   ├── api/
│   │   ├── import.test.ts        # ⚠ mock 불일치로 실패 중
│   │   └── render.test.ts        # ⚠ 중복 처리 가드 실패 중
│   ├── lib/utils.test.ts
│   └── regression/bugs.test.ts
│
└── scripts/
    └── cleanup-orphan-storage.mjs  # Storage 고아 파일 정리
```

---

## 3. 데이터베이스 스키마

### 테이블 관계도

```
projects (1) ──── (N) clips (1) ──── (N) lyrics_segments
    │                  │
    │                  └────── (N) comments
    │
    └── (N) track_recommendations
    
tone_presets  (독립 테이블)
```

### 주요 테이블

#### `projects`
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid | PK |
| artist | text | 아티스트명 |
| song_title | text | 곡명 |
| source_url | text | YouTube URL |
| import_status | text | `null` / `pending` / `processing` / `success` / `failed` |
| import_error | text | 오류 메시지 |
| yt_video_id | text | YouTube 영상 ID |
| yt_title | text | YouTube 제목 |
| yt_duration_sec | int | 영상 길이 (초) |
| yt_thumbnail_url | text | 썸네일 URL |
| yt_source_path | text | Storage 경로 (`preview/{id}.mp4`) |
| description_base | text | Claude 생성 소개 문구 |
| song_lyrics | text | 전체 가사 |
| created_at | timestamptz | |

#### `clips`
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid | PK |
| project_id | uuid | FK → projects |
| start_sec | float | 클립 시작 (초) |
| end_sec | float | 클립 종료 (초) |
| label | text | 클립 라벨 (메모) |
| template_id | text | `LAYOUT_A` / `LAYOUT_B` / `LAYOUT_C` |
| bgm_url | text | BGM Storage signed URL |
| bgm_volume | float | BGM 볼륨 (0~1, default 0.3) |
| bgm_start_sec | float | BGM 시작 오프셋 (초) |
| original_volume | float | 원본 영상 볼륨 (0~1, default 1.0) |
| subtitle_style | jsonb | `SubtitleStyle` 객체 |
| comment_style | jsonb | `CommentStyle` 객체 |
| render_status | text | `null` / `pending` / `processing` / `success` / `failed` |
| render_preset | text | `fast` / `balanced` / `quality` |
| render_path | text | Storage 경로 (`renders/...mp4`) |
| render_progress | int | 0~100 |
| render_error | text | 오류 메시지 |

#### `lyrics_segments`
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid | PK |
| clip_id | uuid | FK → clips |
| text | text | 자막 텍스트 |
| start_sec | float | 자막 시작 (초) |
| end_sec | float | 자막 종료 (초) |
| order | int | 정렬 순서 |

#### `comments`
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid | PK |
| clip_id | uuid | FK → clips |
| username | text | YouTube 댓글 작성자 |
| body | text | 댓글 내용 |
| likes_count | int | 좋아요 수 |
| is_selected | bool | 렌더에 사용 여부 |
| source | text | `youtube` 등 출처 |

#### `track_recommendations`
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid | PK |
| artist | text | |
| song_title | text | |
| yt_title | text | YouTube 제목 |
| yt_url | text | |
| used_project_id | uuid | FK → projects `ON DELETE SET NULL` |

#### `tone_presets`
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid | PK |
| name | text | 프리셋 이름 |
| (tone 관련 키들) | text | 큐레이터 톤 설정값 |

### Supabase Storage 버킷

| 버킷명 | 용도 | 경로 패턴 |
|--------|------|-----------|
| `sources` | 원본 영상 mp4, BGM 파일 | `preview/{video_id}.mp4`, `bgm/{clip_id}.mp3` |
| `renders` | 렌더 결과 mp4 | `renders/{project_id}/{clip_id}-{preset}.mp4` |

> **주의**: 버킷은 자동 생성되지 않음. Supabase 콘솔에서 수동 생성 필요.

### 마이그레이션 히스토리 (26개)

```
20260423000000  init                        초기 스키마
20260423100000  clips_transcribe_status     (현재 미사용 — whisperX 제거됨)
20260423200000  phase3_comments_source_clips_template
20260423300000  phase4_clips_render_columns render_status, render_path, render_error
20260423400000  import_status_processing    processing 상태 추가
20260425000000  clips_audio_mixing          bgm_url, bgm_volume, original_volume
20260425100000  projects_song_lyrics
20260425200000  clips_label
20260425300000  lyrics_segments_order
20260426100000  clips_subtitle_style        JSONB 스타일 컬럼
20260426200000  comments_is_selected
20260426300000  clips_render_progress       render_progress 0~100
20260427000000  db_constraints_indexes      FK 제약 + 인덱스
20260427100000  fix_clip_status_defaults
20260427200000  clips_comment_style
20260428000000  project_lyrics_timestamps
20260429000000  reset_stale_failed_imports
20260501000000  add_hq_source_path          (현재 미사용 — 단일 소스 전략)
20260502000000  add_render_preset
20260502000001  add_bgm_start_sec
20260503000000  create_track_recommendations
20260503000001  create_tone_presets
20260503000002  add_curator_columns_to_projects
20260503000003  rename_tone_preset_keys
20260503000004  fix_track_recommendations_fk  ON DELETE SET NULL
20260503000005  add_yt_title_to_recommendations
```

---

## 4. 워크플로우 상세

### 전체 흐름

```
[Curator] → [Import] → [Editor] → [Render] → [History/Export]
```

---

### Step 1: Curator (곡 선택)

```
사용자 입력 (아티스트/곡명)
    │
    ├── /api/curator/recommend   → Claude + YouTube API로 영상 추천
    ├── /api/curator/generate-base → Claude로 소개 문구(description) 생성
    ├── /api/curator/pick        → 선택한 영상 → track_recommendations 저장
    └── /api/projects (POST)     → projects 레코드 생성
```

**관련 파일**: `app/projects/CuratorBoard.tsx`, `lib/curator/`

---

### Step 2: Import Video (영상 다운로드)

```
UI "Import Video" 클릭
    │
    ▼
POST /api/import
    │  projects.import_status = 'pending'
    │  (상태만 기록, 실제 처리 안 함)
    ▼
[Mac Studio] ingest-worker (Docker)
    │  Supabase 3초 폴링 → import_status='pending' 발견
    │
    ├── 1. projects.import_status = 'processing' (원자적 업데이트)
    ├── 2. yt-dlp --dump-json (메타데이터 fetch)
    │       ├── 실패 시 player_client 재시도 체인:
    │       │   ios,web → web (봇감지) → tv_embedded (연령제한)
    │       └── 쿠키 사용: /app/cookies.txt 마운트 시 자동 적용
    ├── 3. yt-dlp 다운로드 (1080p mp4, ffmpeg merge)
    ├── 4. Supabase Storage 업로드 → sources/preview/{video_id}.mp4
    └── 5. projects 업데이트:
            import_status = 'success'
            yt_video_id, yt_title, yt_duration_sec,
            yt_thumbnail_url, yt_source_path
```

**관련 파일**: `workers/ingest/worker.py`, `app/api/import/route.ts`

---

### Step 3: Editor (클립 편집)

```
/editor/{project_id} 접속
    │
    ├── WaveformEditor  → 구간 드래그 → clips 레코드 생성
    │
    └── ClipEditor (탭별 편집)
        ├── [자막] SubtitleEditor
        │       tap-to-sync 또는 수동 타임코드 입력
        │       → lyrics_segments 저장
        │
        ├── [코멘트] CommentCard
        │       /api/comments/fetch → YouTube API 댓글 fetch
        │       → comments 저장, is_selected 토글
        │
        ├── [BGM] BgmEditor
        │       파일 업로드 → /api/upload-bgm
        │           → ingest-server (port 8001) 프록시
        │           → sources/bgm/{clip_id}.mp3 저장
        │           → signed URL 반환
        │       볼륨/시작점 설정 → clips.bgm_* 컬럼 저장
        │
        ├── [스타일] TemplatePicker
        │       LayoutA/B/C 선택 → clips.template_id
        │       subtitle_style, comment_style (JSON) 저장
        │
        └── [미리보기] CanvasPreview
                Remotion Player (브라우저 실시간)
                inputProps = { clip, layout, segments, comments }
```

**관련 파일**: `components/video-editor/ClipEditor.tsx`, `components/audio/BgmEditor.tsx`

---

### Step 4: Render (영상 렌더)

```
UI "렌더" 버튼 클릭
    │
    ▼
POST /api/render { clip_id, preset }
    │  clips.render_status = 'pending'
    │  clips.render_preset = 'fast' | 'balanced' | 'quality'
    │  (상태만 기록, 실제 처리 안 함)
    ▼
[Mac Studio] render-worker (Node.js tsx)
    │  Supabase 3초 폴링 → render_status='pending' 발견
    │
    ├── 1. clips.render_status = 'processing'
    ├── 2. 관련 데이터 로드 (segments, comments, project)
    ├── 3. Remotion 번들 생성 (최초 1회, ~30초)
    ├── 4. renderMedia() 호출
    │       preset별 ffmpeg 옵션:
    │       - fast:     H.264 하드웨어, 8M bitrate, concurrency 12
    │       - balanced: libx264, crf=12, concurrency 8
    │       - quality:  libx264, crf=10, concurrency 6
    │       렌더 진행률 5% 단위로 DB 업데이트
    ├── 5. mp4 → Supabase Storage 업로드 → renders/...mp4
    └── 6. clips 업데이트:
            render_status = 'success'
            render_path = 'renders/...'
            render_progress = 100
```

**타임아웃**: 15분  
**관련 파일**: `workers/render/worker.ts`, `remotion/compositions/`

---

### Step 5: History / Export

```
/history 접속
    │
    ├── 렌더 완료 클립 목록 (render_status IS NOT NULL)
    │   └── 3초 폴링: pending/processing 클립 상태 자동 갱신
    │
    ├── "열기" → Storage signed URL 생성 → 브라우저에서 mp4 재생
    └── "다운로드" → mp4 직접 다운로드
```

---

## 5. API 엔드포인트 목록

| Method | Path | 동작 |
|--------|------|------|
| POST | `/api/import` | import_status='pending' 설정 |
| GET | `/api/import/status` | import 상태 조회 |
| POST | `/api/render` | render_status='pending' 설정 |
| GET | `/api/render/status` | 렌더 상태 조회 |
| POST | `/api/render/cancel` | 렌더 취소 |
| POST | `/api/upload-bgm` | ingest-server로 프록시 |
| POST | `/api/comments/fetch` | YouTube 댓글 fetch |
| GET/POST | `/api/projects` | 프로젝트 목록/생성 |
| PATCH/DELETE | `/api/projects/[id]` | 프로젝트 수정/삭제 |
| PATCH/DELETE | `/api/clips/[id]` | 클립 수정/삭제 |
| POST | `/api/curator/recommend` | Claude+YT 곡 추천 |
| POST | `/api/curator/generate-base` | Claude 소개 문구 생성 |
| POST | `/api/curator/pick` | 추천곡 선택 |
| POST | `/api/curator/add-manual` | 수동 곡 추가 |
| GET/POST | `/api/curator/tone-presets` | 톤 프리셋 관리 |
| POST | `/api/curator/transform-tone` | 톤 변환 |
| GET | `/api/health` | 헬스체크 |

---

## 6. 데이터 상태 머신

### import_status

```
null ──→ pending ──→ processing ──→ success
                         │
                         └──────────→ failed
                         
[재시도] failed/success → pending (Import Video 재클릭)
[강제 초기화] processing → pending (worker 재시작 시 / 강제 재시도)
```

### render_status

```
null ──→ pending ──→ processing ──→ success
                         │
                         └──────────→ failed

[재렌더] any → pending (렌더 버튼 재클릭)
```

### 상태 전이 주체

| 상태 전이 | 주체 |
|-----------|------|
| `null → pending` | Next.js API (`/api/import`, `/api/render`) |
| `pending → processing` | Mac Studio 워커 (원자적) |
| `processing → success/failed` | Mac Studio 워커 |
| `processing → pending` | 워커 재시작 시 startup reset |

---

## 7. 알려진 이슈 & 쟁점

### 🔴 운영 전 수정 필요

#### Issue 1: 렌더 중복 처리 가드 없음

**위치**: `app/api/render/route.ts`

**문제**: `/api/render`가 `render_status='processing'` 인 클립에도 무조건 `'pending'`으로 덮어쓰고 202를 반환함. 렌더 중 재클릭 시 워커가 이미 처리 중인 작업을 다시 시작할 수 있음.

```typescript
// 현재 코드 (가드 없음)
await supabase.from('clips')
  .update({ render_status: 'pending', ... })
  .eq('id', clip_id)  // 상태 체크 없음
```

**기대 동작**: `render_status='processing'` 이면 409 반환.  
**테스트 상태**: `__tests__/api/render.test.ts` 실패 중.

---

#### Issue 2: Import 강제 리셋 레이스 컨디션

**위치**: `app/api/import/route.ts`

**문제**: `import_status='processing'` 인 프로젝트에 재시도 시, 강제 리셋으로 `'pending'` 으로 되돌림. 워커가 다운로드 중이면 두 작업이 동시에 진행될 수 있음.

```typescript
// 워커 처리 중 → 강제 리셋 → worker A는 계속 다운로드 중
// → 새 worker B가 같은 프로젝트를 다시 픽업
```

단일 사용자 환경 + 단일 워커 인스턴스이므로 실용적 위험은 낮으나, 구조적으로 안전하지 않음.

---

### 🟡 운영 주의 사항

#### Issue 3: Docker 이미지 캐시 — 코드 변경이 자동 반영되지 않음

**문제**: `worker.py` 또는 `server.py`를 수정하고 `git push` 해도, Mac Studio에서 `git pull` 후 `docker compose build --no-cache` 를 하지 않으면 컨테이너는 구 코드를 계속 실행함.

**증상**: 코드를 수정했는데 traceback의 라인 번호가 다름.

**필수 절차**:
```bash
git pull origin <branch>
docker compose build --no-cache ingest-worker
docker compose up -d ingest-worker
```

---

#### Issue 4: yt-dlp YouTube 봇 감지

**문제**: Docker 컨테이너의 IP가 YouTube 봇 감지에 걸려 다운로드 실패.

**현재 대응 체인**:
```
yt-dlp (ios,web)
    → 실패 + "Sign in"/"PO Token" → 재시도 (web)
    → 실패 + "age-restricted"     → 재시도 (tv_embedded)
    → 실패                         → 에러 분류 후 DB 저장
```

**쿠키 대응**:
```bash
yt-dlp --cookies-from-browser chrome \
       --cookies workers/ingest/cookies.txt <any-yt-url>
docker compose up -d ingest-worker  # 볼륨 마운트로 자동 적용
```

**yt-dlp 이미지 갱신**:
```bash
docker compose build --no-cache ingest-worker
```

---

#### Issue 5: Supabase HTTP/2 ConnectionTerminated

**문제**: Python Supabase 클라이언트의 HTTP/2 연결이 장시간 후 끊어짐. 과거에는 startup reset이 try/except 밖에 있어 프로세스 크래시 유발.

**현재 대응**: 3회 연속 폴링 오류 시 클라이언트 재생성, startup reset도 3회 재시도 루프로 보호.

```python
# POLL ERR 로그가 뜨면 정상 동작 (재생성 처리됨)
[POLL ERR] <ConnectionTerminated ...>
[POLL] recreating Supabase client after repeated errors
```

---

#### Issue 6: BGM 업로드 — ingest-server 미실행 시 503

**문제**: BGM 업로드는 `localhost:8001`로 직접 HTTP 프록시. `ingest-server` Docker 서비스가 미실행이면 즉시 503.

**확인**:
```bash
docker compose ps  # ingest-server running 여부 확인
docker compose up -d ingest-server
```

Railway 배포 환경에서는 `INGEST_WORKER_URL` 환경변수로 Mac Studio 포트를 외부 노출해야 함.

---

#### Issue 7: _cookies_args() 로그 중복 출력

**위치**: `workers/ingest/worker.py`

**문제**: `_cookies_args()` 가 잡당 2회 호출(메타데이터 + 다운로드)되어 `[cookies] using /app/cookies.txt` 가 2회 출력됨. 기능 영향 없으나 로그 노이즈.

**개선 방향**: 워커 시작 시 1회만 출력하도록 이동.

---

### 🟠 테스트 실패 중

#### Issue 8: render.test.ts — 중복 처리 가드

```
__tests__/api/render.test.ts
→ render_status='processing' 클립에 202 반환 (기대: 409)
```

Issue 1과 연동 — 가드 추가 시 함께 해결.

#### Issue 9: import.test.ts — mock 불일치

```
__tests__/api/import.test.ts
→ mock이 .select().eq().single() 체인 미지원
```

실제 코드 버그 아님. mock만 갱신하면 해결.

---

### 🔵 설계 부채 / 미정리 항목

#### Issue 10: hq_source_path 컬럼 (미사용)

`20260501000000_add_hq_source_path.sql` 에서 `projects.hq_source_path` 컬럼이 추가됐으나, Phase 4 설계 단순화로 단일 소스 전략을 채택 — 현재 코드에서 사용하지 않음. 컬럼 삭제 또는 문서화 필요.

#### Issue 11: transcribe_status 컬럼 (미사용)

`clips.transcribe_status` — whisperX 제거 이후 미사용. DB에 컬럼은 존재.

#### Issue 12: Remotion Lambda stub (미사용)

`lib/rendering/lambda.ts` — Phase 4 설계에 있던 Remotion Lambda 연동 코드. 현재 로컬 렌더만 사용. 제거 또는 유지 정책 결정 필요.

---

## 8. 인프라 & 배포

### 환경별 실행 위치

| 컴포넌트 | 실행 위치 | 방법 |
|----------|-----------|------|
| Next.js 앱 | Railway | `railway.json` 기준 자동 배포 |
| Supabase | Supabase Cloud | DB + Storage |
| ingest-server | Mac Studio | `docker compose up -d ingest-server` |
| ingest-worker | Mac Studio | `docker compose up -d ingest-worker` |
| render-worker | Mac Studio | `npm run render-worker` |

### 필수 환경변수

```bash
# Next.js (Railway + 로컬)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
ANTHROPIC_API_KEY=
YOUTUBE_API_KEY=

# render-worker 권장
SUPABASE_SERVICE_ROLE_KEY=

# Railway → Mac BGM 업로드 시 필요 (로컬 불필요)
INGEST_WORKER_URL=http://<mac-public-ip>:8001
```

### Docker 운영 명령

```bash
# 전체 시작
docker compose up -d

# 개별
docker compose up -d ingest-server   # BGM 서버
docker compose up -d ingest-worker   # YT 다운로드 워커

# 코드 변경 후 필수 재빌드
git pull origin <branch>
docker compose build --no-cache ingest-worker
docker compose up -d ingest-worker

# 로그 확인
docker compose logs -f ingest-worker
docker compose logs -f ingest-server
```

### render-worker 운영

```bash
nvm use 20
npm run render-worker
# 최초 Remotion 번들링 ~30초 소요
# 이후 3초 폴링 시작
```

### Supabase 수동 확인 항목

- [ ] `sources` 버킷 존재 여부 (콘솔에서 수동 생성)
- [ ] `renders` 버킷 존재 여부 (콘솔에서 수동 생성)
- [ ] RLS 비활성화 (단일 사용자 로컬 개발)
- [ ] 마이그레이션 26개 모두 적용

---

*이 문서는 실제 코드 기준으로 작성됨. 코드 변경 시 함께 업데이트 권장.*
