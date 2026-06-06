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

---

## Phase 4 — Remotion 렌더

### 렌더 전략
- DEV/PROD 모두 local Mac Studio worker
- Lambda 전환 없음 (daily volume < 100 clips)
- Next.js → render-queue → Remotion CLI 순서로 실행

### Remotion Composition

#### 입력 데이터 구조
```ts
type RenderInput = {
  clip: { start_sec: number; end_sec: number }
  layout: 'LAYOUT_A' | 'LAYOUT_B' | 'LAYOUT_C'
  segments: { text: string; start_sec: number; end_sec: number }[]
  comments: { username: string; body: string; likes_count: number }[]
  preview_path: string  // Supabase Storage signed URL
}
```

#### Composition 3종 (remotion/compositions/)
- LayoutA.tsx — 상단 자막 + 하단 댓글 카드
- LayoutB.tsx — 자막만
- LayoutC.tsx — 댓글만

#### 공통 레이어 (remotion/compositions/layers/)
- SubtitleLayer.tsx — segments 타임스탬프 기반 자막 렌더
- CommentLayer.tsx — comments 카드 렌더
- VideoLayer.tsx — preview mp4 재생 (배경)

---

### render-queue/worker.ts

- Next.js API route로부터 render job 수신
- Remotion CLI 실행:
  `npx remotion render <composition> --props='...' --output=out/[clip_id].mp4`
- 완료 후 Supabase Storage `renders/[clip_id].mp4` 업로드
- clips 테이블 render_status 업데이트

---

### DB 추가

```sql
ALTER TABLE clips ADD COLUMN render_status text;
-- pending | success | failed
ALTER TABLE clips ADD COLUMN render_path text;
-- Supabase Storage path: renders/[clip_id].mp4
ALTER TABLE clips ADD COLUMN render_error text;
```

### Storage 버킷 추가
- `renders` (private) — 완성된 mp4 저장

---

### API Route — app/api/render/route.ts

POST /api/render { clip_id }

<<<<<<< Updated upstream
1. clips + segments + comments + template 조회
2. render_status = 'pending' 업데이트
3. render-queue/worker.ts에 job 전달
4. 완료 시: render_status = 'success' + render_path 업데이트
5. 실패 시: render_status = 'failed' + render_error 업데이트
=======
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
- `2026-06-03` — **로컬 = 휘발성 캐시(B안)** : R2가 진실의 원본, 로컬은 lazy-fill 캐시. yt-dlp·Remotion은 로컬 처리가 물리적으로 필수(R2 직접 처리 불가)이므로 로컬을 “통과 스크래치+캐시”로 둔다. import 원본은 즉시 삭제 안 하고 캐시 보존(다중 클립 렌더·프리뷰 재사용). cleanup은 TTL+용량상한 LRU.
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
- `2026-06-06` — **ESLint 비대화형 고정** : Next.js 14·ESLint 8 legacy 설정인 `.eslintrc.json`에서 `next/core-web-vitals` 표준 preset만 사용한다.
- `2026-06-06` — **렌더 중복 가드 복구** : `/api/render`는 `render_status is null or != processing`인 행만 원자적으로 pending 전환하고, 이미 processing이면 409를 반환한다. stale processing 복구는 Mac 워커 시작 로직이 담당한다.
>>>>>>> Stashed changes

---

### /editor/[id] 변경
- TemplatePicker 아래 "렌더 시작" 버튼 추가
- render_status 3상태: pending(스피너) / success(다운로드 링크) / failed(에러)

---

### Stop Condition — Phase 4
- [ ] Remotion composition 3종 (LayoutA/B/C) 구현
- [ ] SubtitleLayer 타임스탬프 기반 자막 동작
- [ ] CommentLayer 카드 렌더 동작
- [ ] render-queue worker → Remotion CLI 실행 → mp4 출력
- [ ] 출력 mp4 Supabase Storage renders/ 업로드
- [ ] render_status 3상태 UI
- [ ] 완료 후 다운로드 링크 표시