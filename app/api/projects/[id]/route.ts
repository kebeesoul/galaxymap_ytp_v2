import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const projectId = params.id
  const supabase = createClient()

  const [{ data: project, error: projectError }, { data: clips, error: clipsError }] = await Promise.all([
    supabase
      .from('projects')
      .select('id, yt_source_path')
      .eq('id', projectId)
      .single(),
    supabase
      .from('clips')
      .select('id, bgm_url, render_path')
      .eq('project_id', projectId),
  ])

  if (projectError || !project) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 })
  }
  if (clipsError) {
    return NextResponse.json({ error: clipsError.message }, { status: 500 })
  }

  // Collect every storage path attached to this project
  const sourcesPaths: string[] = []
  if (project.yt_source_path) sourcesPaths.push(project.yt_source_path)
  for (const clip of clips ?? []) {
    if (clip.bgm_url) sourcesPaths.push(`bgm/${clip.id}.mp3`)
  }

  const rendersPaths: string[] = []
  for (const clip of clips ?? []) {
    if (clip.render_path) rendersPaths.push(clip.render_path)
  }

  // DB delete first — CASCADE wipes clips, lyrics_segments, comments. If this
  // fails we never touch storage, so the project stays consistent.
  const { error: deleteError } = await supabase.from('projects').delete().eq('id', projectId)
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  // Storage cleanup is best-effort: a missing file should not bubble up as an
  // error to the user since the DB row is already gone.
  const [sourcesResult, rendersResult] = await Promise.all([
    sourcesPaths.length > 0
      ? supabase.storage.from('sources').remove(sourcesPaths)
      : Promise.resolve({ error: null }),
    rendersPaths.length > 0
      ? supabase.storage.from('renders').remove(rendersPaths)
      : Promise.resolve({ error: null }),
  ])
  if (sourcesResult.error) {
    console.error('[delete project] sources cleanup failed:', sourcesResult.error.message)
  }
  if (rendersResult.error) {
    console.error('[delete project] renders cleanup failed:', rendersResult.error.message)
  }

  return NextResponse.json({
    deleted: {
      project_id: projectId,
      clip_count: clips?.length ?? 0,
      sources_files: sourcesPaths.length,
      renders_files: rendersPaths.length,
    },
  })
}
