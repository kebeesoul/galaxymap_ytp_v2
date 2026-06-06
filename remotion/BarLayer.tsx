import { BAR_COLOR, BAR_HEIGHT_PERCENT } from '../lib/video-bars'

interface Props {
  enabled?: boolean
}

export default function BarLayer({ enabled }: Props) {
  if (!enabled) return null

  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: '0 0 auto 0',
          height: `${BAR_HEIGHT_PERCENT}%`,
          backgroundColor: BAR_COLOR,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 'auto 0 0 0',
          height: `${BAR_HEIGHT_PERCENT}%`,
          backgroundColor: BAR_COLOR,
        }}
      />
    </>
  )
}
