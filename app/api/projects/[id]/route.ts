import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const projectId = params.id
  const supabase = createClient()

  const [{ data: project, error: projectError }, { data: clipData, error: clipsError }] = await Promise.all([
    supabase
      .from('projects')
      .select('id, yt_source_path')
      .eq('id', projectId)
      .single(),
    // select('*') avoids "column does not exist" errors when schema migrations
    // have not yet been applied — PostgREST returns only the columns that exist.
    supabase
      .from('clips')
      .select('*')
      .eq('project_id', projectId),
  ])

  if (projectError) {
    // PGRST116 = .single() found 0 rows — project is genuinely gone
    if (projectError.code === 'PGRST116') {
      return NextResponse.json({ error: 'project not found' }, { status: 404 })
    }
    return NextResponse.json({ error: projectError.message }, { status: 500 })
  }
  if (!project) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 })
  }
  // Clips query failure (e.g. missing migration columns) is non-fatal: the DB
  // cascade still removes all clip rows; only storage cleanup is skipped.
  if (clipsError) {
    console.error('[delete project] clips query failed:', clipsError.message)
  }
  const clips = clipsError ? [] : (clipData ?? [])

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

  // Null out track_recommendations references before delete. The original FK was
  // created without ON DELETE SET NULL — migration 20260503000004 fixes that, but
  // we still null manually so this works even on DBs missing the migration.
  const { error: nullError } = await supabase
    .from('track_recommendations')
    .update({ used_project_id: null })
    .eq('used_project_id', projectId)
  if (nullError) {
    console.error('[delete project] track_recommendations null-out failed:', nullError)
    return NextResponse.json(
      { error: `track_recommendations 정리 실패: ${nullError.message}` },
      { status: 500 },
    )
  }

  // DB delete — CASCADE wipes clips, lyrics_segments, comments. If this
  // fails we never touch storage, so the project stays consistent.
  const { error: deleteError } = await supabase.from('projects').delete().eq('id', projectId)
  if (deleteError) {
    console.error('[delete project] projects.delete failed:', deleteError)
    const hint = deleteError.message.toLowerCase().includes('foreign key')
      ? ' (FK 위반 — Supabase SQL Editor에서 마이그레이션 20260503000004를 실행했는지 확인하세요)'
      : ''
    return NextResponse.json(
      { error: `${deleteError.message}${hint}` },
      { status: 500 },
    )
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
