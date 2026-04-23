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

export interface RenderInput {
  clip: { start_sec: number; end_sec: number }
  layout: 'LAYOUT_A' | 'LAYOUT_B' | 'LAYOUT_C'
  segments: Segment[]
  comments: Comment[]
  preview_path: string
}
