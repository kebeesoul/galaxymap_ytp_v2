ALTER TABLE clips
  ADD COLUMN IF NOT EXISTS render_preset TEXT
  DEFAULT 'balanced'
  CHECK (render_preset IN ('fast', 'balanced', 'quality'));
