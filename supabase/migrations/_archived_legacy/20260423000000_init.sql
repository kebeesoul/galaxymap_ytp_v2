-- Phase 1 initial schema for galaxymap_ytp_v2

create table projects (
  id                uuid primary key default gen_random_uuid(),
  artist            text not null,
  song_title        text not null,
  source_url        text not null,
  ip_owner          boolean not null default false,
  ip_confirmed_at   timestamptz,
  yt_video_id       text,
  yt_title          text,
  yt_duration_sec   integer,
  yt_thumbnail_url  text,
  yt_source_path    text,
  import_status     text check (import_status in ('pending', 'success', 'failed')),
  import_error      text,
  created_at        timestamptz default now()
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

-- RLS disabled (single-user local dev)
alter table projects       disable row level security;
alter table clips          disable row level security;
alter table lyrics_segments disable row level security;
alter table comments       disable row level security;
alter table templates      disable row level security;

-- Storage bucket for video files (private)
insert into storage.buckets (id, name, public)
values ('sources', 'sources', false)
on conflict (id) do nothing;
