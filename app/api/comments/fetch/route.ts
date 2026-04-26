import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface FetchBody {
  clip_id: string
  video_id: string
}

interface YoutubeCommentSnippet {
  authorDisplayName: string
  textDisplay: string
  likeCount: number
}

interface YoutubeItem {
  snippet: {
    topLevelComment: {
      snippet: YoutubeCommentSnippet
    }
  }
}

interface YoutubeResponse {
  items?: YoutubeItem[]
  error?: { message: string }
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as FetchBody
  const { clip_id, video_id } = body

  if (!clip_id || !video_id) {
    return NextResponse.json({ error: 'clip_id and video_id are required' }, { status: 400 })
  }

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'YOUTUBE_API_KEY is not configured' }, { status: 500 })
  }

  const supabase = createClient()

  // Verify clip exists
  const { data: clip, error: clipError } = await supabase
    .from('clips')
    .select('id')
    .eq('id', clip_id)
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
  const ytData = (await ytRes.json()) as YoutubeResponse

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
