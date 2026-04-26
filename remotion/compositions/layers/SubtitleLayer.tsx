import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import type { Segment, SubtitleStyle } from '../../types'

interface Props {
  segments: Segment[]
  clipStartSec: number
  style?: SubtitleStyle | null
}

const DEFAULTS: SubtitleStyle = { position: 'bottom', fontSize: 42, bgOpacity: 0.72 }

export default function SubtitleLayer({ segments, clipStartSec, style }: Props) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const absoluteSec = frame / fps + clipStartSec
  const active = segments.find(s => absoluteSec >= s.start_sec && absoluteSec < s.end_sec)
  if (!active) return null

  const segmentStartFrame = Math.round((active.start_sec - clipStartSec) * fps)
  const opacity = interpolate(frame - segmentStartFrame, [0, 4], [0, 1], { extrapolateRight: 'clamp' })

  const position = style?.position ?? DEFAULTS.position
  const fontSize = style?.fontSize ?? DEFAULTS.fontSize
  const bgOpacity = style?.bgOpacity ?? DEFAULTS.bgOpacity

  const top = position === 'top' ? '10%' : position === 'center' ? '50%' : '75%'
  const transform = position === 'center' ? 'translateY(-50%)' : undefined

  return (
    <div
      style={{
        position: 'absolute',
        top,
        transform,
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
          backgroundColor: `rgba(0,0,0,${bgOpacity})`,
          borderRadius: 16,
          padding: '14px 32px',
          maxWidth: 800,
        }}
      >
        <p
          style={{
            color: '#ffffff',
            fontSize,
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
