import { AbsoluteFill } from 'remotion'
import VideoLayer from './layers/VideoLayer'
import SubtitleLayer from './layers/SubtitleLayer'
import CommentLayer from './layers/CommentLayer'
import BarLayer from '../BarLayer'
import TextOverlayLayer from '../TextOverlayLayer'
import type { ClipInput, Segment, Comment } from '../types'

export interface LayoutAProps extends Record<string, unknown> {
  clip: ClipInput
  segments: Segment[]
  comments: Comment[]
  preview_path: string
}

export default function LayoutA({ clip, segments, comments, preview_path }: LayoutAProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <VideoLayer
        src={preview_path}
        startSec={clip.start_sec}
        endSec={clip.end_sec}
        bgmUrl={clip.bgm_url}
        bgmVolume={clip.bgm_volume}
        originalVolume={clip.original_volume}
        bgmStartSec={clip.bgm_start_sec ?? 0}
      />
      <BarLayer enabled={clip.bar_enabled} />
      <TextOverlayLayer enabled={clip.bar_enabled} overlays={clip.text_overlays} />
      <SubtitleLayer segments={segments} clipStartSec={clip.start_sec} style={clip.subtitle_style} />
      <CommentLayer comments={comments} style={clip.comment_style} />
    </AbsoluteFill>
  )
}
