import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FONT_KEY,
  FONT_KEYS,
  FONT_REGISTRY,
  getFontFamily,
  getFontWeight,
  isFontKey,
  resolveFontKey,
} from '@/lib/fonts'

describe('font registry', () => {
  it('contains only the approved 12 font keys', () => {
    expect(FONT_KEYS).toEqual([
      'montserrat',
      'inter',
      'bebas',
      'playfair',
      'oswald',
      'roboto',
      'noto_kr',
      'gmarket',
      'nanum_square',
      'gowun',
      'black_han',
      'jua',
    ])
    expect(Object.keys(FONT_REGISTRY)).toHaveLength(12)
  })

  it('resolves registry keys and legacy family names', () => {
    expect(isFontKey('gmarket')).toBe(true)
    expect(isFontKey('comic_sans')).toBe(false)
    expect(resolveFontKey('Black Han Sans')).toBe('black_han')
    expect(resolveFontKey('Nanum Gothic')).toBe('nanum_square')
    expect(resolveFontKey('unknown')).toBe(DEFAULT_FONT_KEY)
    expect(getFontFamily('noto_kr')).toBe('Noto Sans KR')
    expect(getFontWeight('bebas')).toBe(400)
  })

  it('marks only Gmarket Sans and NanumSquare as local fonts', () => {
    const localKeys = FONT_KEYS.filter((key) => FONT_REGISTRY[key].googleFontName === null)
    expect(localKeys).toEqual(['gmarket', 'nanum_square'])
  })
})
