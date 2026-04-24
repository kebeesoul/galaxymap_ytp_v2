import { AbsoluteFill } from 'remotion'
import VideoLayer from './layers/VideoLayer'
import CommentLayer from './layers/CommentLayer'
import type { Comment } from '../types'

export interface LayoutCProps extends Record<string, unknown> {
  clip: { start_sec: number; end_sec: number }
  comments: Comment[]
  preview_path: string
}

export default function LayoutC({ clip, comments, preview_path }: LayoutCProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <VideoLayer src={preview_path} startSec={clip.start_sec} endSec={clip.end_sec} />
      <CommentLayer comments={comments} />
    </AbsoluteFill>
  )
}
