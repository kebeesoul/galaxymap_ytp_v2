import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  createLocalSourcePlaybackUrl,
  localSourcePath,
  parseLocalSourceKey,
  sourceKeyUid,
} from '@/lib/source-storage'

describe('local source storage', () => {
  it('parses UID-prefixed source keys', () => {
    const key = 'user-1/sources/preview/video-1.mp4'

    expect(parseLocalSourceKey(key)).toEqual({
      ownerUid: 'user-1',
      videoId: 'video-1',
      filename: 'video-1.mp4',
    })
    expect(sourceKeyUid(key)).toBe('user-1')
  })

  it('resolves source files under workspace ingest', () => {
    expect(localSourcePath('user-1/sources/preview/video-1.mp4')).toBe(
      path.join(process.cwd(), 'workspace', 'ingest', 'user-1', 'sources', 'preview', 'video-1.mp4'),
    )
  })

  it('rejects invalid local source keys', () => {
    expect(() => parseLocalSourceKey('../escape/sources/preview/video.mp4')).toThrow(
      'invalid local source key',
    )
    expect(() => parseLocalSourceKey('user-1/sources/preview/video.mov')).toThrow(
      'invalid local source filename',
    )
  })

  it('returns an authenticated local source route URL', () => {
    expect(createLocalSourcePlaybackUrl('project-1')).toBe('/api/source-file?project_id=project-1')
  })
})
