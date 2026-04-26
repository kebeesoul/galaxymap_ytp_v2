-- Indexes for polling queries (render worker polls render_status every 5s)
CREATE INDEX IF NOT EXISTS idx_clips_render_status ON clips(render_status);
CREATE INDEX IF NOT EXISTS idx_clips_transcribe_status ON clips(transcribe_status);
CREATE INDEX IF NOT EXISTS idx_clips_project_id ON clips(project_id);
CREATE INDEX IF NOT EXISTS idx_lyrics_segments_clip_id_order ON lyrics_segments(clip_id, "order");
CREATE INDEX IF NOT EXISTS idx_comments_clip_id ON comments(clip_id);

-- CHECK constraints on status columns
ALTER TABLE clips ADD CONSTRAINT clips_render_status_check
  CHECK (render_status IS NULL OR render_status IN ('pending','processing','success','failed'));
ALTER TABLE clips ADD CONSTRAINT clips_transcribe_status_check
  CHECK (transcribe_status IS NULL OR transcribe_status IN ('pending','success','failed'));

-- DEFAULT values so new clips start in a known state
ALTER TABLE clips ALTER COLUMN render_status SET DEFAULT 'pending';
ALTER TABLE clips ALTER COLUMN transcribe_status SET DEFAULT 'pending';

-- template_id FK: SET NULL on template deletion so clip survives
ALTER TABLE clips DROP CONSTRAINT IF EXISTS clips_template_id_fkey;
ALTER TABLE clips ADD CONSTRAINT clips_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE SET NULL;
