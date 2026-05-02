import { Audio, OffthreadVideo, useVideoConfig } from 'remotion'

interface Props {
  src: string
  startSec: number
  endSec: number
  bgmUrl?: string | null
  bgmVolume?: number
  originalVolume?: number
  bgmStartSec?: number
}

export default function VideoLayer({
  src,
  startSec,
  endSec,
  bgmUrl,
  bgmVolume = 0.3,
  originalVolume = 1.0,
  bgmStartSec = 0,
}: Props) {
  const { fps } = useVideoConfig()
  return (
    <>
      <OffthreadVideo
        src={src}
        startFrom={Math.round(startSec * fps)}
        endAt={Math.round(endSec * fps)}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        volume={originalVolume}
      />
      {bgmUrl ? (
        <Audio
          src={bgmUrl}
          volume={bgmVolume}
          loop
          startFrom={Math.round(bgmStartSec * fps)}
        />
      ) : null}
    </>
  )
}
