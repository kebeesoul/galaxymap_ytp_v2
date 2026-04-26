/**
 * galaxymap_ytp_v2 — local render worker
 *
 * Polls Supabase for clips with render_status='pending', renders the matching
 * Remotion composition (LayoutA/B/C) to MP4, uploads to the `renders` bucket,
 * and writes the result back to the clip row.
 *
 * Run from repo root:
 *
 *   npm run render-worker
 *
 * Required env (read from .env.local at the repo root):
 *
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY     # or SUPABASE_SERVICE_ROLE_KEY (preferred)
 */
import { createClient } from '@supabase/supabase-js'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { promises as fs, existsSync, readFileSync } from 'fs'
import path from 'path'
import os from 'os'

// --- env loading (dotenv-free) -----------------------------------------------
const REPO_ROOT = process.cwd()
const ENV_PATH = path.join(REPO_ROOT, '.env.local')
if (existsSync(ENV_PATH)) {
  for (const line of readFileSync(ENV_PATH, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const POLL_INTERVAL_MS = 3000

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// --- Remotion bundle (built once, reused per render) -------------------------
let serveUrlPromise: Promise<string> | null = null
function ensureBundle(): Promise<string> {
  if (!serveUrlPromise) {
    console.log('[render-worker] bundling Remotion compositions… (one-time, ~30s)')
    serveUrlPromise = bundle({
      entryPoint: path.join(REPO_ROOT, 'remotion/Root.tsx'),
      webpackOverride: (cfg) => cfg,
    }).then((url) => {
      console.log('[render-worker] bundle ready:', url)
      return url
    })
  }
  return serveUrlPromise
}

// --- helpers -----------------------------------------------------------------
type CompositionId = 'LayoutA' | 'LayoutB' | 'LayoutC'

function extractLayout(config: unknown): CompositionId {
  if (config && typeof config === 'object' && !Array.isArray(config)) {
    const layout = (config as Record<string, unknown>).layout
    if (layout === 'LAYOUT_B') return 'LayoutB'
    if (layout === 'LAYOUT_C') return 'LayoutC'
  }
  return 'LayoutA'
}

async function processJob(clipId: string): Promise<void> {
  const { data: clip, error: clipErr } = await supabase
    .from('clips')
    .select('*')
    .eq('id', clipId)
    .single()
  if (clipErr || !clip) throw new Error(`clip not found: ${clipErr?.message}`)
  if (!clip.project_id) throw new Error('clip has no project_id')

  const { data: project } = await supabase
    .from('projects')
    .select('yt_source_path')
    .eq('id', clip.project_id)
    .single()
  if (!project?.yt_source_path) throw new Error('project preview source missing')

  const [{ data: segments }, { data: comments }, templateRes] = await Promise.all([
    supabase
      .from('lyrics_segments')
      .select('text, start_sec, end_sec')
      .eq('clip_id', clipId)
      .order('start_sec'),
    supabase
      .from('comments')
      .select('username, body, likes_count')
      .eq('clip_id', clipId)
      .eq('is_selected', true)
      .order('likes_count', { ascending: false }),
    clip.template_id
      ? supabase.from('templates').select('config_json').eq('id', clip.template_id).single()
      : Promise.resolve({ data: null }),
  ])

  const compositionId = extractLayout(
    (templateRes as { data: { config_json: unknown } | null }).data?.config_json,
  )

  const { data: previewSigned, error: signErr } = await supabase.storage
    .from('sources')
    .createSignedUrl(project.yt_source_path, 7200)
  if (signErr || !previewSigned?.signedUrl) {
    throw new Error(`signed url failed: ${signErr?.message ?? 'no url'}`)
  }

  const inputProps = {
    clip: {
      start_sec: clip.start_sec,
      end_sec: clip.end_sec,
      bgm_url: clip.bgm_url,
      bgm_volume: clip.bgm_volume ?? 0.3,
      original_volume: clip.original_volume ?? 1.0,
      subtitle_style: clip.subtitle_style,
      comment_style: clip.comment_style,
    },
    segments: segments ?? [],
    comments: comments ?? [],
    preview_path: previewSigned.signedUrl,
  }

  const serveUrl = await ensureBundle()
  const composition = await selectComposition({
    serveUrl,
    id: compositionId,
    inputProps,
  })

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'galaxymap-render-'))
  const outputPath = path.join(tmpDir, `${clipId}.mp4`)

  let lastReportedPct = 0
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps,
    onProgress: ({ progress }) => {
      const pct = Math.round(progress * 100)
      if (pct - lastReportedPct >= 5) {
        lastReportedPct = pct
        supabase
          .from('clips')
          .update({ render_progress: pct })
          .eq('id', clipId)
          .then(({ error }) => {
            if (error) console.error(`[progress] ${clipId}: ${error.message}`)
          })
      }
    },
  })

  const fileBuffer = await fs.readFile(outputPath)
  const renderPath = `${clipId}/${Date.now()}.mp4`
  const { error: uploadErr } = await supabase.storage
    .from('renders')
    .upload(renderPath, fileBuffer, { contentType: 'video/mp4', upsert: true })
  if (uploadErr) throw new Error(`upload failed: ${uploadErr.message}`)

  const { error: finalErr } = await supabase
    .from('clips')
    .update({
      render_status: 'success',
      render_path: renderPath,
      render_progress: 100,
      render_error: null,
    })
    .eq('id', clipId)
  if (finalErr) throw new Error(`final update failed: ${finalErr.message}`)

  await fs.rm(tmpDir, { recursive: true, force: true })
  console.log(`[OK]  ${clipId}  → ${renderPath}`)
}

async function pollOnce(): Promise<void> {
  const { data: pending } = await supabase
    .from('clips')
    .select('id')
    .eq('render_status', 'pending')
    .order('created_at')
    .limit(1)
  if (!pending || pending.length === 0) return

  const clipId = pending[0].id
  const { data: claimed } = await supabase
    .from('clips')
    .update({ render_status: 'processing', render_error: null, render_progress: 0 })
    .eq('id', clipId)
    .eq('render_status', 'pending')
    .select('id')
  if (!claimed || claimed.length === 0) return

  console.log(`[JOB] ${clipId}`)
  try {
    await processJob(clipId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[ERR] ${clipId}: ${msg}`)
    await supabase
      .from('clips')
      .update({ render_status: 'failed', render_error: msg.slice(0, 500) })
      .eq('id', clipId)
  }
}

async function main(): Promise<void> {
  // Reset jobs stuck in 'processing' from a previous crash so they're retried
  await supabase
    .from('clips')
    .update({ render_status: 'pending' })
    .eq('render_status', 'processing')

  console.log(`galaxymap render worker — polling every ${POLL_INTERVAL_MS / 1000}s`)
  await ensureBundle() // pre-bundle so the first job doesn't pay the cost

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await pollOnce()
    } catch (err) {
      console.error('[POLL ERR]', err)
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
