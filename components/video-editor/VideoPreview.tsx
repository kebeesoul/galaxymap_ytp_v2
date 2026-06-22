import Image from 'next/image'
import { formatMss } from '@/lib/utils/time'

interface Props {
  thumbnailUrl: string | null
  title: string | null
  durationSec: number | null
}

export default function VideoPreview({ thumbnailUrl, title, durationSec }: Props) {
  return (
    <div className="overflow-hidden rounded-xl bg-[#272729]">
      {thumbnailUrl ? (
        <div className="relative aspect-video w-full">
          <Image
            src={thumbnailUrl}
            alt={title ?? ''}
            fill
            sizes="(min-width: 1024px) 50vw, 100vw"
            unoptimized
            className="object-cover"
          />
        </div>
      ) : (
        <div className="aspect-video w-full bg-[#1d1d1f]" />
      )}
      <div className="px-4 py-3">
        <p className="truncate text-[17px] font-semibold leading-[1.24] tracking-[-0.374px] text-white">
          {title ?? '—'}
        </p>
        <p className="mt-1 text-[14px] tracking-[-0.224px] text-[rgba(255,255,255,0.48)]">
          {durationSec ? formatMss(durationSec) : '--:--'}
        </p>
      </div>
    </div>
  )
}
