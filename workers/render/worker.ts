import { createClient } from '@supabase/supabase-js'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { promises as fs, existsSync, readFileSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import os from 'os'

const execFileAsync = promisify(execFile)

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

type CompositionId = 'LayoutA' | 'LayoutB' | 'LayoutC'

function extractLayout(config: unknown): CompositionId {
  if (config && typeof config === 'object' && !Array.isArray(config)) {
    const layout = (config as Record<string, unknown>).layout
    if (layout === 'LAYOUT_B') return 'LayoutB'
    if (layout === 'LAYOUT_C') return 'LayoutC'
  }
  return 'LayoutA'
}

async function downloadHqSource(sourceUrl: string, destPath: string): Promise<void> {
  await execFileAsync('yt-dlp', [
    '--extractor-args', 'youtube:player_client=ios,web',
    '-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
    '--merge-output-format', 'mp4',
    '--concurrent-fragments', '8',
    '--no-playlist',
    '-o', destPath,
    sourceUrl,
  ], { timeout: 600_000 })
}

async function getHqSignedUrl(
  projectId: string,
  sourceUrl: string,
  ytVideoId: string,
  cachedPath: string | null,
  tmpDir: string,
): Promise<string> {
  if (cachedPath) {
    console.log(`[HQ cached] ${ytVideoId}`)
    const { data, error } = await supabase.storage.from('sources').createSignedUrl(cachedPath, 7200)
    if (error || !data?.signedUrl) throw new Error(`HQ signed url failed: ${error?.message ?? 'no url'}`)
    return data.signedUrl
  }

  console.log(`[HQ download] ${ytVideoId} from ${sourceUrl}`)
  const hqTmpPath = path.join(tmpDir, `hq_${ytVideoId}.mp4`)
  await downloadHqSource(sourceUrl, hqTmpPath)

  const hqBuffer = await fs.readFile(hqTmpPath)
  const hqStoragePath = `hq/${ytVideoId}.mp4`
  const { error: uploadErr } = await supabase.storage
    .from('sources')
    .upload(hqStoragePath, hqBuffer, { contentType: 'video/mp4', upsert: true })
  if (uploadErr) throw new Error(`HQ upload failed: ${uploadErr.message}`)

  await supabase.from('projects').update({ yt_hq_source_path: hqStoragePath }).eq('id', projectId)

  const { data, error } = await supabase.storage.from('sources').createSignedUrl(hqStoragePath, 7200)
  if (error || !data?.signedUrl) throw new Error(`HQ signed url failed: ${error?.message ?? 'no url'}`)
  return data.signedUrl
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
    .select('yt_source_path, yt_hq_source_path, yt_video_id, source_url')
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

  const serveUrl = await ensureBundle()
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'galaxymap-render-'))
  const outputPath = path.join(tmpDir, `${clipId}.mp4`)

  try {
    const renderVideoUrl = await getHqSignedUrl(
      clip.project_id,
      project.source_url ?? '',
      project.yt_video_id ?? '',
      (project as Record<string, unknown>).yt_hq_source_path as string | null ?? null,
      tmpDir,
    )

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
      preview_path: renderVideoUrl,
    }

    const composition = await selectComposition({
      serveUrl,
      id: compositionId,
      inputProps,
    })

    const useHardwareEncoding = process.env.USE_VIDEOTOOLBOX !== 'false'
    console.log(`[render] encoding: ${useHardwareEncoding ? 'h264_videotoolbox' : 'libx264 (software)'}`)

    let lastReportedPct = 0
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      crf: useHardwareEncoding ? undefined : 12,
      pixelFormat: 'yuv420p',
      audioBitrate: '192k',
      outputLocation: outputPath,
      inputProps,
      concurrency: 8,
      overrideFfmpegCommand: useHardwareEncoding
        ? ({ type, args }: { type: string; args: string[] }): string[] => {
            if (type !== 'stitcher') return args
            const cmd = [...args]

            const codecIdx = cmd.indexOf('-c:v')
            if (codecIdx !== -1) {
              cmd[codecIdx + 1] = 'h264_videotoolbox'
            }

            const crfIdx = cmd.indexOf('-crf')
            if (crfIdx !== -1) {
              cmd.splice(crfIdx, 2)
            }

            const newCodecIdx = cmd.indexOf('-c:v')
            if (newCodecIdx !== -1) {
              cmd.splice(newCodecIdx + 2, 0, '-b:v', '10M', '-profile:v', 'high')
            }

            console.log(`[render] ffmpeg: ${cmd.join(' ')}`)
            return cmd
          }
        : undefined,
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

    console.log(`[OK]  ${clipId}  → ${renderPath}`)
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
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
  const RENDER_TIMEOUT_MS = 15 * 60 * 1000
  try {
    await Promise.race([
      processJob(clipId),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('render timeout (15 min)')), RENDER_TIMEOUT_MS)
      ),
    ])
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
  await supabase
    .from('clips')
    .update({ render_status: 'pending' })
    .eq('render_status', 'processing')

  console.log(`galaxymap render worker — polling every ${POLL_INTERVAL_MS / 1000}s`)
  await ensureBundle()

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
