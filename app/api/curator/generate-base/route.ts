import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { generateBaseMemo } from '@/lib/curator/memo'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  project_id: z.string().uuid(),
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

  const { project_id } = parsed.data
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: project, error: fetchError } = await supabase
    .from('projects')
    .select('artist, song_title, yt_duration_sec')
    .eq('id', project_id)
    .eq('owner_uid', user.id)
    .single()

  if (fetchError || !project) {
    return NextResponse.json(
      { error: fetchError?.message ?? 'Project not found' },
      { status: 404 },
    )
  }

  let text: string
  try {
    text = await generateBaseMemo({
      artist: project.artist,
      song_title: project.song_title,
    })
  } catch (err) {
    return NextResponse.json(
      { error: `Memo generation failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }

  const { error: updateError } = await supabase
    .from('projects')
    .update({ description_base: text })
    .eq('id', project_id)
    .eq('owner_uid', user.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ text })
}
