'use client'

import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/plugins/regions'
import type { Region } from 'wavesurfer.js/plugins/regions'
import { formatTime } from '@/lib/utils/time'

interface Props {
  /** Existing <video> element — WaveSurfer attaches to it (no extra HTTP request). */
  mediaEl: HTMLVideoElement
  startSec: number | null
  endSec: number | null
  currentTime: number
  onSeek: (sec: number) => void
  /** Called when the user finishes dragging a region handle or the whole region. */
  onRegionChange: (start: number, end: number) => void
}

export default function WaveformEditor({
  mediaEl,
  startSec,
  endSec,
  currentTime,
  onSeek,
  onRegionChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const regionsPluginRef = useRef<RegionsPlugin | null>(null)
  const regionRef = useRef<Region | null>(null)
  // Prevents the region useEffect from recreating the region while the user is dragging it.
  const isDraggingRef = useRef(false)
  // Keep latest callbacks in refs so stale closures in wavesurfer listeners don't accumulate.
  const onSeekRef = useRef(onSeek)
  const onRegionChangeRef = useRef(onRegionChange)
  onSeekRef.current = onSeek
  onRegionChangeRef.current = onRegionChange

  const [loading, setLoading] = useState(true)
  const [isPlaying, setIsPlaying] = useState(() => !mediaEl.paused)

  // ── Track play/pause state + enforce 1× speed ─────────────────────────────
  useEffect(() => {
    const onPlay = () => {
      if (mediaEl.playbackRate !== 1) mediaEl.playbackRate = 1
      setIsPlaying(true)
    }
    const onPause = () => setIsPlaying(false)
    mediaEl.addEventListener('play', onPlay)
    mediaEl.addEventListener('pause', onPause)
    return () => {
      mediaEl.removeEventListener('play', onPlay)
      mediaEl.removeEventListener('pause', onPause)
    }
  }, [mediaEl])

  function handlePlayPause() {
    if (mediaEl.paused) {
      mediaEl.playbackRate = 1
      mediaEl.play().catch(() => {})
    } else {
      mediaEl.pause()
    }
  }

  // ── Initialise WaveSurfer once per video element ──────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    let destroyed = false

    function createWaveSurfer() {
      if (destroyed || !containerRef.current) return

      const regionsPlugin = RegionsPlugin.create()
      const ws = WaveSurfer.create({
        container: containerRef.current,
        media: mediaEl,
        waveColor: 'rgba(255,255,255,0.22)',
        progressColor: '#0071e3',
        cursorColor: 'rgba(255,255,255,0.7)',
        cursorWidth: 2,
        height: 80,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        interact: true,
        plugins: [regionsPlugin],
      })

      wsRef.current = ws
      regionsPluginRef.current = regionsPlugin

      ws.on('ready', () => setLoading(false))

      ws.on('interaction', (newTime: number) => {
        onSeekRef.current(newTime)
      })
    }

    // Defer WaveSurfer init until the video has buffered enough to play without
    // interruption. This prevents WaveSurfer's audio decode from competing with
    // the initial video stream and causing choppy playback.
    if (mediaEl.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
      createWaveSurfer()
    } else {
      mediaEl.addEventListener('canplaythrough', createWaveSurfer, { once: true })
    }

    return () => {
      destroyed = true
      mediaEl.removeEventListener('canplaythrough', createWaveSurfer)
      wsRef.current?.destroy()
      wsRef.current = null
      regionsPluginRef.current = null
      regionRef.current = null
    }
  }, [mediaEl])

  // ── Sync waveform cursor ← video currentTime ──────────────────────────────
  useEffect(() => {
    wsRef.current?.setTime(currentTime)
  }, [currentTime])

  // ── Sync region ← startSec / endSec (from I/O keys, detect-speech, etc.) ─
  useEffect(() => {
    // Skip if the change originated from the user dragging the region itself.
    if (isDraggingRef.current) return
    const plugin = regionsPluginRef.current
    if (!plugin) return

    regionRef.current?.remove()
    regionRef.current = null

    if (startSec !== null && endSec !== null && endSec > startSec) {
      const region = plugin.addRegion({
        start: startSec,
        end: endSec,
        color: 'rgba(0,113,227,0.15)',
        drag: true,
        resize: true,
      })
      regionRef.current = region

      region.on('update', () => {
        isDraggingRef.current = true
      })
      region.on('update-end', () => {
        onRegionChangeRef.current(region.start, region.end)
        // After dragging, jump to the new In and play from there.
        mediaEl.currentTime = region.start
        mediaEl.playbackRate = 1
        mediaEl.play().catch(() => {})
        // Allow the parent state update to settle before clearing the guard.
        requestAnimationFrame(() => {
          isDraggingRef.current = false
        })
      })
    }
  }, [startSec, endSec])

  const selectionSec =
    startSec !== null && endSec !== null ? endSec - startSec : null

  return (
    <div className="rounded-xl bg-[#1d1d1f] px-4 py-3">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between px-0.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgba(255,255,255,0.3)]">
            파형
          </span>
          <button
            onClick={handlePlayPause}
            disabled={loading}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-[#0071e3] text-white transition-opacity hover:bg-[#0077ed] disabled:opacity-30"
            title={isPlaying ? '일시정지' : '재생'}
          >
            {isPlaying ? (
              <svg viewBox="0 0 16 16" className="h-2.5 w-2.5 fill-current">
                <rect x="3" y="2" width="3.5" height="12" rx="1" />
                <rect x="9.5" y="2" width="3.5" height="12" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" className="h-2.5 w-2.5 fill-current">
                <path d="M4 2l10 6-10 6z" />
              </svg>
            )}
          </button>
        </div>
        <div className="flex items-center gap-3">
          {startSec !== null && (
            <span className="font-mono text-[11px] text-[rgba(255,255,255,0.35)]">
              In {formatTime(startSec)}
            </span>
          )}
          {endSec !== null && (
            <span className="font-mono text-[11px] text-[rgba(255,255,255,0.35)]">
              Out {formatTime(endSec)}
            </span>
          )}
          {selectionSec !== null && (
            <span className="rounded bg-[#272729] px-2 py-0.5 font-mono text-[11px] text-[rgba(255,255,255,0.6)]">
              {selectionSec.toFixed(1)}s
            </span>
          )}
        </div>
      </div>

      {/* Waveform canvas */}
      <div className="relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[12px] text-[rgba(255,255,255,0.2)]">파형 로딩 중…</span>
          </div>
        )}
        <div ref={containerRef} className={loading ? 'opacity-0' : 'opacity-100 transition-opacity'} />
      </div>

      {/* Usage hint */}
      <p className="mt-2 px-0.5 text-[11px] text-[rgba(255,255,255,0.18)]">
        파형을 클릭하면 이동 · 파란 구간을 드래그해서 In/Out 조정
      </p>
    </div>
  )
}
