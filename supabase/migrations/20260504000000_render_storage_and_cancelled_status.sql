-- Keep render queue/storage assumptions aligned with the current app code.

insert into storage.buckets (id, name, public)
values ('renders', 'renders', false)
on conflict (id) do nothing;

ALTER TABLE clips DROP CONSTRAINT IF EXISTS clips_render_status_check;
ALTER TABLE clips ADD CONSTRAINT clips_render_status_check
  CHECK (render_status IS NULL OR render_status IN ('pending','processing','success','failed','cancelled'));
