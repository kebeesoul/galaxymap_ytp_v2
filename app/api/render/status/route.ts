import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const clip_id = request.nextUrl.searchParams.get('clip_id')

  if (!clip_id) {
    return NextResponse.json({ error: 'clip_id is required' }, { status: 400 })
  }

  const supabase = createClient()

  const { data: clip, error } = await supabase
    .from('clips')
    .select('render_status, render_path, render_error, render_progress')
    .eq('id', clip_id)
    .single()

  if (error || !clip) {
    return NextResponse.json({ error: 'clip not found' }, { status: 404 })
  }

  return NextResponse.json({
    render_status: clip.render_status,
    render_path: clip.render_path,
    render_error: clip.render_error,
    render_progress: clip.render_progress ?? 0,
  })
}
