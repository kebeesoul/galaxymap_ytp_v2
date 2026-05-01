import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface CancelBody {
  clip_id: string
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as CancelBody
  const { clip_id } = body

  if (!clip_id) {
    return NextResponse.json({ error: 'clip_id is required' }, { status: 400 })
  }

  const supabase = createClient()

  await supabase
    .from('clips')
    .update({ render_status: 'cancelled', render_error: '렌더가 중지되었습니다' })
    .eq('id', clip_id)
    .in('render_status', ['pending', 'processing'])

  return NextResponse.json({ cancelled: true })
}
