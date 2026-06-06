import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface RenderBody {
  clip_id: string
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as RenderBody
  const { clip_id } = body

  if (!clip_id) {
    return NextResponse.json({ error: 'clip_id is required' }, { status: 400 })
  }

  const supabase = createClient()

  const { data: clip, error: clipError } = await supabase
    .from('clips')
    .select('id')
    .eq('id', clip_id)
    .single()

  if (clipError || !clip) {
    return NextResponse.json({ error: 'clip not found' }, { status: 404 })
  }

  const { data: updated, error: updateError } = await supabase
    .from('clips')
    .update({ render_status: 'pending', render_error: null })
    .eq('id', clip_id)
    .or('render_status.is.null,render_status.neq.processing')
    .select('id')

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  if (!updated?.length) {
    return NextResponse.json(
      { error: 'already processing', render_status: 'processing' },
      { status: 409 },
    )
  }

  // Mac Studio render worker polls for render_status='pending' and runs Remotion locally
  return NextResponse.json({ queued: true }, { status: 202 })
}
