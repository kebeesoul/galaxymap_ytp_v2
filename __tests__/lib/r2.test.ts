import { describe, expect, it } from 'vitest'
import {
  createR2Client,
  createSourceDownloadUrl,
  downloadSourceObject,
  getR2Config,
} from '@/lib/r2'

describe('R2 source storage', () => {
  it('is temporarily disabled and does not read external R2 env vars', async () => {
    process.env.R2_ENDPOINT = 'not-a-url'

    expect(() => getR2Config()).toThrow('temporarily disabled')
    expect(() => createR2Client()).toThrow('temporarily disabled')
    await expect(createSourceDownloadUrl('uid/sources/preview/video.mp4')).rejects.toThrow(
      'temporarily disabled',
    )
    await expect(downloadSourceObject('uid/sources/preview/video.mp4', '/tmp/video.mp4')).rejects.toThrow(
      'temporarily disabled',
    )
  })
})
