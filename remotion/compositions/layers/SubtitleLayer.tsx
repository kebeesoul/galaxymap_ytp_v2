import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import type { Segment } from '../../types'

interface Props {
  segments: Segment[]
  clipStartSec: number
}

export default function SubtitleLayer({ segments, clipStartSec }: Props) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  // frame 0 = clip.start_sec in the original video
  const absoluteSec = frame / fps + clipStartSec

  const active = segments.find(
    s => absoluteSec >= s.start_sec && absoluteSec < s.end_sec
  )

  if (!active) return null

  const segmentStartFrame = Math.round((active.start_sec - clipStartSec) * fps)
  const framesSinceStart = frame - segmentStartFrame
  const opacity = interpolate(framesSinceStart, [0, 4], [0, 1], { extrapolateRight: 'clamp' })

  return (
    <div
      style={{
        position: 'absolute',
        top: '10%',
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        padding: '0 56px',
        opacity,
      }}
    >
      <div
        style={{
          backgroundColor: 'rgba(0,0,0,0.72)',
          borderRadius: 16,
          padding: '14px 32px',
          maxWidth: 800,
        }}
      >
        <p
          style={{
            color: '#ffffff',
            fontSize: 42,
            fontWeight: 700,
            lineHeight: 1.25,
            textAlign: 'center',
            margin: 0,
            letterSpacing: '-0.5px',
          }}
        >
          {active.text}
        </p>
      </div>
    </div>
  )
}
