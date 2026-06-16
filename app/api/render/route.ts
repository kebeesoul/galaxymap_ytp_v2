import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const VALID_PRESETS = ['fast', 'balanced', 'quality'] as const
type RenderPreset = typeof VALID_PRESETS[number]

const BodySchema = z.object({
  clip_id: z.string().min(1, 'clip_id is required'),
  preset: z.string().optional(),
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
  const { clip_id, preset = 'balanced' } = parsed.data

  const safePreset: RenderPreset = (VALID_PRESETS as readonly string[]).includes(preset)
    ? (preset as RenderPreset)
    : 'balanced'

  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: clip, error: clipError } = await supabase
    .from('clips')
    .select('id, render_status, projects!inner(owner_uid)')
    .eq('id', clip_id)
    .eq('projects.owner_uid', user.id)
    .single()

  if (clipError || !clip) {
    return NextResponse.json({ error: 'clip not found' }, { status: 404 })
  }

  const { data: updated, error: updateError } = await supabase
    .from('clips')
    .update({
      render_status: 'pending',
      render_preset: safePreset,
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
