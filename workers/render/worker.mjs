/**
 * galaxymap render worker — Mac Studio local only
 * Polls Supabase for clips with render_status='pending', runs Remotion CLI locally,
 * uploads mp4 to Supabase Storage renders/, updates clip row.
 *
 * Run: node workers/render/worker.mjs
 * Requires: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY in .env
 */
import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')
const POLL_INTERVAL = 5_000

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

const COMPOSITION_MAP = {
  LAYOUT_A: 'LayoutA',
  LAYOUT_B: 'LayoutB',
  LAYOUT_C: 'LayoutC',
}

function extractLayout(configJson) {
  if (!configJson || typeof configJson !== 'object' || Array.isArray(configJson)) return 'LAYOUT_A'
  const l = configJson.layout
  if (l === 'LAYOUT_A' || l === 'LAYOUT_B' || l === 'LAYOUT_C') return l
  return 'LAYOUT_A'
}

// C5: stream Remotion CLI, parse frame progress, call onProgress(0-100)
function renderWithProgress(bin, args, cwd, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    let lastPct = -1

    function parseLine(line) {
      // Remotion verbose: "X of Y frames" or "(X%)"
      const fm = line.match(/(\d+)\s+of\s+(\d+)\s+frames?/i)
      if (fm) {
        const pct = Math.min(99, Math.round((+fm[1] / +fm[2]) * 100))
        if (pct !== lastPct) { lastPct = pct; onProgress(pct) }
        return
      }
      const pm = line.match(/\((\d+(?:\.\d+)?)%\)/)
      if (pm) {
        const pct = Math.min(99, Math.round(parseFloat(pm[1])))
        if (pct !== lastPct) { lastPct = pct; onProgress(pct) }
      }
    }

    proc.stdout.on('data', buf => buf.toString().split('\n').forEach(parseLine))
    proc.stderr.on('data', buf => {
      const s = buf.toString()
      stderr += s
      s.split('\n').forEach(parseLine)
    })
    proc.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(stderr.slice(-1000) || `Remotion exited ${code}`))
    })
    proc.on('error', reject)
  })
}

async function processClip(supabase, clipId) {
  // Atomic claim — guard against duplicate workers
  const { data: claimed } = await supabase
    .from('clips')
    .update({ render_status: 'processing', render_progress: 0 })
    .eq('id', clipId)
    .eq('render_status', 'pending')
    .select('id')
  if (!claimed?.length) return

  const propsPath = path.join(os.tmpdir(), `remotion-props-${clipId}.json`)
  const outputPath = path.join(os.tmpdir(), `render-${clipId}.mp4`)

  try {
    const { data: clip } = await supabase.from('clips').select('*').eq('id', clipId).single()
    const { data: project } = await supabase
      .from('projects').select('yt_source_path').eq('id', clip.project_id).single()

    if (!project?.yt_source_path) throw new Error('project source path not found')

    const [signedResult, { data: segments }, { data: allComments }, templateResult] =
      await Promise.all([
        supabase.storage.from('sources').createSignedUrl(project.yt_source_path, 3_600),
        supabase.from('lyrics_segments')
          .select('text, start_sec, end_sec')
          .eq('clip_id', clipId)
          .order('order', { ascending: true }),
        supabase.from('comments')
          .select('username, body, likes_count, is_selected')
          .eq('clip_id', clipId),
        clip.template_id
          ? supabase.from('templates').select('config_json').eq('id', clip.template_id).single()
          : Promise.resolve({ data: null }),
      ])

    const signedUrl = signedResult.data?.signedUrl
    if (!signedUrl) throw new Error('failed to generate signed URL')

    // C3: use only is_selected comments; fall back to all if none selected
    const selectedComments = (allComments ?? []).filter(c => c.is_selected)
    const comments = selectedComments.length > 0 ? selectedComments : (allComments ?? [])

    const layout = extractLayout(templateResult.data?.config_json)
    const compositionId = COMPOSITION_MAP[layout]

    const renderInput = {
      clip: {
        start_sec: Number(clip.start_sec),
        end_sec: Number(clip.end_sec),
        bgm_url: clip.bgm_url ?? null,
        bgm_volume: Number(clip.bgm_volume ?? 0.3),
        original_volume: Number(clip.original_volume ?? 1.0),
        // C1: pass subtitle style
        subtitle_style: clip.subtitle_style ?? null,
      },
      layout,
      segments: (segments ?? []).map(s => ({
        text: s.text,
        start_sec: Number(s.start_sec),
        end_sec: Number(s.end_sec),
      })),
      comments: comments.map(c => ({
        username: c.username,
        body: c.body,
        likes_count: c.likes_count ?? 0,
      })),
      preview_path: signedUrl,
    }

    await fs.writeFile(propsPath, JSON.stringify(renderInput), 'utf-8')

    const remotionBin = path.join(REPO_ROOT, 'node_modules', '.bin', 'remotion')
    console.log(`[RENDER] ${clipId} — ${compositionId}`)

    // C5: stream progress → update render_progress every 3s max
    let lastProgressUpdate = 0
    await renderWithProgress(
      remotionBin,
      [
        'render',
        'remotion/Root.tsx',
        compositionId,
        `--props=${propsPath}`,
        `--output=${outputPath}`,
        '--log=verbose',
        '--overwrite',
      ],
      REPO_ROOT,
      async (pct) => {
        const now = Date.now()
        if (now - lastProgressUpdate > 3_000) {
          lastProgressUpdate = now
          await supabase.from('clips').update({ render_progress: pct }).eq('id', clipId)
        }
      }
    )

    const mp4 = await fs.readFile(outputPath)
    const storagePath = `renders/${clipId}.mp4`

    const { error: uploadError } = await supabase.storage
      .from('renders')
      .upload(storagePath, mp4, { contentType: 'video/mp4', upsert: true })
    if (uploadError) throw new Error(uploadError.message)

    await supabase
      .from('clips')
      .update({ render_status: 'success', render_progress: 100, render_path: storagePath, render_error: null })
      .eq('id', clipId)

    console.log(`[OK] ${clipId}`)
  } catch (err) {
    const message = err?.message?.slice(0, 500) ?? 'Render failed'
    await supabase
      .from('clips')
      .update({ render_status: 'failed', render_error: message })
      .eq('id', clipId)
    console.error(`[ERR] ${clipId}`, message)
  } finally {
    await Promise.allSettled([
      fs.unlink(propsPath).catch(() => {}),
      fs.unlink(outputPath).catch(() => {}),
    ])
  }
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set in .env')
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

  // Reset jobs stuck in 'processing' from a previous crash
  await supabase.from('clips').update({ render_status: 'pending' }).eq('render_status', 'processing')

  console.log(`galaxymap render worker — polling every ${POLL_INTERVAL / 1000}s`)

  while (true) {
    try {
      const { data: jobs } = await supabase
        .from('clips').select('id').eq('render_status', 'pending')
        .order('created_at').limit(1)

      if (jobs?.length) {
        console.log(`[JOB] ${jobs[0].id}`)
        await processClip(supabase, jobs[0].id)
      }
    } catch (err) {
      console.error('[POLL ERR]', err?.message)
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL))
  }
}

main().catch(err => { console.error(err); process.exit(1) })
