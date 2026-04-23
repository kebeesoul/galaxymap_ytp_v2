import { useCurrentFrame, useVideoConfig } from 'remotion'

interface Segment {
  text: string
  start_sec: number
  end_sec: number
}

interface Props {
  segments: Segment[]
}

export default function SubtitleLayer({ segments }: Props) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const currentSec = frame / fps

  const active = segments.find(
    s => currentSec >= s.start_sec && currentSec < s.end_sec
  )

  if (!active) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: '12%',
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        padding: '0 48px',
      }}
    >
      <div
        style={{
          backgroundColor: 'rgba(0,0,0,0.72)',
          borderRadius: 12,
          padding: '10px 24px',
          maxWidth: 720,
        }}
      >
        <p
          style={{
            color: '#ffffff',
            fontSize: 36,
            fontWeight: 600,
            lineHeight: 1.3,
            textAlign: 'center',
            margin: 0,
          }}
        >
          {active.text}
        </p>
      </div>
    </div>
  )
}
