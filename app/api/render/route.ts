import { NextRequest, NextResponse } from 'next/server'
import { renderRequestSchema } from '@/lib/api/request-schemas'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = renderRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'clip_id is required' }, { status: 400 })
  }

  const { clip_id, preset } = parsed.data
  const supabase = createClient()

  const { data: clip, error: clipError } = await supabase
    .from('clips')
    .select('id, render_status')
    .eq('id', clip_id)
    .single()

  if (clipError || !clip) {
    return NextResponse.json({ error: 'clip not found' }, { status: 404 })
  }

  const { data: updated, error: updateError } = await supabase
    .from('clips')
    .update({
      render_status: 'pending',
      render_preset: preset,
      render_error: null,
      render_progress: 0,
    })
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
