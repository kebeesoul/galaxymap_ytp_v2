interface Props {
  enabled?: boolean
}

export default function BlackBarsLayer({ enabled }: Props) {
  if (!enabled) return null

  return (
    <>
      <div style={{ position: 'absolute', inset: '0 0 auto 0', height: '15%', backgroundColor: '#000' }} />
      <div style={{ position: 'absolute', inset: 'auto 0 0 0', height: '15%', backgroundColor: '#000' }} />
    </>
  )
}
