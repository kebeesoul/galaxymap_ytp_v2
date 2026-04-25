import { AbsoluteFill } from 'remotion'
import VideoLayer from './layers/VideoLayer'
import SubtitleLayer from './layers/SubtitleLayer'
import type { ClipInput, Segment } from '../types'

export interface LayoutBProps extends Record<string, unknown> {
  clip: ClipInput
  segments: Segment[]
  preview_path: string
}

export default function LayoutB({ clip, segments, preview_path }: LayoutBProps) {
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
      <SubtitleLayer segments={segments} clipStartSec={clip.start_sec} />
    </AbsoluteFill>
  )
}
