import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const BodySchema = z.object({
  clip_id: z.string().min(1),
  video_id: z.string().min(1),
})

const YoutubeResponseSchema = z.object({
  items: z
    .array(
      z.object({
        snippet: z.object({
          topLevelComment: z.object({
            snippet: z.object({
              authorDisplayName: z.string(),
              textDisplay: z.string(),
              likeCount: z.number(),
            }),
          }),
        }),
      }),
    )
    .optional(),
  error: z.object({ message: z.string() }).optional(),
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
    return NextResponse.json({ error: 'clip_id and video_id are required' }, { status: 400 })
  }
  const { clip_id, video_id } = parsed.data

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'YOUTUBE_API_KEY is not configured' }, { status: 500 })
  }

  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify clip exists and belongs to the requesting user via its parent project
  const { data: clip, error: clipError } = await supabase
    .from('clips')
    .select('id, projects!inner(owner_uid)')
    .eq('id', clip_id)
    .eq('projects.owner_uid', user.id)
    .single()

  if (clipError || !clip) {
    return NextResponse.json({ error: 'clip not found' }, { status: 404 })
  }

  // Fetch from YouTube Data API v3
  const url = new URL('https://www.googleapis.com/youtube/v3/commentThreads')
  url.searchParams.set('part', 'snippet')
  url.searchParams.set('videoId', video_id)
  url.searchParams.set('maxResults', '20')
  url.searchParams.set('order', 'relevance')
  url.searchParams.set('key', apiKey)

  const ytRes = await fetch(url.toString())
  const ytRaw: unknown = await ytRes.json()
  const ytParsed = YoutubeResponseSchema.safeParse(ytRaw)
  if (!ytParsed.success) {
    return NextResponse.json({ error: 'Unexpected YouTube API response' }, { status: 502 })
  }
  const ytData = ytParsed.data

  if (!ytRes.ok) {
    const raw = ytData.error?.message ?? 'YouTube API error'

    let message = raw
    if (/disabled comments/i.test(raw)) {
      message = '이 영상은 댓글이 비활성화되어 있어 불러올 수 없습니다. 직접 추가해 주세요.'
    } else if (/quota/i.test(raw)) {
      message = 'YouTube API 일일 할당량을 초과했습니다. 내일 다시 시도하거나 댓글을 직접 추가해 주세요.'
    } else if (/API key not valid|Invalid API key/i.test(raw)) {
      message = 'YouTube API 키가 유효하지 않습니다. YOUTUBE_API_KEY 환경변수를 확인해 주세요.'
    } else if (/not found/i.test(raw)) {
      message = '영상을 찾을 수 없습니다. 비공개·삭제된 영상이거나 ID가 잘못되었을 수 있습니다.'
    }

    return NextResponse.json({ error: message }, { status: 502 })
  }

  const items = ytData.items ?? []

  if (items.length === 0) {
    return NextResponse.json({ comments: [] })
  }

  const rows = items.map(item => {
    const s = item.snippet.topLevelComment.snippet
    return {
      clip_id,
      username: s.authorDisplayName,
      body: s.textDisplay,
      likes_count: s.likeCount,
      source: 'youtube' as const,
    }
  })

  const { data: comments, error: insertError } = await supabase
    .from('comments')
    .insert(rows)
    .select()

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ comments })
}
