function formatDuration(sec: number | null): string {
  if (!sec) return '--:--'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface Props {
  thumbnailUrl: string | null
  title: string | null
  durationSec: number | null
}

export default function VideoPreview({ thumbnailUrl, title, durationSec }: Props) {
  return (
    <div className="overflow-hidden rounded-xl bg-[#272729]">
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={title ?? ''}
          className="aspect-video w-full object-cover"
        />
      ) : (
        <div className="aspect-video w-full bg-[#1d1d1f]" />
      )}
      <div className="px-4 py-3">
        <p className="truncate text-[17px] font-semibold leading-[1.24] tracking-[-0.374px] text-white">
          {title ?? '—'}
        </p>
        <p className="mt-1 text-[14px] tracking-[-0.224px] text-[rgba(255,255,255,0.48)]">
          {formatDuration(durationSec)}
        </p>
      </div>
    </div>
  )
}
