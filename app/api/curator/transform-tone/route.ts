import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { transformTone } from '@/lib/curator/memo'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  project_id: z.string().uuid(),
  base_text: z.string().min(1),
  tone: z.enum(['ref_01', 'ref_02', 'ref_03']),
})

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  const { project_id, base_text, tone } = parsed.data
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch active tone preset
  const { data: preset, error: presetError } = await supabase
    .from('tone_presets')
    .select('label, description, reference_text')
    .eq('key', tone)
    .eq('is_active', true)
    .single()

  if (presetError || !preset) {
    return NextResponse.json(
      { error: presetError?.message ?? 'Tone preset not found or inactive' },
      { status: 404 },
    )
  }

  // Fetch project for artist/song_title
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('artist, song_title')
    .eq('id', project_id)
    .eq('owner_uid', user.id)
    .single()

  if (projectError || !project) {
    return NextResponse.json(
      { error: projectError?.message ?? 'Project not found' },
      { status: 404 },
    )
  }

  let text: string
  try {
    text = await transformTone({
      base_text,
      artist: project.artist,
      song_title: project.song_title,
      preset: {
        label: preset.label,
        description: preset.description,
        reference_text: preset.reference_text ?? null,
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: `Tone transform failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }

  const { error: updateError } = await supabase
    .from('projects')
    .update({ description_styled: text, description_tone: tone })
    .eq('id', project_id)
    .eq('owner_uid', user.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ text })
}
