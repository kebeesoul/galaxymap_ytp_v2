# galaxymap_ytp_v2 — Project Spec

Phase 1 구현 설계서. CLAUDE.md의 규칙 안에서 동작.

---

## Folder Structure

app/
  projects/
    page.tsx              (project list)
    new/
      page.tsx            (create project form)
    [id]/
      page.tsx            (project detail)
  editor/
    [id]/
      page.tsx            (main editor)
  api/
    import/
      route.ts            (trigger yt-dlp worker)
components/
  video-editor/
    ClipEditor.tsx
    VideoPreview.tsx
  subtitle-editor/        (empty — Phase 2)
  comment-card/           (empty — Phase 3)
  template-picker/        (empty — Phase 3)
lib/
  youtube/
    parser.ts
    metadata.ts
  supabase/
    client.ts
    server.ts
  rendering/
    local.ts              (stub — Phase 4)
    lambda.ts             (stub — Phase 4)
workers/
  ingest/
    server.py
    requirements.txt
    Dockerfile
  whisper/
    README.md             (scaffold only — Phase 2)
render-queue/
  worker.ts               (stub — Phase 4)
remotion/
  compositions/
    layers/               (empty stubs — Phase 4)

---

## Dependencies

@supabase/supabase-js
@supabase/ssr
react-player
axios

---

## Supabase

### Storage Buckets
- `sources` (private)
  - `preview/` — 저화질 mp4 (Phase 1~3)
  - `render/` — 고화질 mp4+m4a (Phase 4)

### Migration

```sql
create table projects (
  id                  uuid primary key default gen_random_uuid(),
  artist              text not null,
  song_title          text not null,
  source_url          text not null,
  ip_owner            boolean not null default false,
  ip_confirmed_at     timestamptz,
  yt_video_id         text,
  yt_title            text,
  yt_duration_sec     integer,
  yt_thumbnail_url    text,
  yt_source_path      text,       -- Storage path: sources/preview/[id].mp4
  import_status       text,       -- pending | success | failed
  import_error        text,
  created_at          timestamptz default now()
);

create table clips (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references projects(id) on delete cascade,
  start_sec   numeric not null,
  end_sec     numeric not null,
  created_at  timestamptz default now(),
  constraint clip_range_valid check (end_sec > start_sec and start_sec >= 0)
);

create table lyrics_segments (
  id        uuid primary key default gen_random_uuid(),
  clip_id   uuid references clips(id) on delete cascade,
  text      text not null,
  start_sec numeric not null,
  end_sec   numeric not null
);

create table comments (
  id          uuid primary key default gen_random_uuid(),
  clip_id     uuid references clips(id) on delete cascade,
  username    text not null,
  body        text not null,
  likes_count integer default 0
);

create table templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  config_json jsonb not null
);
```

---

## Python Worker — workers/ingest/server.py

FastAPI, localhost:8001

POST /ingest { url: string }

1. URL에서 video_id 추출
2. yt-dlp로 메타데이터 수집 (title, duration, thumbnail)
3. yt-dlp `worst[ext=mp4]` 다운로드 → Supabase Storage `sources/preview/[project_id].mp4` 업로드
4. 반환:
   { video_id, title, duration_sec, thumbnail_url, preview_path }

에러 처리:
- 403 / age-restricted / region-locked → { error: "yt_dlp_failed", message: "..." }
- 타임아웃: 60초
- 워커 다운 → API route 503 반환

---

## API Route — app/api/import/route.ts

POST /api/import { project_id, url }

1. import_status = 'pending' 업데이트
2. localhost:8001/ingest 호출
3. 성공: yt_* 필드 + yt_source_path + import_status = 'success'
4. 실패: import_status = 'failed' + import_error
5. 업데이트된 project row 반환

---

## UI Flow

/projects
- 전체 프로젝트 목록 + 새 프로젝트 링크

/projects/new
- Form: artist, song_title, source_url, ip_owner checkbox
- Submit → projects row 생성 → /editor/[id] redirect

/editor/[id]
- Import 버튼 → POST /api/import
- 3상태: pending(로딩) / success(썸네일+타이틀+duration) / failed(에러)
- ClipEditor: <video> 태그 + scrubber + Mark In(I) / Mark Out(O) 단축키 + save
- VideoPreview: react-player fallback (preview 없을 때 YouTube embed)

---

## Stop Condition — Phase 1

- [x] 프로젝트 생성
- [x] yt-dlp 워커 → 메타데이터 + 저화질 mp4 → Supabase Storage 저장
- [x] 썸네일 / 타이틀 / duration 에디터 표시
- [x] import_status 3상태 UI
- [x] <video> scrubber로 clip start/end 마킹 → clips 테이블 저장
- [x] 렌더 / 가사 / 템플릿 없음

