import { AbsoluteFill } from 'remotion'
import VideoLayer from './layers/VideoLayer'
import SubtitleLayer from './layers/SubtitleLayer'

interface Segment {
  text: string
  start_sec: number
  end_sec: number
}

export interface LayoutBProps extends Record<string, unknown> {
  previewPath: string
  segments: Segment[]
}

export default function LayoutB({ previewPath, segments }: LayoutBProps) {
  return (
    <AbsoluteFill>
      <VideoLayer previewPath={previewPath} />
      <SubtitleLayer segments={segments} />
    </AbsoluteFill>
  )
}
