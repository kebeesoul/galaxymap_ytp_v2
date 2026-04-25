'use client'

import { Player } from '@remotion/player'
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
}

function calcFrames(startSec: number, endSec: number): number {
  return Math.max(1, Math.round((endSec - startSec) * FPS))
}

export default function CanvasPreview({ clip, segments, comments, layout, signedUrl }: Props) {
  if (!signedUrl) {
    return (
      <div className="rounded-xl bg-[#1d1d1f] px-5 py-8 text-center">
        <p className="text-[13px] text-[rgba(255,255,255,0.24)]">비디오 로드 후 미리보기 가능</p>
      </div>
    )
  }

  const durationInFrames = calcFrames(clip.start_sec, clip.end_sec)
  const commonPlayerProps = {
    durationInFrames,
    fps: FPS,
    compositionWidth: COMP_WIDTH,
    compositionHeight: COMP_HEIGHT,
    // key resets the player to frame 0 when the layout changes
    key: layout,
    style: { width: '100%', borderRadius: 8 } as React.CSSProperties,
    controls: true,
    loop: true,
  }

  return (
    <div className="rounded-xl bg-[#1d1d1f] px-5 py-4">
      <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgba(255,255,255,0.4)]">
        미리보기
      </h3>
      <div className="mx-auto max-w-[300px]">
        {layout === 'LAYOUT_A' ? (
          <Player
            {...commonPlayerProps}
            component={LayoutA}
            inputProps={{ clip, segments, comments, preview_path: signedUrl }}
          />
        ) : layout === 'LAYOUT_B' ? (
          <Player
            {...commonPlayerProps}
            component={LayoutB}
            inputProps={{ clip, segments, preview_path: signedUrl }}
          />
        ) : (
          <Player
            {...commonPlayerProps}
            component={LayoutC}
            inputProps={{ clip, comments, preview_path: signedUrl }}
          />
        )}
      </div>
    </div>
  )
}
