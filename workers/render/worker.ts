import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { promises as fs, existsSync, readFileSync } from 'fs'
import path from 'path'
import os from 'os'
import { selectCommentsForRender } from '../../lib/comments/select-for-render'
import { createServiceRoleClient } from '../../lib/supabase/service-role'
import { textOverlaySchema } from '../../lib/text-overlays'

const REPO_ROOT = process.cwd()
const ENV_PATH = path.join(REPO_ROOT, '.env.local')
if (existsSync(ENV_PATH)) {
  for (const line of readFileSync(ENV_PATH, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

const POLL_INTERVAL_MS = 3000

const supabase = createServiceRoleClient()

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

const RENDER_PRESETS = {
  fast:     { useHardware: true,  bitrate: '8M',    crf: undefined, concurrency: 12, audioBitrate: '192k' },
  balanced: { useHardware: false, bitrate: undefined, crf: 12,       concurrency: 8,  audioBitrate: '192k' },
  quality:  { useHardware: false, bitrate: undefined, crf: 10,       concurrency: 6,  audioBitrate: '192k' },
} as const
type RenderPreset = keyof typeof RENDER_PRESETS

function extractLayout(config: unknown): CompositionId {
  if (config && typeof config === 'object' && !Array.isArray(config)) {
    const layout = (config as Record<string, unknown>).layout
    if (layout === 'LAYOUT_B') return 'LayoutB'
    if (layout === 'LAYOUT_C') return 'LayoutC'
  }
  return 'LayoutA'
}

async function getSourceSignedUrl(
  storagePath: string,
  ytVideoId: string | null,
): Promise<string> {
  console.log(`[source] signed URL for ${ytVideoId ?? storagePath}`)
  const { data, error } = await supabase.storage.from('sources').createSignedUrl(storagePath, 7200)
  if (error || !data?.signedUrl) throw new Error(`source signed url failed: ${error?.message ?? 'no url'}`)
  return data.signedUrl
}


async function processJob(clipId: string): Promise<void> {
  console.time('[render] total')
  const { data: clip, error: clipErr } = await supabase
    .from('clips')
    .select('*')
    .eq('id', clipId)
    .single()
  if (clipErr || !clip) throw new Error(`clip not found: ${clipErr?.message}`)
  if (!clip.project_id) throw new Error('clip has no project_id')
  console.log(`[render] job start | clip_id: ${clipId} | project_id: ${clip.project_id}`)

  const { data: project } = await supabase
    .from('projects')
    .select('yt_source_path, yt_video_id, source_url, artist, song_title')
    .eq('id', clip.project_id)
    .single()
  if (!project?.yt_source_path) throw new Error('project source missing')

  const [{ data: segments }, { data: comments }, { data: overlayRows }, templateRes] = await Promise.all([
    supabase
      .from('lyrics_segments')
      .select('text, start_sec, end_sec')
      .eq('clip_id', clipId)
      .order('start_sec'),
    supabase
      .from('comments')
      .select('username, body, likes_count, is_selected')
      .eq('clip_id', clipId)
      .order('likes_count', { ascending: false }),
    supabase
      .from('text_overlays')
      .select('*')
      .eq('clip_id', clipId)
      .order('z_index'),
    clip.template_id
      ? supabase.from('templates').select('config_json').eq('id', clip.template_id).single()
      : Promise.resolve({ data: null }),
  ])

  const compositionId = extractLayout(
    (templateRes as { data: { config_json: unknown } | null }).data?.config_json,
  )
  const textOverlays = (overlayRows ?? []).flatMap((row) => {
    const parsed = textOverlaySchema.safeParse(row)
    return parsed.success ? [parsed.data] : []
  })

  const serveUrl = await ensureBundle()
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'galaxymap-render-'))
  const outputPath = path.join(tmpDir, `${clipId}.mp4`)

  try {
    console.time('[render] source')
    const renderVideoUrl = await getSourceSignedUrl(project.yt_source_path, project.yt_video_id ?? null)
    console.timeEnd('[render] source')

    const inputProps = {
      clip: {
        start_sec: clip.start_sec,
        end_sec: clip.end_sec,
        bgm_url: clip.bgm_url,
        bgm_volume: clip.bgm_volume ?? 0.3,
        original_volume: clip.original_volume ?? 1.0,
        bgm_start_sec: (clip as Record<string, unknown>).bgm_start_sec as number ?? 0,
        bar_enabled: (clip as Record<string, unknown>).bar_enabled as boolean ?? false,
        subtitle_style: clip.subtitle_style,
        comment_style: clip.comment_style,
        text_overlays: textOverlays,
      },
      segments: segments ?? [],
      comments: selectCommentsForRender(comments ?? []),
      preview_path: renderVideoUrl,
    }

    const composition = await selectComposition({
      serveUrl,
      id: compositionId,
      inputProps,
    })

    const rawPreset = ((clip as Record<string, unknown>).render_preset as RenderPreset) ?? 'balanced'
    const preset = rawPreset in RENDER_PRESETS ? rawPreset : 'balanced'
    const presetCfg = RENDER_PRESETS[preset]
    console.log(`[render] preset: ${preset} | codec: ${presetCfg.useHardware ? 'h264_videotoolbox' : 'libx264'} | crf: ${presetCfg.crf ?? 'n/a'} | concurrency: ${presetCfg.concurrency}`)

    let lastReportedPct = 0
    console.time('[render] remotion render')
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      crf: presetCfg.crf,
      pixelFormat: 'yuv420p',
      audioBitrate: presetCfg.audioBitrate,
      outputLocation: outputPath,
      inputProps,
      concurrency: presetCfg.concurrency,
      overrideFfmpegCommand: presetCfg.useHardware
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

            const insertAt = cmd.indexOf('-c:v')
            if (insertAt !== -1) {
              cmd.splice(insertAt + 2, 0, '-b:v', presetCfg.bitrate as string, '-profile:v', 'high')
            }

            console.log(`[render] ffmpeg override applied: ${cmd.slice(0, 12).join(' ')}`)
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

    console.timeEnd('[render] remotion render')

    const fileBuffer = await fs.readFile(outputPath)

    const sanitize = (s: string) =>
      s.replace(/\s+/g, '_').replace(/[/\\:*?"<>|]/g, '').slice(0, 50)

    const { data: projectClips } = await supabase
      .from('clips')
      .select('id')
      .eq('project_id', clip.project_id)
      .order('start_sec', { ascending: true })
    const clipIndex = (projectClips ?? []).findIndex(c => c.id === clipId) + 1
    const nn = String(clipIndex > 0 ? clipIndex : 1).padStart(2, '0')
    const artist = (project as Record<string, unknown>).artist as string ?? ''
    const songTitle = (project as Record<string, unknown>).song_title as string ?? ''
    const filename = `${sanitize(artist)}_${sanitize(songTitle)}_render${nn}.mp4`
    const renderPath = `${clip.project_id}/${filename}`
    console.time('[render] storage upload')
    const { error: uploadErr } = await supabase.storage
      .from('renders')
      .upload(renderPath, fileBuffer, { contentType: 'video/mp4', upsert: true })
    if (uploadErr) throw new Error(`upload failed: ${uploadErr.message}`)
    console.timeEnd('[render] storage upload')

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

    console.timeEnd('[render] total')
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
