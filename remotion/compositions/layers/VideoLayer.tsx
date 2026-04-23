import { OffthreadVideo, useVideoConfig } from 'remotion'

interface Props {
  src: string
  startSec: number
  endSec: number
}

export default function VideoLayer({ src, startSec, endSec }: Props) {
  const { fps } = useVideoConfig()
  return (
    <OffthreadVideo
      src={src}
      startFrom={Math.round(startSec * fps)}
      endAt={Math.round(endSec * fps)}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  )
}
