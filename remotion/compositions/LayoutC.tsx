import { AbsoluteFill } from 'remotion'
import VideoLayer from './layers/VideoLayer'
import CommentLayer from './layers/CommentLayer'
import type { ClipInput, Comment } from '../types'

export interface LayoutCProps extends Record<string, unknown> {
  clip: ClipInput
  comments: Comment[]
  preview_path: string
}

export default function LayoutC({ clip, comments, preview_path }: LayoutCProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <VideoLayer
        src={preview_path}
        startSec={clip.start_sec}
        endSec={clip.end_sec}
        bgmUrl={clip.bgm_url}
        bgmVolume={clip.bgm_volume}
        originalVolume={clip.original_volume}
      />
      <CommentLayer comments={comments} />
    </AbsoluteFill>
  )
}
