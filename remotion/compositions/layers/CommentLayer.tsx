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

  const theme = style?.theme ?? DEFAULTS.theme
  const fontFamily = style?.fontFamily ?? DEFAULTS.fontFamily
  const fontScale = style?.fontScale ?? DEFAULTS.fontScale
  const durationSec = style?.durationSec ?? DEFAULTS.durationSec

  const bgColor = theme === 'black-on-white' ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.82)'
  const usernameColor = theme === 'black-on-white' ? 'rgba(0,0,0,0.9)' : '#ffffff'
  const bodyColor = theme === 'black-on-white' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.88)'
  const fontStack = `'${fontFamily}', 'Apple SD Gothic Neo', sans-serif`

  // One comment at a time — cycle through `comments` every `durationSec`.
  const totalSec = frame / fps
  const slot = Math.floor(totalSec / durationSec)
  const activeIdx = slot % comments.length
  const slotStartFrame = slot * durationSec * fps
  const inFrame = Math.max(0, frame - slotStartFrame)

  const opacity = spring({ frame: inFrame, fps, from: 0, to: 1, config: { damping: 200 } })
  const translateY = spring({ frame: inFrame, fps, from: 24, to: 0, config: { damping: 200 } })

  const active = comments[activeIdx]
  const usernameSize = Math.round(26 * fontScale)
  const bodySize = Math.round(24 * fontScale)

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '7%',
        left: 0,
        right: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: '0 48px',
      }}
    >
      <div
        key={activeIdx}
        style={{
          backgroundColor: bgColor,
          borderRadius: 16,
          padding: '14px 24px',
          opacity,
          transform: `translateY(${translateY}px)`,
        }}
      >
        <p
          style={{
            color: usernameColor,
            fontSize: usernameSize,
            fontWeight: 700,
            fontFamily: fontStack,
            lineHeight: 1,
            margin: '0 0 6px 0',
          }}
        >
          {active.username}
        </p>
        <p
          style={{
            color: bodyColor,
            fontSize: bodySize,
            fontFamily: fontStack,
            margin: 0,
            lineHeight: 1.45,
          }}
        >
          {active.body}
        </p>
      </div>
    </div>
  )
}
