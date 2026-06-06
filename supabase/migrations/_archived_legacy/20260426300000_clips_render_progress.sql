alter table clips
  add column if not exists render_progress numeric not null default 0;
