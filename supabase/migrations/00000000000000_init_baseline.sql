-- =============================================================================
-- galaxymap_ytp_v2 — 클린 베이스라인 (Phase 2)
-- 기존 26개 마이그레이션을 대체하는 단일 init. 실측 스키마(2026-06-03) 기반.
-- 변경점: owner_uid 추가(projects/track_recommendations) + RLS 활성화
--         + 죽은 컬럼 제거(projects.yt_hq_source_path, clips.transcribe_status)
-- 데이터: projects/clips/lyrics_segments/comments/track_recommendations 폐기(A안, 현재 0~38행).
--         templates(3행)·tone_presets(3행)은 시드이므로 보존한다.
--
-- 적용 전략 — 두 경로:
--   [기존 운영 DB] 시드 2테이블(templates, tone_presets)은 DROP하지 말 것.
--     → 5개 테이블만 drop & 아래 정의로 재생성. 시드 2개는 §SEED의 ALTER만 적용(RLS 추가).
--   [새 환경/CI] 7테이블 전부 생성 후, templates는 아래 INSERT로 시드.
--     tone_presets는 기존 DB에서 정확히 복제(reference_text가 거대·핵심 자산이라 손으로 옮기지 않음):
--       pg_dump "$SUPABASE_DB_URL" --data-only --table=public.tone_presets > seed_tone_presets.sql
--
-- ⚠️ 적용 전 필수: 코드에서 yt_hq_source_path / transcribe_status 참조 제거.
-- ⚠️ 워커는 service_role 키 사용(RLS 우회). service_role은 .env에만.
-- 검증: 로컬 supabase 또는 별도 브랜치에서 먼저 적용·테스트 후 전환.
-- =============================================================================

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ============================ TABLES ============================

-- projects -------------------------------------------------------
create table public.projects (
  id                     uuid primary key default gen_random_uuid(),
  owner_uid              uuid not null references auth.users(id) on delete cascade,
  artist                 text not null,
  song_title             text not null,
  source_url             text not null,
  ip_owner               boolean not null default false,
  ip_confirmed_at        timestamptz,
  yt_video_id            text,
  yt_title               text,
  yt_duration_sec        integer,
  yt_thumbnail_url       text,
  yt_source_path         text,                 -- R2 key: {owner_uid}/sources/preview/{yt_video_id}.mp4
  import_status          text check (import_status in ('pending','processing','success','failed')),
  import_error           text,
  song_lyrics            text,
  song_lyrics_timestamps jsonb,
  description_base       text,
  description_styled     text,
  description_tone       text check (description_tone in ('ref_01','ref_02','ref_03')),
  created_at             timestamptz default now()
);

-- templates (전역 시드) ------------------------------------------
create table public.templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  config_json jsonb not null
);

-- clips ----------------------------------------------------------
create table public.clips (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid references public.projects(id) on delete cascade,
  template_id     uuid references public.templates(id),
  start_sec       numeric not null,
  end_sec         numeric not null,
  label           text,
  render_status   text check (render_status is null or render_status in ('pending','processing','success','failed','cancelled')),
  render_path     text,                         -- R2 key: {owner_uid}/renders/{project_id}/{clip_id}-{preset}.mp4
  render_error    text,
  render_preset   text default 'balanced' check (render_preset in ('fast','balanced','quality')),
  render_progress numeric default 0,
  bgm_url         text,                         -- R2 key: {owner_uid}/sources/bgm/{clip_id}.*
  bgm_volume      numeric default 0.3,
  bgm_start_sec   double precision default 0,
  original_volume numeric default 1.0,
  subtitle_style  jsonb,
  comment_style   jsonb,
  created_at      timestamptz default now()
);

-- lyrics_segments ------------------------------------------------
create table public.lyrics_segments (
  id        uuid primary key default gen_random_uuid(),
  clip_id   uuid references public.clips(id) on delete cascade,
  text      text not null,
  start_sec numeric not null,
  end_sec   numeric not null,
  "order"   integer not null default 0
);

-- comments -------------------------------------------------------
create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  clip_id     uuid references public.clips(id) on delete cascade,
  username    text not null,
  body        text not null,
  likes_count integer default 0,
  source      text default 'manual',
  is_selected boolean not null default false
);

-- track_recommendations -----------------------------------------
create table public.track_recommendations (
  id                  uuid primary key default gen_random_uuid(),
  owner_uid           uuid not null references auth.users(id) on delete cascade,
  batch_id            uuid not null,
  rank                smallint check (rank between 1 and 3),
  artist              text not null,
  song_title          text not null,
  release_year        integer,
  genre               text,
  reason              text,
  role                text check (role in ('popular','reliable','wildcard')),
  popularity_estimate smallint check (popularity_estimate between 1 and 10),
  topic               text,
  era                 text,
  genre_filter        text,
  yt_video_id         text,
  yt_title            text,
  yt_search_status    text default 'pending' check (yt_search_status in ('pending','found','not_found')),
  used                boolean default false,
  used_project_id     uuid references public.projects(id) on delete set null,
  created_at          timestamptz default now()
);

