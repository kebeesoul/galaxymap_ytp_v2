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

  await supabase
    .from('clips')
    .update({ render_status: 'pending', render_error: null })
    .eq('id', clip_id)

  // Mac Studio render worker polls for render_status='pending' and runs Remotion locally
  return NextResponse.json({ queued: true }, { status: 202 })
}
