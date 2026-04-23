import { AbsoluteFill } from 'remotion'
import VideoLayer from './layers/VideoLayer'
import SubtitleLayer from './layers/SubtitleLayer'
import CommentLayer from './layers/CommentLayer'

interface Segment {
  text: string
  start_sec: number
  end_sec: number
}

interface Comment {
  username: string
  body: string
  likes_count: number
}

export interface LayoutAProps extends Record<string, unknown> {
  previewPath: string
  segments: Segment[]
  comments: Comment[]
}

export default function LayoutA({ previewPath, segments, comments }: LayoutAProps) {
  return (
    <AbsoluteFill>
      <VideoLayer previewPath={previewPath} />
      <SubtitleLayer segments={segments} />
      <CommentLayer comments={comments} />
    </AbsoluteFill>
  )
}