-- tone_presets (전역 시드) ---------------------------------------
create table public.tone_presets (
  id             uuid primary key default gen_random_uuid(),
  key            text not null unique check (key in ('ref_01','ref_02','ref_03')),
  label          text not null,
  description    text not null,
  reference_text text,
  is_active      boolean default true,
  updated_at     timestamptz default now()
);

-- ============================ INDEXES ===========================
create index idx_projects_owner          on public.projects(owner_uid);
create index idx_projects_import_status  on public.projects(import_status);
create index idx_clips_project           on public.clips(project_id);
create index idx_clips_render_status     on public.clips(render_status);
create index idx_lyrics_clip             on public.lyrics_segments(clip_id);
create index idx_comments_clip           on public.comments(clip_id);
create index idx_trackrec_owner          on public.track_recommendations(owner_uid);
create index idx_trackrec_batch          on public.track_recommendations(batch_id);

-- ============================ RLS ===============================
alter table public.projects              enable row level security;
alter table public.templates             enable row level security;
alter table public.clips                 enable row level security;
alter table public.lyrics_segments       enable row level security;
alter table public.comments              enable row level security;
alter table public.track_recommendations enable row level security;
alter table public.tone_presets          enable row level security;

-- 소유권 직접 보유: projects, track_recommendations
create policy projects_owner_all on public.projects
  for all to authenticated
  using (owner_uid = auth.uid())
  with check (owner_uid = auth.uid());

create policy trackrec_owner_all on public.track_recommendations
  for all to authenticated
  using (owner_uid = auth.uid())
  with check (owner_uid = auth.uid());

-- 소유권 상속: clips (via project)
create policy clips_via_project on public.clips
  for all to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = clips.project_id and p.owner_uid = auth.uid()))
  with check (exists (
    select 1 from public.projects p
    where p.id = clips.project_id and p.owner_uid = auth.uid()));

-- 소유권 상속: lyrics_segments (via clip → project)
create policy lyrics_via_clip on public.lyrics_segments
  for all to authenticated
  using (exists (
    select 1 from public.clips c
    join public.projects p on p.id = c.project_id
    where c.id = lyrics_segments.clip_id and p.owner_uid = auth.uid()))
  with check (exists (
    select 1 from public.clips c
    join public.projects p on p.id = c.project_id
    where c.id = lyrics_segments.clip_id and p.owner_uid = auth.uid()));

-- 소유권 상속: comments (via clip → project)
create policy comments_via_clip on public.comments
  for all to authenticated
  using (exists (
    select 1 from public.clips c
    join public.projects p on p.id = c.project_id
    where c.id = comments.clip_id and p.owner_uid = auth.uid()))
  with check (exists (
    select 1 from public.clips c
    join public.projects p on p.id = c.project_id
    where c.id = comments.clip_id and p.owner_uid = auth.uid()));

-- 전역 시드: 읽기만 허용 (쓰기는 service_role/대시보드로만)
create policy templates_read    on public.templates    for select to authenticated using (true);
create policy tonepresets_read  on public.tone_presets for select to authenticated using (true);

-- 참고: service_role 키는 RLS를 우회한다(Supabase 기본). ingest/render 워커는
--       service_role로 접속해 모든 사용자의 pending을 처리하되, project.owner_uid를
--       읽어 R2 키/캐시 키의 {uid}/ prefix에 반영한다.

-- ============================ SEED ==============================
-- templates: 시드 3행 (기존 id 유지). LAYOUT_A=자막+댓글 / B=자막만 / C=댓글만.
--   [새 환경] 아래 INSERT 실행. [기존 운영] 테이블 보존했으면 생략.
insert into public.templates (id, name, config_json) values
  ('979f61f4-b29e-4e21-b4ff-65dff9d796b5', 'subtitle_comment', '{"layout":"LAYOUT_A"}'::jsonb),
  ('ef87d580-0ae2-41ec-a21d-2d3a0469e03e', 'subtitle_only',    '{"layout":"LAYOUT_B"}'::jsonb),
  ('c9dc5577-63f5-4401-af13-e785374c62b9', 'comment_only',     '{"layout":"LAYOUT_C"}'::jsonb)
on conflict (id) do nothing;

-- tone_presets: reference_text가 매우 김(각 수천 자, 큐레이션 톤 학습 코퍼스).
--   손으로 옮기지 않는다(손상 위험). 기존 데이터 보존 또는 pg_dump 복제(상단 참조).
--   key/스타일: ref_01=diggingmusicplace_style / ref_02=walkietalkie_mag_style / ref_03=eateat.mag_style
