'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import LayoutA from '@/remotion/compositions/LayoutA'
import LayoutB from '@/remotion/compositions/LayoutB'
import LayoutC from '@/remotion/compositions/LayoutC'
import type { ClipInput, Segment, Comment } from '@/remotion/types'
import { formatMss } from '@/lib/utils/time'

const FPS = 30
const COMP_WIDTH = 1080
const COMP_HEIGHT = 1920

export type SeekAndPlayFn = (clipRelSec: number) => void

interface Props {
  clip: ClipInput
  segments: Segment[]
  comments: Comment[]
  layout: 'LAYOUT_A' | 'LAYOUT_B' | 'LAYOUT_C'
  signedUrl: string | null
  /** Called with absolute video time (clip.start_sec + preview frame time) on every frame update. */
  onTimeUpdate?: (absSec: number) => void
  /** Mutable ref populated with a seek-and-play function for the preview player. */
  seekAndPlayRef?: React.MutableRefObject<SeekAndPlayFn | null>
}

function calcFrames(startSec: number, endSec: number): number {
  return Math.max(1, Math.round((endSec - startSec) * FPS))
}

function CanvasPreview({ clip, segments, comments, layout, signedUrl, onTimeUpdate, seekAndPlayRef }: Props) {
  const playerRef = useRef<PlayerRef>(null)
  const startSecRef = useRef(clip.start_sec)
  const onTimeUpdateRef = useRef(onTimeUpdate)
  const durationInFramesRef = useRef(0)
  startSecRef.current = clip.start_sec
  onTimeUpdateRef.current = onTimeUpdate

  const [isPlaying, setIsPlaying] = useState(false)
  const wasPlayingRef = useRef(false)
  // Seek bar and time label are updated via direct DOM mutation to avoid
  // re-rendering the Player 30× per second (which restarts Remotion's Audio).
  const rangeRef = useRef<HTMLInputElement>(null)
  const timeLabelRef = useRef<HTMLSpanElement>(null)

  const durationInFrames = calcFrames(clip.start_sec, clip.end_sec)
  durationInFramesRef.current = durationInFrames

  // Populate seekAndPlayRef so parent can trigger seek + play imperatively
  useEffect(() => {
    if (!seekAndPlayRef) return
    seekAndPlayRef.current = (clipRelSec: number) => {
      const player = playerRef.current
      if (!player) return
      const frame = Math.max(0, Math.min(durationInFramesRef.current - 1, Math.round(clipRelSec * FPS)))
      player.seekTo(frame)
      player.play()
    }
    return () => { if (seekAndPlayRef) seekAndPlayRef.current = null }
  }, [seekAndPlayRef])

  useEffect(() => {
    const player = playerRef.current
    if (!player) return
    let lastUpdate = 0
    const handleFrame = () => {
      const frame = player.getCurrentFrame()
      if (rangeRef.current) rangeRef.current.value = String(frame)
      if (timeLabelRef.current) {
        timeLabelRef.current.textContent =
          `${formatMss(frame / FPS)} / ${formatMss(durationInFramesRef.current / FPS)}`
      }
      const cb = onTimeUpdateRef.current
      if (!cb) return
      const now = performance.now()
      // Throttle onTimeUpdate to ~10/sec — enough for active-line highlighting
      if (now - lastUpdate < 100) return
      lastUpdate = now
      cb(startSecRef.current + frame / FPS)
    }
    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)
    player.addEventListener('frameupdate', handleFrame)
    player.addEventListener('play', handlePlay)
    player.addEventListener('pause', handlePause)
    return () => {
      player.removeEventListener('frameupdate', handleFrame)
      player.removeEventListener('play', handlePlay)
      player.removeEventListener('pause', handlePause)
    }
  }, [signedUrl, layout])

  function handlePlayPause() {
    const player = playerRef.current
    if (!player) return
    if (isPlaying) player.pause()
    else player.play()
  }

  function handleSeekPointerDown() {
    const player = playerRef.current
    if (!player) return
    wasPlayingRef.current = isPlaying
    player.pause()
  }

  function handleSeekChange(e: React.ChangeEvent<HTMLInputElement>) {
    const player = playerRef.current
    if (!player) return
    player.seekTo(Number(e.target.value))
  }

  function handleSeekPointerUp(e: React.PointerEvent<HTMLInputElement>) {
    const player = playerRef.current
    if (!player) return
    const frame = Number((e.target as HTMLInputElement).value)
    player.seekTo(frame)
    if (wasPlayingRef.current) player.play()
  }

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

  const commonPlayerProps = {
    durationInFrames,
    fps: FPS,
    compositionWidth: COMP_WIDTH,
    compositionHeight: COMP_HEIGHT,
    style: { width: '100%', borderRadius: 8 } as React.CSSProperties,
    controls: false,
    loop: true,
  }

  const totalSec = durationInFrames / FPS

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
          {/* Custom playback controls — avoids BGM stutter from Remotion's built-in seek bar */}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={handlePlayPause}
              className="shrink-0 text-[16px] leading-none text-white/70 hover:text-white"
            >
              {isPlaying ? '⏸' : '▶'}
            </button>
            <input
              ref={rangeRef}
              type="range"
              min={0}
              max={durationInFrames - 1}
              defaultValue={0}
              onChange={handleSeekChange}
              onPointerDown={handleSeekPointerDown}
              onPointerUp={handleSeekPointerUp}
              className="flex-1 accent-[#0071e3]"
            />
            <span ref={timeLabelRef} className="shrink-0 font-mono text-[11px] text-white/40">
              {formatMss(0)} / {formatMss(totalSec)}
            </span>
          </div>
        </div>
      </div>
    </details>
  )
}

export default memo(CanvasPreview)
