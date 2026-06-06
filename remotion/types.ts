import type { FontKey } from '../lib/fonts'
import type { TextOverlay } from '../lib/text-overlays'

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

export interface SubtitleStyle {
  position: 'top' | 'center' | 'bottom'
  fontSize: number
  bgOpacity: number
  theme: StyleTheme
  font_key: FontKey
}

export interface CommentStyle {
  theme: StyleTheme
  font_key: FontKey
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
  bgm_start_sec?: number
  bar_enabled?: boolean
  subtitle_style?: SubtitleStyle | null
  comment_style?: CommentStyle | null
  text_overlays?: TextOverlay[]
}

export interface RenderInput {
  clip: ClipInput
  layout: 'LAYOUT_A' | 'LAYOUT_B' | 'LAYOUT_C'
  segments: Segment[]
  comments: Comment[]
  preview_path: string
}