---

## Phase 2 — Whisper 자막 추출 + 편집

### 실행 환경
- Replicate API: `vaibhavs10/incredibly-fast-whisper`
- 트리거: 에디터 내 "자막 추출" 버튼 1회 클릭
- 결과: lyrics_segments 테이블 자동 저장

### API Route — app/api/transcribe/route.ts

POST /api/transcribe { clip_id: string }

1. clips 테이블에서 start_sec / end_sec 조회
2. Supabase Storage에서 preview mp4 signed URL 생성
3. Replicate API 호출:
   - model: vaibhavs10/incredibly-fast-whisper
   - input: { audio: signed_url, language: "korean", word_timestamps: true }
4. 결과 파싱 → lyrics_segments 테이블 insert
   (word 단위 segments: text, start_sec, end_sec)
5. 저장된 segments 반환

에러 처리:
- Replicate timeout (60초) → transcribe_status = 'failed'
- clips 테이블에 transcribe_status 컬럼 추가 (pending | success | failed)

### DB 추가

```sql
ALTER TABLE clips ADD COLUMN transcribe_status text;
```

### 자막 편집 UX — SubtitleEditor.tsx

구조:
- 세그먼트 목록을 텍스트 에디터로 표시
- 텍스트 직접 수정 시 → 해당 segment text 업데이트
- 줄바꿈(Enter) → segment 분리, 타임스탬프 균등 재계산
- 세그먼트 병합(Backspace at start) → 앞 segment와 합치고 타임스탬프 합산
- 저장 버튼 → lyrics_segments 테이블 upsert

### /editor/[id] 변경

ClipEditor에 "자막 추출" 버튼 추가:
- clip 저장 완료 후 활성화
- 클릭 → POST /api/transcribe
- transcribe_status 3상태: pending(스피너) / success(SubtitleEditor 표시) / failed(에러)

### Stop Condition — Phase 2

- [ ] "자막 추출" 버튼 → Replicate API 호출
- [ ] 결과 lyrics_segments 테이블 저장
- [ ] SubtitleEditor에서 텍스트 직접 편집 가능
- [ ] 줄바꿈/병합 시 타임스탬프 자동 재계산
- [ ] 저장 → DB upsert 반영

---

## Phase 3 — Comment Card + Template Picker

### Comment Card — 댓글 수집 + 편집

#### DB 추가
comments 테이블 기존 스키마 사용 (clip_id, username, body, likes_count)
comments 테이블에 source 컬럼 추가:
```sql
ALTER TABLE comments ADD COLUMN source text default 'manual';
-- 'youtube' | 'manual'
```

#### API Route — app/api/comments/fetch/route.ts
POST /api/comments/fetch { clip_id, video_id }

1. YouTube Data API v3 commentThreads.list 호출
   - videoId: video_id
   - maxResults: 20
   - order: relevance
2. 결과 파싱 → comments 테이블 insert (source = 'youtube')
3. 저장된 comments 반환

env 추가: YOUTUBE_API_KEY

#### UI — CommentCard.tsx
- clip별 댓글 목록 표시
- "YouTube 댓글 불러오기" 버튼 → POST /api/comments/fetch
- 각 댓글: username / body / likes_count 인라인 편집 가능
- 댓글 추가 버튼 → 빈 row insert (source = 'manual')
- 댓글 삭제 버튼
- 저장 → comments upsert

---

### Template Picker — 프리셋 고정

#### 프리셋 3종 (하드코딩)
- LAYOUT_A: 자막 + 댓글 (상단 자막 / 하단 댓글 카드)
- LAYOUT_B: 자막만
- LAYOUT_C: 댓글만

#### DB
templates 테이블에 프리셋 3개 seed insert:
```sql
INSERT INTO templates (name, config_json) VALUES
  ('subtitle_comment', '{"layout": "LAYOUT_A"}'),
  ('subtitle_only',    '{"layout": "LAYOUT_B"}'),
  ('comment_only',     '{"layout": "LAYOUT_C"}');

ALTER TABLE clips ADD COLUMN template_id uuid references templates(id);
```

#### UI — TemplatePicker.tsx
- 프리셋 3개 카드 표시 (아이콘 + 레이블)
- 선택 시 clips.template_id 업데이트

---

### /editor/[id] 변경
- SubtitleEditor 아래 CommentCard 추가
- CommentCard 아래 TemplatePicker 추가

---

### Stop Condition — Phase 3
- [ ] YouTube 댓글 자동 수집 → comments 테이블 저장
- [ ] 댓글 인라인 편집 / 추가 / 삭제 / 저장
- [ ] 프리셋 3종 선택 UI
- [ ] 선택한 template_id clips 테이블 저장