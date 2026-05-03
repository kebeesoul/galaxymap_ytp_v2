interface YouTubeSearchResult {
  videoId: string | null
  query: string
}

/**
 * Search YouTube for a track and return the first result's video ID.
 * Returns null if no results or API error.
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
  url.searchParams.set('maxResults', '1')
  url.searchParams.set('videoEmbeddable', 'true')

  const res = await fetch(url.toString())

  if (!res.ok) {
    console.error(`[youtube-search] HTTP ${res.status} for query: ${query}`)
    return { videoId: null, query }
  }

  const data: unknown = await res.json()

  // Defensive parsing — YouTube response shape
  if (
    !data ||
    typeof data !== 'object' ||
    !('items' in data) ||
    !Array.isArray((data as { items: unknown }).items)
  ) {
    return { videoId: null, query }
  }

  const items = (data as { items: Array<{ id?: { videoId?: string } }> }).items

  if (items.length === 0) return { videoId: null, query }

  const videoId = items[0]?.id?.videoId ?? null
  return { videoId, query }
}
