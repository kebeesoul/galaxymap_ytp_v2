import { describe, expect, it } from 'vitest'
import { BAR_COLOR, BAR_HEIGHT_PERCENT } from '@/lib/video-bars'

describe('video bar constants', () => {
  it('keeps the top and bottom bars fixed at black and 15 percent', () => {
    expect(BAR_HEIGHT_PERCENT).toBe(15)
    expect(BAR_COLOR).toBe('#000000')
  })
})
