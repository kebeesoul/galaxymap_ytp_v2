-- Reset projects that failed with old-format English error messages so the worker
-- retries them with the improved yt-dlp settings (tv_embedded age-gate fallback).
UPDATE projects
SET import_status = 'pending', import_error = NULL
WHERE import_status = 'failed'
  AND (
    import_error LIKE 'Video unavailable%'
    OR import_error LIKE 'yt-dlp download error%'
  );
