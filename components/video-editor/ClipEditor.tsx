'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Tables } from '@/lib/supabase/types'
import VideoPreview from './VideoPreview'

type Clip = Tables<'clips'>

interface Props {
  project: {
    id: string
    yt_source_path: string | null
    yt_duration_sec: number | null
    yt_thumbnail_url: string | null
    yt_title: string | null
  }
  initialClips: Clip[]
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.floor((sec % 1) * 10)
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`
}

export default function ClipEditor({ project, initialClips }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [startSec, setStartSec] = useState<number | null>(null)
  const [endSec, setEndSec] = useState<number | null>(null)
  const [clips, setClips] = useState<Clip[]>(initialClips)
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    if (!project.yt_source_path) return
    supabase.storage
      .from('sources')
      .createSignedUrl(project.yt_source_path, 3600)
      .then(({ data }) => {
        if (data?.signedUrl) setSignedUrl(data.signedUrl)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.yt_source_path])

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime)
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'i' || e.key === 'I') {
        setStartSec(videoRef.current?.currentTime ?? 0)
      }
      if (e.key === 'o' || e.key === 'O') {
        setEndSec(videoRef.current?.currentTime ?? 0)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  async function saveClip() {
    if (startSec === null || endSec === null || endSec <= startSec) return
    setSaving(true)
    const { data, error } = await supabase
      .from('clips')
      .insert({ project_id: project.id, start_sec: startSec, end_sec: endSec })
      .select()
      .single()
    if (!error && data) {
      setClips((prev) => [...prev, data])
      setStartSec(null)
      setEndSec(null)
    }
    setSaving(false)
  }

  const canSave = startSec !== null && endSec !== null && endSec > startSec

  return (
    <div className="space-y-3">
      {/* Video / fallback */}
      <div className="overflow-hidden rounded-xl bg-black">
        {signedUrl ? (
          <video
            ref={videoRef}
            src={signedUrl}
            className="w-full"
            controls
            onTimeUpdate={handleTimeUpdate}
          />
        ) : (
          <VideoPreview
            thumbnailUrl={project.yt_thumbnail_url}
            title={project.yt_title}
            durationSec={project.yt_duration_sec}
          />
        )}
      </div>

      {/* Controls bar */}
      <div className="rounded-xl bg-[#1d1d1f] px-5 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <span className="font-mono text-[13px] text-[rgba(255,255,255,0.5)]">
            {formatTime(currentTime)}
          </span>

          <button
            onClick={() => setStartSec(videoRef.current?.currentTime ?? 0)}
            className="rounded-lg bg-[#272729] px-3 py-1.5 text-[13px] text-white hover:bg-[#2a2a2d] transition-colors"
          >
            <span className="mr-1.5 font-mono text-[rgba(255,255,255,0.4)]">I</span>
            In
            {startSec !== null && (
              <span className="ml-2 font-mono text-[rgba(255,255,255,0.6)]">{formatTime(startSec)}</span>
            )}
          </button>

          <button
            onClick={() => setEndSec(videoRef.current?.currentTime ?? 0)}
            className="rounded-lg bg-[#272729] px-3 py-1.5 text-[13px] text-white hover:bg-[#2a2a2d] transition-colors"
          >
            <span className="mr-1.5 font-mono text-[rgba(255,255,255,0.4)]">O</span>
            Out
            {endSec !== null && (
              <span className="ml-2 font-mono text-[rgba(255,255,255,0.6)]">{formatTime(endSec)}</span>
            )}
          </button>

          <button
            onClick={saveClip}
            disabled={saving || !canSave}
            className="ml-auto rounded-lg bg-[#0071e3] px-4 py-1.5 text-[14px] text-white transition-colors hover:bg-[#0077ed] disabled:opacity-30"
          >
            {saving ? 'Saving…' : 'Save Clip'}
          </button>
        </div>
        <p className="mt-2.5 text-[12px] text-[rgba(255,255,255,0.24)]">
          Press <kbd className="rounded bg-[#272729] px-1.5 py-0.5 font-mono">I</kbd> mark in ·{' '}
          <kbd className="rounded bg-[#272729] px-1.5 py-0.5 font-mono">O</kbd> mark out
        </p>
      </div>

      {/* Clips list */}
      {clips.length > 0 && (
        <div className="rounded-xl bg-[#1d1d1f] px-5 py-4">
          <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgba(255,255,255,0.4)]">
            Clips ({clips.length})
          </h3>
          <div className="space-y-2">
            {clips.map((clip, i) => (
              <div
                key={clip.id}
                className="flex items-center gap-3 rounded-lg bg-[#272729] px-4 py-2.5"
              >
                <span className="w-6 text-center text-[12px] text-[rgba(255,255,255,0.3)]">
                  {i + 1}
                </span>
                <span className="font-mono text-[14px] text-white">
                  {formatTime(Number(clip.start_sec))}
                </span>
                <span className="text-[rgba(255,255,255,0.24)]">→</span>
                <span className="font-mono text-[14px] text-white">
                  {formatTime(Number(clip.end_sec))}
                </span>
                <span className="ml-auto font-mono text-[12px] text-[rgba(255,255,255,0.4)]">
                  {(Number(clip.end_sec) - Number(clip.start_sec)).toFixed(1)}s
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
