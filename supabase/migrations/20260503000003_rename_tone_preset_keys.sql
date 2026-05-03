-- Drop old CHECK constraints (auto-named by PostgreSQL)
ALTER TABLE tone_presets DROP CONSTRAINT IF EXISTS tone_presets_key_check;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_description_tone_check;

-- Update existing rows before adding new constraints
UPDATE tone_presets SET key = 'ref_01', label = 'ref_01' WHERE key = 'hushwav';
UPDATE tone_presets SET key = 'ref_02', label = 'ref_02' WHERE key = 'parkbeat';
UPDATE tone_presets SET key = 'ref_03', label = 'ref_03' WHERE key = 'archive';

-- Re-add CHECK constraints with new values
ALTER TABLE tone_presets
  ADD CONSTRAINT tone_presets_key_check CHECK (key IN ('ref_01', 'ref_02', 'ref_03'));

ALTER TABLE projects
  ADD CONSTRAINT projects_description_tone_check
  CHECK (description_tone IN ('ref_01', 'ref_02', 'ref_03'));
