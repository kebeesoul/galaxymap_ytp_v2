import { OffthreadVideo } from 'remotion'

interface Props {
  previewPath: string // signed URL
}

export default function VideoLayer({ previewPath }: Props) {
  return (
    <OffthreadVideo
      src={previewPath}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  )
}
