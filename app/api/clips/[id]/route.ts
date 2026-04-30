import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const clipId = params.id
  const supabase = createClient()

  const { data: clip, error: fetchError } = await supabase
    .from('clips')
    .select('id, bgm_url, render_path')
    .eq('id', clipId)
    .single()

  if (fetchError && (fetchError as { code?: string }).code !== 'PGRST116') {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }
  if (!clip) {
    return NextResponse.json({ deleted: { clip_id: clipId, sources_files: 0, renders_files: 0 } })
  }

  // DB delete first — CASCADE handles lyrics_segments and comments.
  const { error: deleteError } = await supabase.from('clips').delete().eq('id', clipId)
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  // Storage cleanup is best-effort
  const sourcesPaths = clip.bgm_url ? [`bgm/${clip.id}.mp3`] : []
  const rendersPaths = clip.render_path ? [clip.render_path] : []

  const [sourcesResult, rendersResult] = await Promise.all([
    sourcesPaths.length > 0
      ? supabase.storage.from('sources').remove(sourcesPaths)
      : Promise.resolve({ error: null }),
    rendersPaths.length > 0
      ? supabase.storage.from('renders').remove(rendersPaths)
      : Promise.resolve({ error: null }),
  ])
  if (sourcesResult.error) {
    console.error('[delete clip] sources cleanup failed:', sourcesResult.error.message)
  }
  if (rendersResult.error) {
    console.error('[delete clip] renders cleanup failed:', rendersResult.error.message)
  }

  return NextResponse.json({
    deleted: {
      clip_id: clipId,
      sources_files: sourcesPaths.length,
      renders_files: rendersPaths.length,
    },
  })
}
