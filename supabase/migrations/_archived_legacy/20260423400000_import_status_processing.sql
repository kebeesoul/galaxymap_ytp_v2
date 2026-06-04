-- Add 'processing' to import_status to allow workers to claim jobs atomically
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_import_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_import_status_check
  CHECK (import_status IN ('pending', 'processing', 'success', 'failed'));
