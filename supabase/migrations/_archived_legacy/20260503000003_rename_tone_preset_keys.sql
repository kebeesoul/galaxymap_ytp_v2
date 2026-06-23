-- Rename tone preset keys from channel names to generic ref IDs
ALTER TABLE tone_presets DROP CONSTRAINT IF EXISTS tone_presets_key_check;

UPDATE tone_presets SET key = 'ref_01', label = 'ref_01' WHERE key = 'hushwav';
UPDATE tone_presets SET key = 'ref_02', label = 'ref_02' WHERE key = 'parkbeat';
UPDATE tone_presets SET key = 'ref_03', label = 'ref_03' WHERE key = 'archive';

ALTER TABLE tone_presets
  ADD CONSTRAINT tone_presets_key_check CHECK (key IN ('ref_01', 'ref_02', 'ref_03'));
