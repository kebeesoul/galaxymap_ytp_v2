import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { extractYouTubeVideoId } from '@/lib/curator/parse-yt'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  artist: z.string().min(1),
  song_title: z.string().min(1),
  source_url: z.string().url(),
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

  const { artist, song_title, source_url } = parsed.data

  const videoId = extractYouTubeVideoId(source_url)
  if (!videoId) {
    return NextResponse.json(
      { error: 'source_url must be a valid YouTube URL' },
      { status: 400 },
    )
  }

  const supabase = createClient()

  const { data: project, error } = await supabase
    .from('projects')
    .insert({ artist, song_title, source_url })
    .select('id')
    .single()

  if (error || !project) {
    return NextResponse.json(
      { error: error?.message ?? 'Failed to create project' },
      { status: 500 },
    )
  }

  return NextResponse.json({ project_id: project.id })
}
