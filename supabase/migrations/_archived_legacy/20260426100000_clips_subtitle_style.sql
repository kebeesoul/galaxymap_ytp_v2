alter table clips
  add column if not exists subtitle_style jsonb;
