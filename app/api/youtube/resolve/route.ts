import { NextRequest, NextResponse } from 'next/server'

interface SearchItem {
  id: { videoId?: string }
}

interface SearchResponse {
  items?: SearchItem[]
}

interface VideoItem {
  id: string
  snippet?: {
    title?: string
    channelTitle?: string
  }
  statistics?: {
    viewCount?: string
  }
}

interface VideosResponse {
  items?: VideoItem[]
}

interface Candidate {
  videoId: string
  title: string
  channelTitle: string
  viewCount: number
}

export async function GET(request: NextRequest) {
  const artist = request.nextUrl.searchParams.get('artist')?.trim()
  const songTitle = request.nextUrl.searchParams.get('song_title')?.trim()
  const apiKey = process.env.YOUTUBE_API_KEY

  if (!artist || !songTitle) {
    return NextResponse.json({ error: 'artist and song_title are required' }, { status: 400 })
  }
  if (!apiKey) {
    return NextResponse.json({ error: 'YOUTUBE_API_KEY is not configured' }, { status: 503 })
  }

  const officialCandidates = await searchVideos(
    `${artist} ${songTitle} official music video`,
    apiKey,
    'relevance',
  )
  const official = officialCandidates
    .filter((candidate) => isLikelySongMatch(candidate, artist, songTitle))
    .find(isOfficialMusicVideo)

  if (official) {
    return NextResponse.json(toResponse(official, 'official_music_video'))
  }

  const liveCandidates = await searchVideos(`${artist} ${songTitle} live`, apiKey, 'viewCount')
  const live = liveCandidates
    .filter((candidate) => isLikelySongMatch(candidate, artist, songTitle))
    .filter(isLiveClip)
    .sort((a, b) => b.viewCount - a.viewCount)[0]

  if (live) {
    return NextResponse.json(toResponse(live, 'top_live_clip'))
  }

  const fallback = [...officialCandidates, ...liveCandidates]
    .filter((candidate) => isLikelySongMatch(candidate, artist, songTitle))
    .sort((a, b) => b.viewCount - a.viewCount)[0]

  if (!fallback) {
    return NextResponse.json({ error: 'No matching YouTube video found' }, { status: 404 })
  }

  return NextResponse.json(toResponse(fallback, 'best_match'))
}

async function searchVideos(query: string, apiKey: string, order: 'relevance' | 'viewCount') {
  const searchParams = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    videoCategoryId: '10',
    maxResults: '10',
    order,
    key: apiKey,
  })
  const searchRes = await fetch(`https://www.googleapis.com/youtube/v3/search?${searchParams}`)
  if (!searchRes.ok) {
    throw new Error(`YouTube search failed: ${searchRes.status}`)
  }

  const searchBody = (await searchRes.json()) as SearchResponse
  const ids = (searchBody.items ?? [])
    .map((item) => item.id.videoId)
    .filter((id): id is string => Boolean(id))

  if (ids.length === 0) return []

  const videoParams = new URLSearchParams({
    part: 'snippet,statistics',
    id: ids.join(','),
    key: apiKey,
  })
  const videoRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?${videoParams}`)
  if (!videoRes.ok) {
    throw new Error(`YouTube videos lookup failed: ${videoRes.status}`)
  }

  const videoBody = (await videoRes.json()) as VideosResponse
  return (videoBody.items ?? []).map((item) => ({
    videoId: item.id,
    title: item.snippet?.title ?? '',
    channelTitle: item.snippet?.channelTitle ?? '',
    viewCount: Number(item.statistics?.viewCount ?? 0),
  }))
}

function toResponse(candidate: Candidate, source: string) {
  return {
    source,
    videoId: candidate.videoId,
    title: candidate.title,
    channelTitle: candidate.channelTitle,
    viewCount: candidate.viewCount,
    url: `https://www.youtube.com/watch?v=${candidate.videoId}`,
  }
}

function isLikelySongMatch(candidate: Candidate, artist: string, songTitle: string) {
  const haystack = normalize(`${candidate.title} ${candidate.channelTitle}`)
  return containsAllTokens(haystack, artist) && containsAllTokens(haystack, songTitle)
}

function isOfficialMusicVideo(candidate: Candidate) {
  const title = normalize(candidate.title)
  const channel = normalize(candidate.channelTitle)
  return (
    (title.includes('official') && (title.includes('music video') || title.includes('mv'))) ||
    channel.includes('official')
  )
}

function isLiveClip(candidate: Candidate) {
  const text = normalize(`${candidate.title} ${candidate.channelTitle}`)
  return text.includes('live') || text.includes('performance') || text.includes('stage')
}

function containsAllTokens(haystack: string, value: string) {
  const tokens = normalize(value)
    .split(' ')
    .filter((token) => token.length > 1)
  return tokens.length === 0 || tokens.every((token) => haystack.includes(token))
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9가-힣]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
