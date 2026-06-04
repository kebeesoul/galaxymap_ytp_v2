# galaxymap_ytp_v2 Operations

This is the current operating guide. Treat `PROJECT_SPEC.md` as historical
design context when it conflicts with code, worker READMEs, or this file.

## Services

- Next.js app: `npm run dev` locally, Railway in production.
- Ingest pull worker: `docker compose up ingest-worker`.
- BGM upload HTTP worker: `docker compose up ingest-server`.
- Render worker: `npm run render-worker` on the local Mac Studio.

Do not deploy ingest or render workers to Railway, Vercel, or Edge functions.

## Queue Flow

- `/api/import` sets `projects.import_status='pending'`.
- `ingest-worker` polls Supabase, claims pending projects as `processing`, and
  uploads source video to `sources/preview/{video_id}.mp4`.
- `/api/render` sets `clips.render_status='pending'` only when a clip is not
  already `pending` or `processing`.
- `render-worker` polls Supabase, renders locally with Remotion, and uploads
  MP4 files to `renders/{project_id}/{artist}_{song_title}_renderNN.mp4`.

## Storage

Required private buckets:

- `sources`
- `renders`

Migration `20260504000000_render_storage_and_cancelled_status.sql` creates the
`renders` bucket and allows the `cancelled` render status.

## Production BGM Uploads

`/api/upload-bgm` calls the HTTP worker directly. In production,
`INGEST_WORKER_URL` or `PYTHON_WORKER_URL` must be configured; localhost fallback
is local development only.
