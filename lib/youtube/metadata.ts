export interface YoutubeMetadata {
  videoId: string
  title: string
  durationSec: number
  thumbnailUrl: string
}

export async function fetchMetadata(videoId: string): Promise<YoutubeMetadata> {
  // TODO: Phase 1 — delegate to Python worker via /ingest; worker calls yt-dlp
  void videoId
  throw new Error('not implemented')
}
