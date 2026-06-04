alter table lyrics_segments add column if not exists "order" integer not null default 0;

update lyrics_segments ls
set "order" = sub.rn
from (
  select id, (row_number() over (partition by clip_id order by start_sec) - 1) as rn
  from lyrics_segments
) sub
where ls.id = sub.id;
