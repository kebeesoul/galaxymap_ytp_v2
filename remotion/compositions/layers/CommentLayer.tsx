import { spring, useCurrentFrame, useVideoConfig } from 'remotion'
import type { Comment, CommentStyle } from '../../types'

interface Props {
  comments: Comment[]
  style?: CommentStyle | null
}

const DEFAULTS: CommentStyle = {
  theme: 'white-on-black',
  fontFamily: 'Noto Sans KR',
  fontScale: 1,
  durationSec: 5,
}

export default function CommentLayer({ comments, style }: Props) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  if (comments.length === 0) return null

  const fontFamily = style?.fontFamily ?? DEFAULTS.fontFamily
  const fontScale = style?.fontScale ?? DEFAULTS.fontScale
  const durationSec = style?.durationSec ?? DEFAULTS.durationSec

  const fontStack = `'${fontFamily}', 'Apple SD Gothic Neo', sans-serif`

  // One comment at a time — cycle through `comments` every `durationSec`.
  const totalSec = frame / fps
  const slot = Math.floor(totalSec / durationSec)
  const activeIdx = slot % comments.length
  const slotStartFrame = slot * durationSec * fps
  const inFrame = Math.max(0, frame - slotStartFrame)

  const opacity = spring({ frame: inFrame, fps, from: 0, to: 1, config: { damping: 200 } })
  const translateY = spring({ frame: inFrame, fps, from: 18, to: 0, config: { damping: 200 } })

  const active = comments[activeIdx]
  const usernameSize = Math.round(20 * fontScale)
  const bodySize = Math.round(25 * fontScale)
  const positions = [
    { left: '8%', top: '27%', rotate: '-1.4deg', width: '70%' },
    { left: '20%', top: '52%', rotate: '0.8deg', width: '72%' },
    { left: '7%', top: '68%', rotate: '-0.5deg', width: '80%' },
    { left: '25%', top: '36%', rotate: '1.2deg', width: '66%' },
  ]
  const position = positions[activeIdx % positions.length]

  return (
    <div
      style={{
        position: 'absolute',
        left: position.left,
        top: position.top,
        width: position.width,
        opacity,
        transform: `translateY(${translateY}px) rotate(${position.rotate})`,
        filter: 'drop-shadow(0 7px 12px rgba(0,0,0,0.28))',
      }}
    >
      <div
        key={activeIdx}
        style={{
          backgroundColor: 'rgba(255,255,255,0.96)',
          color: '#111',
          padding: '14px 20px 16px',
          clipPath: 'polygon(0 3%, 3% 0, 97% 2%, 100% 7%, 99% 94%, 96% 100%, 3% 98%, 0 93%)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#d9d9d9', flex: '0 0 auto' }} />
          <p style={{ color: '#575757', fontSize: usernameSize, fontWeight: 700, fontFamily: fontStack, margin: 0 }}>
            {active.username}
          </p>
        </div>
        <p style={{ color: '#111', fontSize: bodySize, fontWeight: 600, fontFamily: fontStack, margin: '9px 0 0', lineHeight: 1.34 }}>
          {active.body}
        </p>
      </div>
    </div>
  )
}
