ALTER TABLE comments ADD COLUMN source text default 'manual';
ALTER TABLE clips ADD COLUMN template_id uuid references templates(id);

INSERT INTO templates (name, config_json) VALUES
  ('subtitle_comment', '{"layout": "LAYOUT_A"}'),
  ('subtitle_only',    '{"layout": "LAYOUT_B"}'),
  ('comment_only',     '{"layout": "LAYOUT_C"}');
