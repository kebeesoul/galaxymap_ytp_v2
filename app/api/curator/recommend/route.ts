import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { recommendTracks, recommendReplacements } from '@/lib/curator/recommend'
import { searchYouTube } from '@/lib/curator/youtube-search'
import { isModulationValid } from '@/lib/curator/modulation'
import type { TopicKey, EraKey, GenreKey } from '@/lib/curator/modulation'
import type { Recommendation } from '@/lib/llm/types'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  topic: z.enum(['all', 'love', 'selflove', 'nostalgia', 'dance']),
  era: z.enum(['all', '2020s', '2010s', '2000s', 'pre2000s']),
  genre: z.enum(['all', 'hiphopRnb', 'balladIndie', 'kpop', 'rock']),
  exclude: z.array(z.object({ artist: z.string(), song_title: z.string() })).optional(),
})

interface SlotResult {
  rec: Recommendation
  videoId: string | null
  rank: number | null
}

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

  const { topic, era, genre } = parsed.data

  if (!isModulationValid(topic as TopicKey, era as EraKey, genre as GenreKey)) {
    return NextResponse.json(
      { error: 'At least one modulation filter must be set (not all "all")' },
      { status: 400 },
    )
  }

  const supabase = createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const batchId = crypto.randomUUID()

  // Step 1: Get initial 3 recommendations
  let candidates: Recommendation[]
  try {
    candidates = await recommendTracks({
      topic: topic as TopicKey,
      era: era as EraKey,
      genre: genre as GenreKey,
      excludeSongs: parsed.data.exclude,
    })
  } catch (err) {
    return NextResponse.json(
      { error: `LLM recommendation failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }

  // Step 2: Insert all 3 to DB with pending status
  const insertPayload = candidates.map((rec, i) => ({
    owner_uid: user.id,
    batch_id: batchId,
    rank: (i + 1) as 1 | 2 | 3,
    artist: rec.artist,
    song_title: rec.song_title,
    release_year: rec.release_year ?? null,
    genre: rec.genre ?? null,
    reason: rec.reason,
    role: rec.role,
    popularity_estimate: rec.popularity_estimate,
    yt_search_status: 'pending' as const,
  }))

  const { data: inserted, error: insertError } = await supabase
    .from('track_recommendations')
    .insert(insertPayload)
    .select('id, rank, role, artist, song_title')

  if (insertError || !inserted) {
    return NextResponse.json({ error: insertError?.message ?? 'Insert failed' }, { status: 500 })
  }

  // Step 3: YouTube search for each slot
  const slots: SlotResult[] = await Promise.all(
    inserted.map(async (row, i) => {
      const rec = candidates[i]
      try {
        const result = await searchYouTube(rec.artist, rec.song_title)
        await supabase
          .from('track_recommendations')
          .update({
            yt_video_id: result.videoId ?? undefined,
            yt_title: result.ytTitle ?? undefined,
            yt_search_status: result.videoId ? 'found' : 'not_found',
          })
          .eq('id', row.id)
        return { rec, videoId: result.videoId, rank: row.rank }
      } catch {
        await supabase
          .from('track_recommendations')
          .update({ yt_search_status: 'not_found' })
          .eq('id', row.id)
        return { rec, videoId: null, rank: row.rank }
      }
    }),
  )

  // Step 4: Retry failed slots (up to 2 replacements per failed role)
  const failedSlots = slots.filter((s) => s.videoId === null)
  const allRecs = [...candidates]

  for (const failed of failedSlots) {
    const excludeRecs = allRecs.map((r) => ({ artist: r.artist, song_title: r.song_title }))
    let replacements: Recommendation[] = []
    try {
      replacements = await recommendReplacements({
        topic: topic as TopicKey,
        era: era as EraKey,
        genre: genre as GenreKey,
        failedRole: failed.rec.role,
        excludeRecommendations: excludeRecs,
      })
    } catch {
      continue
    }

    for (const replacement of replacements) {
      allRecs.push(replacement)
      const { data: repInserted, error: repErr } = await supabase
        .from('track_recommendations')
        .insert({
          owner_uid: user.id,
          batch_id: batchId,
          rank: failed.rank as 1 | 2 | 3,
          artist: replacement.artist,
          song_title: replacement.song_title,
          release_year: replacement.release_year ?? null,
          genre: replacement.genre ?? null,
          reason: replacement.reason,
          role: replacement.role,
          popularity_estimate: replacement.popularity_estimate,
          yt_search_status: 'pending' as const,
        })
        .select('id')
        .single()

      if (repErr || !repInserted) continue

      try {
        const result = await searchYouTube(replacement.artist, replacement.song_title)
        await supabase
          .from('track_recommendations')
          .update({
            yt_video_id: result.videoId ?? undefined,
            yt_title: result.ytTitle ?? undefined,
            yt_search_status: result.videoId ? 'found' : 'not_found',
          })
          .eq('id', repInserted.id)

        if (result.videoId) {
          // Mark original failed slot as superseded by nulling it out via used flag
          failed.videoId = result.videoId
          break
        }
      } catch {
        await supabase
          .from('track_recommendations')
          .update({ yt_search_status: 'not_found' })
          .eq('id', repInserted.id)
      }
    }
  }

  // Step 5: Fetch final 'found' rows for this batch
  const { data: foundRows, error: fetchError } = await supabase
    .from('track_recommendations')
    .select('id, rank, artist, song_title, release_year, genre, reason, role, popularity_estimate, yt_video_id, yt_title')
    .eq('batch_id', batchId)
    .eq('yt_search_status', 'found')
    .order('rank', { ascending: true })

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  const recommendations = foundRows ?? []

  return NextResponse.json({
    batch_id: batchId,
    recommendations,
    partial: recommendations.length < 3,
  })
}
