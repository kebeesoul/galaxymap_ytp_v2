import { AbsoluteFill } from 'remotion'
import VideoLayer from './layers/VideoLayer'
import SubtitleLayer from './layers/SubtitleLayer'
import CommentLayer from './layers/CommentLayer'
import type { Segment, Comment } from '../types'

export interface LayoutAProps extends Record<string, unknown> {
  clip: { start_sec: number; end_sec: number }
  segments: Segment[]
  comments: Comment[]
  preview_path: string
}

export default function LayoutA({ clip, segments, comments, preview_path }: LayoutAProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <VideoLayer src={preview_path} startSec={clip.start_sec} endSec={clip.end_sec} />
      <SubtitleLayer segments={segments} clipStartSec={clip.start_sec} />
      <CommentLayer comments={comments} />
    </AbsoluteFill>
  )
}
