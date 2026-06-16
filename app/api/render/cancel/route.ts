import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const BodySchema = z.object({
  clip_id: z.string().min(1, 'clip_id is required'),
})

export async function POST(request: NextRequest) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'clip_id is required' }, { status: 400 })
  }
  const { clip_id } = parsed.data

  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify the clip belongs to the requesting user via its parent project
  const { data: clip } = await supabase
    .from('clips')
    .select('id, projects!inner(owner_uid)')
    .eq('id', clip_id)
    .eq('projects.owner_uid', user.id)
    .single()

  if (!clip) {
    return NextResponse.json({ error: 'clip not found' }, { status: 404 })
  }

  const { data: cancelled, error } = await supabase
    .from('clips')
    .update({ render_status: 'cancelled', render_error: '렌더가 중지되었습니다' })
    .eq('id', clip_id)
    .in('render_status', ['pending', 'processing'])
    .select('id')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ cancelled: (cancelled?.length ?? 0) > 0 })
}
