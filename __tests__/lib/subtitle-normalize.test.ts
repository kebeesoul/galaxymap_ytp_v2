import { describe, expect, it } from 'vitest'
import { extendFinalSegmentToClipEnd } from '@/lib/subtitles/normalize'

describe('extendFinalSegmentToClipEnd', () => {
  it('extends the final subtitle through the clip end', () => {
    expect(extendFinalSegmentToClipEnd([
      { text: 'first', start_sec: 10, end_sec: 12 },
      { text: 'last', start_sec: 12, end_sec: 12 },
    ], 15)).toEqual([
      { text: 'first', start_sec: 10, end_sec: 12 },
      { text: 'last', start_sec: 12, end_sec: 15 },
    ])
  })

  it('does not shorten a final subtitle that already extends farther', () => {
    expect(extendFinalSegmentToClipEnd([
      { text: 'last', start_sec: 12, end_sec: 16 },
    ], 15)[0].end_sec).toBe(16)
  })
})
