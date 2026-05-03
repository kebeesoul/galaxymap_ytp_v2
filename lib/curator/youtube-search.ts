interface YouTubeSearchResult {
  videoId: string | null
  ytTitle: string | null
  query: string
}

/**
 * Search YouTube for a track and return the best-matching video ID.
 * Fetches up to 5 results and requires the artist name to appear in the
 * video title — prevents hallucinated songs from passing verification.
 * Returns null if no matching result is found.
 */
export async function searchYouTube(
  artist: string,
  songTitle: string,
): Promise<YouTubeSearchResult> {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    throw new Error('YOUTUBE_API_KEY not set')
  }

  const query = `${artist} ${songTitle} live`
  const url = new URL('https://www.googleapis.com/youtube/v3/search')
  url.searchParams.set('key', apiKey)
  url.searchParams.set('part', 'snippet')
  url.searchParams.set('q', query)
  url.searchParams.set('type', 'video')
  url.searchParams.set('maxResults', '5')
  url.searchParams.set('videoEmbeddable', 'true')

  const res = await fetch(url.toString())

  if (!res.ok) {
    console.error(`[youtube-search] HTTP ${res.status} for query: ${query}`)
    return { videoId: null, ytTitle: null, query }
  }

  const data: unknown = await res.json()

  if (
    !data ||
    typeof data !== 'object' ||
    !('items' in data) ||
    !Array.isArray((data as { items: unknown }).items)
  ) {
    return { videoId: null, ytTitle: null, query }
  }

  type YTItem = { id?: { videoId?: string }; snippet?: { title?: string } }
  const items = (data as { items: YTItem[] }).items

  if (items.length === 0) return { videoId: null, ytTitle: null, query }

  // Require the artist name (any single token ≥ 2 chars) to appear in the video
  // title — filters out completely unrelated results returned for hallucinated songs.
  const artistTokens = artist
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length >= 2)

  for (const item of items) {
    const videoId = item.id?.videoId ?? null
    const ytTitle = item.snippet?.title ?? null
    if (!videoId || !ytTitle) continue

    const titleLower = ytTitle.toLowerCase()
    const artistMatches = artistTokens.some(token => titleLower.includes(token))
    if (artistMatches) {
      return { videoId, ytTitle, query }
    }
  }

  // No result passed artist validation — treat as not found
  console.warn(`[youtube-search] no artist-matching result for: ${query}`)
  return { videoId: null, ytTitle: null, query }
}
