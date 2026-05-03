/**
 * Extract YouTube video ID from various URL formats.
 * Returns null if URL is invalid or not a YouTube URL.
 */
export function extractYouTubeVideoId(url: string): string | null {
  if (!url || typeof url !== 'string') return null

  const trimmed = url.trim()

  // Patterns to match:
  // https://www.youtube.com/watch?v=ID
  // https://youtu.be/ID
  // https://www.youtube.com/shorts/ID
  // https://youtube.com/embed/ID

  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ]

  for (const pattern of patterns) {
    const match = trimmed.match(pattern)
    if (match?.[1]) return match[1]
  }

  return null
}

export function buildYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}
