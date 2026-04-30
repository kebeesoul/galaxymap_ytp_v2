import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import type { Segment, SubtitleStyle } from '../../types'

interface Props {
  segments: Segment[]
  clipStartSec: number
  style?: SubtitleStyle | null
}

const DEFAULTS: SubtitleStyle = {
  position: 'bottom',
  fontSize: 42,
  bgOpacity: 0.72,
  theme: 'white-on-black',
  fontFamily: 'Noto Sans KR',
}

export default function SubtitleLayer({ segments, clipStartSec, style }: Props) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const absoluteSec = frame / fps + clipStartSec
  const active = segments.find(s => absoluteSec >= s.start_sec && absoluteSec < s.end_sec)
  if (!active || !active.text.trim()) return null

  const segmentStartFrame = Math.round((active.start_sec - clipStartSec) * fps)
  const opacity = interpolate(frame - segmentStartFrame, [0, 4], [0, 1], { extrapolateRight: 'clamp' })

  const position = style?.position ?? DEFAULTS.position
  const fontSize = style?.fontSize ?? DEFAULTS.fontSize
  const bgOpacity = style?.bgOpacity ?? DEFAULTS.bgOpacity
  const theme = style?.theme ?? DEFAULTS.theme
  const fontFamily = style?.fontFamily ?? DEFAULTS.fontFamily

  const top = position === 'top' ? '10%' : position === 'center' ? '50%' : '75%'
  const transform = position === 'center' ? 'translateY(-50%)' : undefined

  const textColor = theme === 'black-on-white' ? '#000000' : '#ffffff'
  const bgRgb = theme === 'black-on-white' ? '255,255,255' : '0,0,0'

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
          backgroundColor: `rgba(${bgRgb},${bgOpacity})`,
          borderRadius: 16,
          padding: '14px 32px',
          maxWidth: 800,
        }}
      >
        <p
          style={{
            color: textColor,
            fontSize,
            fontWeight: 700,
            fontFamily: `'${fontFamily}', 'Apple SD Gothic Neo', sans-serif`,
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
