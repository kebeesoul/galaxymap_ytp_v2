import { AbsoluteFill } from 'remotion'
import VideoLayer from './layers/VideoLayer'
import CommentLayer from './layers/CommentLayer'

interface Comment {
  username: string
  body: string
  likes_count: number
}

export interface LayoutCProps extends Record<string, unknown> {
  previewPath: string
  comments: Comment[]
}

export default function LayoutC({ previewPath, comments }: LayoutCProps) {
  return (
    <AbsoluteFill>
      <VideoLayer previewPath={previewPath} />
      <CommentLayer comments={comments} />
    </AbsoluteFill>
  )
}
