# galaxymap_ytp_v2 Operations

This is the current operating guide. `PROJECT_SPEC.md` is the single source of
truth for architecture, topology, data models, and job flows.

## Services

- Next.js app: `pnpm dev` locally, Railway in production.
- Ingest pull worker: `docker compose up ingest-worker`.
- BGM upload HTTP worker: `docker compose up ingest-server`.
- Render worker: `pnpm render-worker` on the local Mac Studio.

Do not deploy ingest or render workers to Railway, Vercel, or Edge functions.

## Storage Topology

The repository is in a partial R2 migration state.

| Data | Current canonical storage | Stored DB value | Status |
|---|---|---|---|
| YouTube source MP4 | Cloudflare R2 | `projects.yt_source_path` = relative key `{owner_uid}/sources/preview/{video_id}.mp4` | Migrated |
| Uploaded BGM | Supabase Storage `sources` bucket | `clips.bgm_url` = Supabase Storage path | R2 migration pending |
| Rendered MP4 | Supabase Storage `renders` bucket | `clips.render_path` = Supabase Storage path | R2 migration pending |
| Processing scratch | Mac Studio local `STORAGE_ROOT` | Never stored as a DB path | Job-scoped only |

Do not store an absolute URL or local filesystem path in `yt_source_path`.
Every R2 source key must start with the owning Supabase Auth UID.

## Queue Flow

- `/api/import` sets `projects.import_status='pending'`.
- `ingest-worker` polls Supabase every 1 second, claims pending projects as `processing`, and
  downloads the source into local scratch storage, uploads it to R2 as
  `{owner_uid}/sources/preview/{video_id}.mp4`, stores that relative key in
  `projects.yt_source_path`, and deletes the local source after upload.
- `/api/render` sets `clips.render_status='pending'` only when a clip is not
  already `pending` or `processing`.
- `render-worker` polls Supabase, downloads the source directly from R2 to
  job-scoped local scratch storage, renders locally with Remotion, uploads the
  result to the Supabase Storage `renders` bucket, and removes local scratch
  files when the job ends.

## Required Storage Configuration

Cloudflare R2 source storage requires:

```bash
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=...
```

The R2 token must have Object Read & Write access to the configured source
bucket. The Python worker uses `region_name="auto"` and botocore checksum
calculation/validation set to `when_required`.

Supabase Storage still requires private buckets for the unmigrated paths:

- `sources`: uploaded BGM objects only
- `renders`: rendered MP4 output

Do not upload YouTube source MP4 files to the Supabase `sources` bucket.

## Browser Source Preview

The browser must not receive R2 credentials or construct source URLs directly.

1. The authenticated editor calls
   `GET /api/source-url?project_id=<project-uuid>`.
2. The route validates `project_id`, then validates the Supabase session.
3. The project is read through RLS and its `owner_uid` must match the
   authenticated user ID.
4. `projects.yt_source_path` must also start with `<authenticated-user-id>/`.
   This key-prefix check is a second authorization boundary in addition to RLS.
5. The server returns an R2 presigned GET URL with a one-hour expiry.

Expected failures:

| Condition | HTTP status |
|---|---:|
| Invalid `project_id` | 400 |
| Missing or invalid session | 401 |
| Source missing | 404 |
| `owner_uid` or key UID prefix mismatch | 403 |
| R2 signing/configuration unavailable | 503 |

After a URL expires, the client must request a new URL from `/api/source-url`.
R2 bucket CORS must allow the production app origin and required local
development origins for direct browser playback.

## Production BGM Uploads

`/api/upload-bgm` calls the HTTP worker directly. In production,
`INGEST_WORKER_URL` or `PYTHON_WORKER_URL` must be configured; localhost fallback
is local development only.
