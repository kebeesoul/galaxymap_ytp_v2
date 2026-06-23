# Render Worker

Local Mac-only worker that downloads source video from Cloudflare R2, renders
Remotion compositions to MP4 under the local workspace, and uploads render
output to Supabase Storage.
Polls every 3s for `clips.render_status='pending'`.

## First-time setup

```bash
# from repo root
pnpm install
```

Remotion will auto-download a headless Chrome on first run (~150 MB, cached
under `~/Library/Caches/remotion/`).

Supabase Storage must have a private `renders` bucket. Migration
`20260504000000_render_storage_and_cancelled_status.sql` creates it for new
environments.

## Run

```bash
# from repo root, with .env.local present
pnpm render-worker
```

Press Ctrl+C to stop. On crash / restart any clip stuck in `processing` is
reset to `pending` automatically.

## Env vars

Read from `.env.local` at the repo root:

- `NEXT_PUBLIC_SUPABASE_URL` (required)
- `SUPABASE_SERVICE_ROLE_KEY`
- `R2_ENDPOINT`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `STORAGE_ROOT` (optional, defaults to `<repo>/workspace`)
- `RENDER_CONCURRENCY_FAST` (optional, default `12`)
- `RENDER_CONCURRENCY_BALANCED` (optional, default `8`)
- `RENDER_CONCURRENCY_QUALITY` (optional, default `6`)

## Workspace layout

Render jobs use the same local workspace contract as the rest of the repo:

```text
workspace/
  renders/tmp/{clip_id}/   # R2 source download + Remotion scratch, deleted after job
  exports/{project_id}/    # final local MP4 mirror, kept for inspection/reuse
```

## Output

- MP4 kept locally at `workspace/exports/{project_id}/{artist}_{song_title}_renderNN.mp4`
- MP4 uploaded to Supabase Storage `renders/{project_id}/{artist}_{song_title}_renderNN.mp4`
- Clip row gets `render_status='success'`, `render_path=<path>`,
  `render_progress=100`
- On error: `render_status='failed'`, `render_error=<message>` (max 500 chars)

Render speed is controlled by preset concurrency only. The quality preset's
codec, CRF, bitrate, and audio bitrate are not lowered for speed.

The Next.js `/export` page surfaces every successful render with a
download button.
