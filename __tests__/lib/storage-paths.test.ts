import { describe, expect, it } from 'vitest'
import { getBgmStoragePath } from '@/lib/storage/paths'

describe('getBgmStoragePath', () => {
  it('extracts the actual BGM object path from a Supabase signed URL', () => {
    const url = 'https://example.supabase.co/storage/v1/object/sign/sources/bgm/clip-1.wav?token=abc'
    expect(getBgmStoragePath('clip-1', url)).toBe('bgm/clip-1.wav')
  })

  it('falls back to the legacy mp3 path for non-storage URLs', () => {
    expect(getBgmStoragePath('clip-1', 'https://cdn.example.com/audio.wav')).toBe('bgm/clip-1.mp3')
  })

  it('returns null when no BGM URL exists', () => {
    expect(getBgmStoragePath('clip-1', null)).toBeNull()
  })
})
