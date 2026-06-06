export const FONT_REGISTRY = {
  montserrat: {
    label: 'Montserrat',
    family: 'Montserrat',
    weight: 700,
    googleFontName: 'Montserrat',
  },
  inter: {
    label: 'Inter',
    family: 'Inter',
    weight: 700,
    googleFontName: 'Inter',
  },
  bebas: {
    label: 'Bebas Neue',
    family: 'Bebas Neue',
    weight: 400,
    googleFontName: 'Bebas Neue',
  },
  playfair: {
    label: 'Playfair Display',
    family: 'Playfair Display',
    weight: 700,
    googleFontName: 'Playfair Display',
  },
  oswald: {
    label: 'Oswald',
    family: 'Oswald',
    weight: 700,
    googleFontName: 'Oswald',
  },
  roboto: {
    label: 'Roboto',
    family: 'Roboto',
    weight: 700,
    googleFontName: 'Roboto',
  },
  noto_kr: {
    label: 'Noto Sans KR',
    family: 'Noto Sans KR',
    weight: 700,
    googleFontName: 'Noto Sans KR',
  },
  gmarket: {
    label: 'Gmarket Sans',
    family: 'Gmarket Sans',
    weight: 700,
    googleFontName: null,
  },
  nanum_square: {
    label: 'NanumSquare',
    family: 'NanumSquare',
    weight: 700,
    googleFontName: null,
  },
  gowun: {
    label: 'Gowun Dodum',
    family: 'Gowun Dodum',
    weight: 400,
    googleFontName: 'Gowun Dodum',
  },
  black_han: {
    label: 'Black Han Sans',
    family: 'Black Han Sans',
    weight: 400,
    googleFontName: 'Black Han Sans',
  },
  jua: {
    label: 'Jua',
    family: 'Jua',
    weight: 400,
    googleFontName: 'Jua',
  },
} as const

export type FontKey = keyof typeof FONT_REGISTRY

export const FONT_KEYS = Object.keys(FONT_REGISTRY) as FontKey[]
export const DEFAULT_FONT_KEY: FontKey = 'noto_kr'

export const GOOGLE_FONTS_STYLESHEET =
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Black+Han+Sans&family=Gowun+Dodum&family=Inter:wght@700&family=Jua&family=Montserrat:wght@700&family=Noto+Sans+KR:wght@700&family=Oswald:wght@700&family=Playfair+Display:wght@700&family=Roboto:wght@700&display=swap'

const LEGACY_FONT_KEYS: Record<string, FontKey> = {
  'Noto Sans KR': 'noto_kr',
  'Black Han Sans': 'black_han',
  'Nanum Gothic': 'nanum_square',
  'Gothic A1': 'noto_kr',
  'Noto Serif KR': 'playfair',
  'Gowun Dodum': 'gowun',
}

export function isFontKey(value: unknown): value is FontKey {
  return typeof value === 'string' && value in FONT_REGISTRY
}

export function resolveFontKey(value: unknown): FontKey {
  if (isFontKey(value)) return value
  if (typeof value === 'string') {
    const registryEntry = FONT_KEYS.find((key) => FONT_REGISTRY[key].family === value)
    if (registryEntry) return registryEntry
    return LEGACY_FONT_KEYS[value] ?? DEFAULT_FONT_KEY
  }
  return DEFAULT_FONT_KEY
}

export function getFontFamily(fontKey: FontKey): string {
  return FONT_REGISTRY[fontKey].family
}

export function getFontWeight(fontKey: FontKey): number {
  return FONT_REGISTRY[fontKey].weight
}
