import { spring, useCurrentFrame, useVideoConfig } from 'remotion'
import type { Comment } from '../../types'

const STAGGER_FRAMES = 8

interface Props {
  comments: Comment[]
}

export default function CommentLayer({ comments }: Props) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const visible = comments.slice(0, 3)

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
              backgroundColor: 'rgba(0,0,0,0.82)',
              borderRadius: 16,
              padding: '14px 24px',
              opacity,
              transform: `translateY(${translateY}px)`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
              <span style={{ color: '#ffffff', fontSize: 26, fontWeight: 700, lineHeight: 1 }}>
                {c.username}
              </span>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 22, lineHeight: 1 }}>
                👍 {c.likes_count.toLocaleString()}
              </span>
            </div>
            <p
              style={{
                color: 'rgba(255,255,255,0.88)',
                fontSize: 24,
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
