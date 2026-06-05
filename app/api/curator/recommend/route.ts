import { randomUUID } from 'node:crypto'
import { GoogleGenAI } from '@google/genai'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  recommendationBatchSchema,
  type GeneratedRecommendation,
} from '@/lib/curator/recommendations'
import type { TablesInsert } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'

export async function POST() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY is not configured' }, { status: 503 })
  }

  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 })
  }

  const { data: recentRows } = await supabase
    .from('track_recommendations')
    .select('artist, song_title')
    .order('created_at', { ascending: false })
    .limit(24)

  try {
    const ai = new GoogleGenAI({ apiKey })
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: buildPrompt(recentRows ?? []),
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: {
          type: 'object',
          required: ['recommendations'],
          properties: {
            recommendations: {
              type: 'array',
              minItems: 3,
              maxItems: 3,
              items: {
                type: 'object',
                required: [
                  'artist',
                  'song_title',
                  'release_year',
                  'genre',
                  'reason',
                  'role',
                  'popularity_estimate',
                  'topic',
                  'era',
                ],
                properties: {
                  artist: { type: 'string' },
                  song_title: { type: 'string' },
                  release_year: { type: 'integer' },
                  genre: { type: 'string' },
                  reason: { type: 'string' },
                  role: { type: 'string', enum: ['popular', 'reliable', 'wildcard'] },
                  popularity_estimate: { type: 'integer', minimum: 1, maximum: 10 },
                  topic: { type: 'string' },
                  era: { type: 'string' },
                },
              },
            },
          },
        },
      },
    })

    const parsed = recommendationBatchSchema.parse(JSON.parse(response.text ?? ''))
    const batchId = randomUUID()
    const payload = parsed.recommendations.map((item, index) =>
      toInsert(item, index + 1, batchId, user.id),
    )

    let { error: insertError } = await supabase.from('track_recommendations').insert(payload)
    if (insertError && isMissingOwnerUidError(insertError.message)) {
      const legacyPayload = payload.map(({ owner_uid: _ownerUid, ...item }) => item)
      const legacyResult = await supabase
        .from('track_recommendations')
        .insert(legacyPayload as unknown as TablesInsert<'track_recommendations'>[])
      insertError = legacyResult.error
    }

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ batch_id: batchId, count: payload.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Recommendation generation failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

function buildPrompt(recent: Array<{ artist: string; song_title: string }>) {
  const excluded = recent.map((item) => `${item.artist} - ${item.song_title}`).join('\n')
  return `You are a music curator for short-form video editors.
Recommend exactly three real released songs with three distinct roles:
1. popular: broadly recognizable and current
2. reliable: proven catalog track with strong editorial utility
3. wildcard: surprising but credible discovery

Return Korean reasons under 300 characters. Do not repeat any excluded track.
Excluded tracks:
${excluded || 'None'}`
}

function toInsert(
  item: GeneratedRecommendation,
  rank: number,
  batchId: string,
  ownerUid: string,
): TablesInsert<'track_recommendations'> {
  return {
    ...item,
    owner_uid: ownerUid,
    batch_id: batchId,
    rank,
    genre_filter: item.genre,
    yt_search_status: 'pending',
    used: false,
  }
}

function isMissingOwnerUidError(message: string) {
  return message.includes("Could not find the 'owner_uid' column")
}
