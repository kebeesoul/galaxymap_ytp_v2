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

export interface SubtitleStyle {
  position: 'top' | 'center' | 'bottom'
  fontSize: number
  bgOpacity: number
}

export interface ClipInput {
  start_sec: number
  end_sec: number
  bgm_url?: string | null
  bgm_volume?: number
  original_volume?: number
  subtitle_style?: SubtitleStyle | null
}

export interface RenderInput {
  clip: ClipInput
  layout: 'LAYOUT_A' | 'LAYOUT_B' | 'LAYOUT_C'
  segments: Segment[]
  comments: Comment[]
  preview_path: string
}
