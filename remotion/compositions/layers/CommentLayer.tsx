import { spring, useCurrentFrame, useVideoConfig } from 'remotion'
import type { Comment, CommentStyle } from '../../types'

const STAGGER_FRAMES = 8

interface Props {
  comments: Comment[]
  style?: CommentStyle | null
}

const DEFAULTS: CommentStyle = {
  theme: 'white-on-black',
  fontFamily: 'Noto Sans KR',
}

export default function CommentLayer({ comments, style }: Props) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const visible = comments.slice(0, 3)

  const theme = style?.theme ?? DEFAULTS.theme
  const fontFamily = style?.fontFamily ?? DEFAULTS.fontFamily

  const bgColor = theme === 'black-on-white' ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.82)'
  const usernameColor = theme === 'black-on-white' ? 'rgba(0,0,0,0.9)' : '#ffffff'
  const bodyColor = theme === 'black-on-white' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.88)'
  const fontStack = `'${fontFamily}', 'Apple SD Gothic Neo', sans-serif`

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '7%',
        left: 0,
        right: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '0 48px',
      }}
    >
      {visible.map((c, i) => {
        const delayedFrame = Math.max(0, frame - i * STAGGER_FRAMES)
        const opacity = spring({ frame: delayedFrame, fps, from: 0, to: 1, config: { damping: 200 } })
        const translateY = spring({ frame: delayedFrame, fps, from: 24, to: 0, config: { damping: 200 } })

        return (
          <div
            key={i}
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
                fontSize: 26,
                fontWeight: 700,
                fontFamily: fontStack,
                lineHeight: 1,
                margin: '0 0 6px 0',
              }}
            >
              {c.username}
            </p>
            <p
              style={{
                color: bodyColor,
                fontSize: 24,
                fontFamily: fontStack,
                margin: 0,
                lineHeight: 1.45,
              }}
            >
              {c.body}
            </p>
          </div>
        )
      })}
    </div>
  )
}
