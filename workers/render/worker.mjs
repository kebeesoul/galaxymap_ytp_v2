/**
 * galaxymap render worker — Mac Studio local only
 * Polls Supabase for clips with render_status='pending', runs Remotion CLI locally,
 * uploads mp4 to Supabase Storage renders/, updates clip row.
 *
 * Run: node workers/render/worker.mjs
 * Requires: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY in .env
 */
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')
const execFileAsync = promisify(execFile)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const POLL_INTERVAL = 5_000

const TEMPLATE_LAYOUT_MAP = {
  subtitle_comment: 'LAYOUT_A',
  subtitle_only: 'LAYOUT_B',
  comment_only: 'LAYOUT_C',
}

const COMPOSITION_MAP = {
  LAYOUT_A: 'LayoutA',
  LAYOUT_B: 'LayoutB',
  LAYOUT_C: 'LayoutC',
}

async function processClip(supabase, clipId) {
  // Claim atomically — guard against duplicate workers
  const { data: claimed } = await supabase
    .from('clips')
    .update({ render_status: 'processing' })
    .eq('id', clipId)
    .eq('render_status', 'pending')
    .select('id')
  if (!claimed?.length) return

  const propsPath = path.join(os.tmpdir(), `remotion-props-${clipId}.json`)
  const outputPath = path.join(os.tmpdir(), `render-${clipId}.mp4`)

  try {
    // Fetch all data needed for render
    const { data: clip } = await supabase.from('clips').select('*').eq('id', clipId).single()
    const { data: project } = await supabase
      .from('projects')
      .select('yt_source_path')
      .eq('id', clip.project_id)
      .single()

    if (!project?.yt_source_path) throw new Error('project source path not found')

    const [signedResult, { data: segments }, { data: comments }, templateResult] =
      await Promise.all([
        supabase.storage.from('sources').createSignedUrl(project.yt_source_path, 3_600),
        supabase.from('lyrics_segments').select('text, start_sec, end_sec').eq('clip_id', clipId),
        supabase.from('comments').select('username, body, likes_count').eq('clip_id', clipId),
        clip.template_id
          ? supabase.from('templates').select('name').eq('id', clip.template_id).single()
          : Promise.resolve({ data: null }),
      ])

    const signedUrl = signedResult.data?.signedUrl
    if (!signedUrl) throw new Error('failed to generate signed URL')

    const templateName = templateResult.data?.name
    const layout = TEMPLATE_LAYOUT_MAP[templateName] ?? 'LAYOUT_A'
    const compositionId = COMPOSITION_MAP[layout]

    const renderInput = {
      clip: {
        start_sec: Number(clip.start_sec),
        end_sec: Number(clip.end_sec),
        bgm_url: clip.bgm_url ?? null,
        bgm_volume: Number(clip.bgm_volume ?? 0.3),
        original_volume: Number(clip.original_volume ?? 1.0),
      },
      layout,
      segments: (segments ?? []).map(s => ({
        text: s.text,
        start_sec: Number(s.start_sec),
        end_sec: Number(s.end_sec),
      })),
      comments: (comments ?? []).map(c => ({
        username: c.username,
        body: c.body,
        likes_count: c.likes_count ?? 0,
      })),
      preview_path: signedUrl,
    }

    await fs.writeFile(propsPath, JSON.stringify(renderInput), 'utf-8')

    const remotionBin = path.join(REPO_ROOT, 'node_modules', '.bin', 'remotion')
    console.log(`[RENDER] ${clipId} — ${compositionId}`)

    await execFileAsync(
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
      { cwd: REPO_ROOT, timeout: 300_000, maxBuffer: 100 * 1024 * 1024 }
    )

    const mp4 = await fs.readFile(outputPath)
    const storagePath = `renders/${clipId}.mp4`

    const { error: uploadError } = await supabase.storage
      .from('renders')
      .upload(storagePath, mp4, { contentType: 'video/mp4', upsert: true })
    if (uploadError) throw new Error(uploadError.message)

    await supabase
      .from('clips')
      .update({ render_status: 'success', render_path: storagePath, render_error: null })
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
    await Promise.allSettled([fs.unlink(propsPath).catch(() => {}), fs.unlink(outputPath).catch(() => {})])
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
        .from('clips')
        .select('id')
        .eq('render_status', 'pending')
        .order('created_at')
        .limit(1)

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

main().catch(err => {
  console.error(err)
  process.exit(1)
})
