-- Fix FK constraint to allow project deletion without violating referential integrity
ALTER TABLE track_recommendations
  DROP CONSTRAINT IF EXISTS track_recommendations_used_project_id_fkey;

ALTER TABLE track_recommendations
  ADD CONSTRAINT track_recommendations_used_project_id_fkey
  FOREIGN KEY (used_project_id) REFERENCES projects(id) ON DELETE SET NULL;
