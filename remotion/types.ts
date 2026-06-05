export interface Segment {
  text: string
  start_sec: number
  end_sec: number
}

export interface Comment {
  username: string
  body: string
  likes_count: number
}

export type StyleTheme = 'white-on-black' | 'black-on-white'

export const FONT_FAMILIES = [
  'Noto Sans KR',
  'Black Han Sans',
  'Nanum Gothic',
  'Gothic A1',
  'Noto Serif KR',
  'Gowun Dodum',
] as const

export type FontFamily = typeof FONT_FAMILIES[number]

export interface SubtitleStyle {
  position: 'top' | 'center' | 'bottom'
  fontSize: number
  bgOpacity: number
  theme: StyleTheme
  fontFamily: string
  blackBars?: boolean
}

export interface CommentStyle {
  theme: StyleTheme
  fontFamily: string
  /** Font size multiplier (0.8 – 1.2) — base sizes get scaled in CommentLayer */
  fontScale: number
  /** Seconds each comment stays on screen before cycling to the next (3 – 8) */
  durationSec: number
}

export interface ClipInput {
  start_sec: number
  end_sec: number
  bgm_url?: string | null
  bgm_volume?: number
  original_volume?: number
  subtitle_style?: SubtitleStyle | null
  comment_style?: CommentStyle | null
}

export interface RenderInput {
  clip: ClipInput
  layout: 'LAYOUT_A' | 'LAYOUT_B' | 'LAYOUT_C'
  segments: Segment[]
  comments: Comment[]
  preview_path: string
}
