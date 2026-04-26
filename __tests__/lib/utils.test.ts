import { describe, it, expect } from 'vitest'
import { formatTime } from '@/lib/utils/time'
import { extractLayout } from '@/lib/utils/template'

describe('formatTime', () => {
  it('formats zero', () => {
    expect(formatTime(0)).toBe('0:00.0')
  })

  it('formats seconds under a minute', () => {
    expect(formatTime(5.5)).toBe('0:05.5')
  })

  it('formats exactly one minute', () => {
    expect(formatTime(60)).toBe('1:00.0')
  })

  it('formats minutes and seconds', () => {
    expect(formatTime(90)).toBe('1:30.0')
  })

  it('formats millisecond digit', () => {
    expect(formatTime(1.25)).toBe('0:01.2')
  })

  it('pads seconds below 10', () => {
    expect(formatTime(65)).toBe('1:05.0')
  })
})

describe('extractLayout', () => {
  it('extracts LAYOUT_A', () => {
    expect(extractLayout({ layout: 'LAYOUT_A' })).toBe('LAYOUT_A')
  })

  it('extracts LAYOUT_B', () => {
    expect(extractLayout({ layout: 'LAYOUT_B' })).toBe('LAYOUT_B')
  })

  it('extracts LAYOUT_C', () => {
    expect(extractLayout({ layout: 'LAYOUT_C' })).toBe('LAYOUT_C')
  })

  it('returns empty string when layout key is absent', () => {
    expect(extractLayout({ other: 'value' })).toBe('')
  })

  it('returns empty string for null', () => {
    expect(extractLayout(null)).toBe('')
  })

  it('returns empty string for array', () => {
    expect(extractLayout([])).toBe('')
  })

  it('returns empty string when layout value is not a string', () => {
    expect(extractLayout({ layout: 42 })).toBe('')
  })
})
