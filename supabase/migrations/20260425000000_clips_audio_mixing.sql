ALTER TABLE clips ADD COLUMN bgm_url text;
ALTER TABLE clips ADD COLUMN bgm_volume numeric NOT NULL DEFAULT 0.3;
ALTER TABLE clips ADD COLUMN original_volume numeric NOT NULL DEFAULT 1.0;
