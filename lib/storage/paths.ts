export function getBgmStoragePath(clipId: string, bgmUrl: string | null): string | null {
  if (!bgmUrl) return null

  try {
    const url = new URL(bgmUrl)
    const match = url.pathname.match(/\/storage\/v1\/object\/(?:sign|public)\/sources\/(bgm\/[^/]+)$/)
    if (match?.[1]) return decodeURIComponent(match[1])
  } catch {
    // Manual or legacy BGM URLs are not Supabase Storage objects.
  }

  return `bgm/${clipId}.mp3`
}
