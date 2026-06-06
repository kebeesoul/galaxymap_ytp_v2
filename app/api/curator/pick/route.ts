import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { buildYouTubeUrl } from '@/lib/curator/parse-yt'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  recommendation_id: z.string().uuid(),
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

  const { recommendation_id } = parsed.data
  const supabase = createClient()

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // Fetch the recommendation row
  const { data: rec, error: recError } = await supabase
    .from('track_recommendations')
    .select('artist, song_title, yt_video_id, yt_search_status')
    .eq('id', recommendation_id)
    .single()

  if (recError || !rec) {
    return NextResponse.json({ error: recError?.message ?? 'Recommendation not found' }, { status: 404 })
  }

  if (rec.yt_search_status !== 'found' || !rec.yt_video_id) {
    return NextResponse.json(
      { error: 'Recommendation has no valid YouTube video' },
      { status: 422 },
    )
  }

  const source_url = buildYouTubeUrl(rec.yt_video_id)

  // Insert project
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .insert({ artist: rec.artist, song_title: rec.song_title, source_url, owner_uid: user.id })
    .select('id')
    .single()

  if (projectError || !project) {
    return NextResponse.json(
      { error: projectError?.message ?? 'Failed to create project' },
      { status: 500 },
    )
  }

  // Mark recommendation as used
  const { error: updateError } = await supabase
    .from('track_recommendations')
    .update({ used: true, used_project_id: project.id })
    .eq('id', recommendation_id)

  if (updateError) {
    // Revert project on partial failure
    await supabase.from('projects').delete().eq('id', project.id)
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ project_id: project.id })
}
