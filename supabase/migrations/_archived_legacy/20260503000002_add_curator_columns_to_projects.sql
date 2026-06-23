ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS description_base TEXT;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS description_styled TEXT;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS description_tone TEXT
  CHECK (description_tone IN ('ref_01', 'ref_02', 'ref_03'));
