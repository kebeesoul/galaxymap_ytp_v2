import { AbsoluteFill } from 'remotion'
import VideoLayer from './layers/VideoLayer'
import SubtitleLayer from './layers/SubtitleLayer'
import type { Segment } from '../types'

export interface LayoutBProps extends Record<string, unknown> {
  clip: { start_sec: number; end_sec: number }
  segments: Segment[]
  preview_path: string
}

export default function LayoutB({ clip, segments, preview_path }: LayoutBProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <VideoLayer src={preview_path} startSec={clip.start_sec} endSec={clip.end_sec} />
      <SubtitleLayer segments={segments} clipStartSec={clip.start_sec} />
    </AbsoluteFill>
  )
}
