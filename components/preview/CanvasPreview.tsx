'use client'

import { memo, useEffect, useRef } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import LayoutA from '@/remotion/compositions/LayoutA'
import LayoutB from '@/remotion/compositions/LayoutB'
import LayoutC from '@/remotion/compositions/LayoutC'
import type { ClipInput, Segment, Comment } from '@/remotion/types'

const FPS = 30
const COMP_WIDTH = 1080
const COMP_HEIGHT = 1920

interface Props {
  clip: ClipInput
  segments: Segment[]
  comments: Comment[]
  layout: 'LAYOUT_A' | 'LAYOUT_B' | 'LAYOUT_C'
  signedUrl: string | null
  /** Called with absolute video time (clip.start_sec + preview frame time) on every frame update. */
  onTimeUpdate?: (absSec: number) => void
}

function calcFrames(startSec: number, endSec: number): number {
  return Math.max(1, Math.round((endSec - startSec) * FPS))
}

function CanvasPreview({ clip, segments, comments, layout, signedUrl, onTimeUpdate }: Props) {
  const playerRef = useRef<PlayerRef>(null)
  const startSecRef = useRef(clip.start_sec)
  const onTimeUpdateRef = useRef(onTimeUpdate)
  startSecRef.current = clip.start_sec
  onTimeUpdateRef.current = onTimeUpdate

  useEffect(() => {
    const player = playerRef.current
    if (!player) return
    let lastUpdate = 0
    const handler = () => {
      const cb = onTimeUpdateRef.current
      if (!cb) return
      const now = performance.now()
      // Throttle to ~10 updates/sec — enough for active-line highlighting
      if (now - lastUpdate < 100) return
      lastUpdate = now
      cb(startSecRef.current + player.getCurrentFrame() / FPS)
    }
    player.addEventListener('frameupdate', handler)
    return () => player.removeEventListener('frameupdate', handler)
  }, [signedUrl, layout])

  if (!signedUrl) {
    return (
      <details className="group rounded-xl bg-[#1d1d1f]" open>
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-[12px] text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.6)]">
          <span className="font-semibold uppercase tracking-[0.08em]">미리보기</span>
          <span className="transition-transform duration-200 group-open:rotate-180">▾</span>
        </summary>
        <div className="px-5 pb-8 pt-2 text-center">
          <p className="text-[13px] text-[rgba(255,255,255,0.24)]">비디오 로드 후 미리보기 가능</p>
        </div>
      </details>
    )
  }

  const durationInFrames = calcFrames(clip.start_sec, clip.end_sec)
  const commonPlayerProps = {
    durationInFrames,
    fps: FPS,
    compositionWidth: COMP_WIDTH,
    compositionHeight: COMP_HEIGHT,
    style: { width: '100%', borderRadius: 8 } as React.CSSProperties,
    controls: true,
    loop: true,
  }

  return (
    <details className="group rounded-xl bg-[#1d1d1f]" open>
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-[12px] text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.6)]">
        <span className="font-semibold uppercase tracking-[0.08em]">미리보기</span>
        <span className="transition-transform duration-200 group-open:rotate-180">▾</span>
      </summary>
      <div className="px-5 pb-4">
        <div className="mx-auto max-w-[300px]">
          {layout === 'LAYOUT_A' ? (
            <Player
              key={layout}
              ref={playerRef}
              {...commonPlayerProps}
              component={LayoutA}
              inputProps={{ clip, segments, comments, preview_path: signedUrl }}
            />
          ) : layout === 'LAYOUT_B' ? (
            <Player
              key={layout}
              ref={playerRef}
              {...commonPlayerProps}
              component={LayoutB}
              inputProps={{ clip, segments, preview_path: signedUrl }}
            />
          ) : (
            <Player
              key={layout}
              ref={playerRef}
              {...commonPlayerProps}
              component={LayoutC}
              inputProps={{ clip, comments, preview_path: signedUrl }}
            />
          )}
        </div>
      </div>
    </details>
  )
}

export default memo(CanvasPreview)
