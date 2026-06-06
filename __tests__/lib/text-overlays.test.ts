import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEXT_OVERLAY,
  clampTextOverlayPosition,
  textOverlaySchema,
} from '@/lib/text-overlays'

const validOverlay = {
  id: 'overlay-1',
  clip_id: 'clip-1',
  ...DEFAULT_TEXT_OVERLAY,
}

describe('text overlays', () => {
  it('accepts the shared editor and Remotion data contract', () => {
    expect(textOverlaySchema.parse(validOverlay)).toEqual(validOverlay)
  })

  it('rejects positions outside the selected bar zone', () => {
    expect(() => textOverlaySchema.parse({ ...validOverlay, y: 1.1 })).toThrow()
  })

  it('rejects fonts outside the fixed registry', () => {
    expect(() => textOverlaySchema.parse({ ...validOverlay, font_key: 'unknown' })).toThrow()
  })

  it('clamps drag coordinates to the bar bounds', () => {
    expect(clampTextOverlayPosition(-0.25)).toBe(0)
    expect(clampTextOverlayPosition(0.4)).toBe(0.4)
    expect(clampTextOverlayPosition(1.25)).toBe(1)
  })
})
