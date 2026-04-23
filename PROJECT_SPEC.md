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

- [ ] 프로젝트 생성
- [ ] yt-dlp 워커 → 메타데이터 + 저화질 mp4 → Supabase Storage 저장
- [ ] 썸네일 / 타이틀 / duration 에디터 표시
- [ ] import_status 3상태 UI
- [ ] <video> scrubber로 clip start/end 마킹 → clips 테이블 저장
- [ ] 렌더 / 가사 / 템플릿 없음