import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { renderClip } from '@/render-queue/worker'
import type { RenderInput } from '@/remotion/types'

interface RenderBody {
  clip_id: string
}

const TEMPLATE_LAYOUT_MAP: Record<string, RenderInput['layout']> = {
  subtitle_comment: 'LAYOUT_A',
  subtitle_only: 'LAYOUT_B',
  comment_only: 'LAYOUT_C',
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as RenderBody
  const { clip_id } = body

  if (!clip_id) {
    return NextResponse.json({ error: 'clip_id is required' }, { status: 400 })
  }

  const supabase = createClient()

  // 1. Fetch clip
  const { data: clip, error: clipError } = await supabase
    .from('clips')
    .select('*')
    .eq('id', clip_id)
    .single()

  if (clipError || !clip) {
    return NextResponse.json({ error: 'clip not found' }, { status: 404 })
  }

  // 2. Fetch project source path
  const { data: project, error: projError } = await supabase
    .from('projects')
    .select('yt_source_path')
    .eq('id', clip.project_id ?? '')
    .single()

  if (projError || !project?.yt_source_path) {
    return NextResponse.json({ error: 'project source not found' }, { status: 404 })
  }

  // 3. Generate signed URL for preview mp4
  const { data: signed } = await supabase.storage
    .from('sources')
    .createSignedUrl(project.yt_source_path, 3600)

  if (!signed?.signedUrl) {
    return NextResponse.json({ error: 'failed to generate signed URL' }, { status: 500 })
  }

  // 4. Fetch segments + comments + template in parallel
  const [{ data: segments }, { data: comments }, templateResult] = await Promise.all([
    supabase
      .from('lyrics_segments')
      .select('text, start_sec, end_sec')
      .eq('clip_id', clip_id),
    supabase
      .from('comments')
      .select('username, body, likes_count')
      .eq('clip_id', clip_id),
    clip.template_id
      ? supabase.from('templates').select('name').eq('id', clip.template_id).single()
      : Promise.resolve({ data: null }),
  ])

  const templateName = (templateResult as { data: { name: string } | null }).data?.name
  const layout: RenderInput['layout'] =
    (templateName ? TEMPLATE_LAYOUT_MAP[templateName] : undefined) ?? 'LAYOUT_A'

  // 5. Set render_status = pending
  await supabase
    .from('clips')
    .update({ render_status: 'pending', render_error: null })
    .eq('id', clip_id)

  // 6. Build RenderInput
  const renderInput: RenderInput = {
    clip: {
      start_sec: Number(clip.start_sec),
      end_sec: Number(clip.end_sec),
      bgm_url: clip.bgm_url,
      bgm_volume: clip.bgm_volume,
      original_volume: clip.original_volume,
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
    preview_path: signed.signedUrl,
  }

  // 7. Fire render in background — return 202 immediately
  void (async () => {
    const bg = createClient()
    try {
      const { renderPath } = await renderClip({ clipId: clip_id, input: renderInput })
      await bg
        .from('clips')
        .update({ render_status: 'success', render_path: renderPath, render_error: null })
        .eq('id', clip_id)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Render failed'
      await bg
        .from('clips')
        .update({ render_status: 'failed', render_error: message })
        .eq('id', clip_id)
    }
  })()

  return NextResponse.json({ queued: true }, { status: 202 })
}
