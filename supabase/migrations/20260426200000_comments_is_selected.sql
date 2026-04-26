alter table comments
  add column if not exists is_selected boolean not null default false;
