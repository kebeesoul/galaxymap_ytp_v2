'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { formatTime } from '@/lib/utils/time'
import { extractLayout } from '@/lib/utils/template'
import type { Clip, LyricsSegment, Comment, Template } from '@/lib/types'
import VideoPreview from './VideoPreview'
import SubtitleEditor from '@/components/subtitle-editor/SubtitleEditor'
import CommentCard from '@/components/comment-card/CommentCard'
import TemplatePicker from '@/components/template-picker/TemplatePicker'
import BgmEditor from '@/components/audio/BgmEditor'

const CanvasPreview = dynamic(() => import('@/components/preview/CanvasPreview'), { ssr: false })
const WaveformEditor = dynamic(() => import('./WaveformEditor'), { ssr: false })

function getLayoutForClip(
  templates: Template[],
  templateId: string | null,
): 'LAYOUT_A' | 'LAYOUT_B' | 'LAYOUT_C' {
  if (!templateId) return 'LAYOUT_A'
  const tmpl = templates.find(t => t.id === templateId)
  if (!tmpl) return 'LAYOUT_A'
  const l = extractLayout(tmpl.config_json)
  if (l === 'LAYOUT_A' || l === 'LAYOUT_B' || l === 'LAYOUT_C') return l
  return 'LAYOUT_A'
}

interface Props {
  project: {
    id: string
    yt_video_id: string | null
    yt_source_path: string | null
    yt_duration_sec: number | null
    yt_thumbnail_url: string | null
    yt_title: string | null
  }
  initialClips: Clip[]
  initialSegmentsByClip: Record<string, LyricsSegment[]>
  initialCommentsByClip: Record<string, Comment[]>
  templates: Template[]
}

const POLL_INTERVAL_MS = 3_000
const POLL_MAX = 100

interface StatusResponse {
  render_status?: string | null
  render_path?: string | null
  render_error?: string | null
}

export default function ClipEditor({
  project,
  initialClips,
  initialSegmentsByClip,
  initialCommentsByClip,
  templates,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const lastTimeRef = useRef(0)

  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)

  // Stable ref callback — prevents WaveSurfer from reinitialising on parent re-renders
  const videoRefCallback = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el
    setVideoEl(el)
  }, [])
  const [currentTime, setCurrentTime] = useState(0)
  const [startSec, setStartSec] = useState<number | null>(null)
  const [endSec, setEndSec] = useState<number | null>(null)
  const [clips, setClips] = useState<Clip[]>(initialClips)
  const [saving, setSaving] = useState(false)

  const [templateIdsByClip, setTemplateIdsByClip] = useState<Record<string, string | null>>(
    Object.fromEntries(initialClips.map(c => [c.id, c.template_id]))
  )

  const [bgmByClip, setBgmByClip] = useState<Record<string, {
    bgm_url: string | null
    bgm_volume: number
    original_volume: number
  }>>(Object.fromEntries(initialClips.map(c => [c.id, {
    bgm_url: c.bgm_url,
    bgm_volume: c.bgm_volume,
    original_volume: c.original_volume,
  }])))

  const [commentsByClip, setCommentsByClip] = useState<
    Record<string, Array<{ username: string; body: string; likes_count: number }>>
  >(Object.fromEntries(initialClips.map(c => [
    c.id,
    (initialCommentsByClip[c.id] ?? []).map(cm => ({
      username: cm.username,
      body: cm.body,
      likes_count: cm.likes_count ?? 0,
    })),
  ])))

  const [transcribeStatuses, setTranscribeStatuses] = useState<Record<string, string | null>>(
    Object.fromEntries(initialClips.map(c => [c.id, c.transcribe_status]))
  )
  const [segmentsByClip, setSegmentsByClip] =
    useState<Record<string, LyricsSegment[]>>(initialSegmentsByClip)
  const [transcribing, setTranscribing] = useState<Record<string, boolean>>({})
  const [transcribeErrors, setTranscribeErrors] = useState<Record<string, string>>({})

  const [renderStatuses, setRenderStatuses] = useState<Record<string, string | null>>(
    Object.fromEntries(initialClips.map(c => [c.id, c.render_status]))
  )
  const [rendering, setRendering] = useState<Record<string, boolean>>({})
  const [renderErrors, setRenderErrors] = useState<Record<string, string>>({})
  const [renderPaths, setRenderPaths] = useState<Record<string, string>>(
    Object.fromEntries(initialClips.flatMap(c => (c.render_path ? [[c.id, c.render_path]] : [])))
  )
  const [downloading, setDownloading] = useState<Record<string, boolean>>({})

  const [lyricsInput, setLyricsInput] = useState<Record<string, string>>({})
  const [lyricsInputOpen, setLyricsInputOpen] = useState<Record<string, boolean>>({})
  const [savingLyrics, setSavingLyrics] = useState<Record<string, boolean>>({})

  const pollingIntervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({})
  const pollCountsRef = useRef<Record<string, number>>({})

  // Single stable Supabase client — never recreated on re-render
  const supabase = useMemo(() => createClient(), [])

  // Signed URL for video preview
  useEffect(() => {
    if (!project.yt_source_path) return
    supabase.storage
      .from('sources')
      .createSignedUrl(project.yt_source_path, 3600)
      .then(({ data }) => {
        if (data?.signedUrl) setSignedUrl(data.signedUrl)
      })
  }, [project.yt_source_path, supabase])

  // Resume polling for pending renders on page load
  useEffect(() => {
    for (const clip of initialClips) {
      if (clip.render_status === 'pending') {
        setRendering(prev => ({ ...prev, [clip.id]: true }))
        startPolling(clip.id)
      }
    }
    return () => {
      for (const id of Object.values(pollingIntervalsRef.current)) {
        clearInterval(id)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startPolling(clipId: string) {
    if (pollingIntervalsRef.current[clipId]) return
    pollCountsRef.current[clipId] = 0

    const intervalId = setInterval(async () => {
      pollCountsRef.current[clipId] = (pollCountsRef.current[clipId] ?? 0) + 1

      if (pollCountsRef.current[clipId] > POLL_MAX) {
        stopPolling(clipId)
        setRendering(prev => ({ ...prev, [clipId]: false }))
        setRenderStatuses(prev => ({ ...prev, [clipId]: 'failed' }))
        setRenderErrors(prev => ({ ...prev, [clipId]: '렌더 타임아웃 (5분 초과)' }))
        return
      }

      try {
        const res = await fetch(`/api/render/status?clip_id=${clipId}`)
        if (!res.ok) return
        const data = (await res.json()) as StatusResponse

        if (data.render_status === 'success') {
          stopPolling(clipId)
          setRendering(prev => ({ ...prev, [clipId]: false }))
          setRenderStatuses(prev => ({ ...prev, [clipId]: 'success' }))
          if (data.render_path) {
            setRenderPaths(prev => ({ ...prev, [clipId]: data.render_path! }))
          }
        } else if (data.render_status === 'failed') {
          stopPolling(clipId)
          setRendering(prev => ({ ...prev, [clipId]: false }))
          setRenderStatuses(prev => ({ ...prev, [clipId]: 'failed' }))
          setRenderErrors(prev => ({
            ...prev,
            [clipId]: data.render_error ?? '렌더 실패',
          }))
        }
      } catch {
        // Network error — keep polling
      }
    }, POLL_INTERVAL_MS)

    pollingIntervalsRef.current[clipId] = intervalId
  }

  function stopPolling(clipId: string) {
    const id = pollingIntervalsRef.current[clipId]
    if (id) {
      clearInterval(id)
      delete pollingIntervalsRef.current[clipId]
    }
  }

  // Throttle: only update state if time changed by > 250ms — avoids 60fps re-renders
  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current) return
    const t = videoRef.current.currentTime
    if (Math.abs(t - lastTimeRef.current) < 0.25) return
    lastTimeRef.current = t
    setCurrentTime(t)
  }, [])

  const handleSeek = useCallback((sec: number) => {
    if (!videoRef.current) return
    videoRef.current.currentTime = sec
    videoRef.current.play().catch(() => {})
  }, [])

  // Seek only — no auto-play (used for waveform click)
  const handleSeekOnly = useCallback((sec: number) => {
    if (!videoRef.current) return
    videoRef.current.currentTime = sec
  }, [])

  function handleSetDuration(durationSec: number) {
    const current = videoRef.current?.currentTime ?? 0
    const maxDuration = videoRef.current?.duration ?? (project.yt_duration_sec ?? 99999)
    setStartSec(current)
    setEndSec(Math.min(current + durationSec, maxDuration))
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'i' || e.key === 'I') setStartSec(videoRef.current?.currentTime ?? 0)
      if (e.key === 'o' || e.key === 'O') setEndSec(videoRef.current?.currentTime ?? 0)
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
      setClips(prev => [...prev, data])
      setTranscribeStatuses(prev => ({ ...prev, [data.id]: null }))
      setRenderStatuses(prev => ({ ...prev, [data.id]: null }))
      setTemplateIdsByClip(prev => ({ ...prev, [data.id]: null }))
      setBgmByClip(prev => ({ ...prev, [data.id]: { bgm_url: null, bgm_volume: 0.3, original_volume: 1.0 } }))
      setCommentsByClip(prev => ({ ...prev, [data.id]: [] }))
      setLyricsInput(prev => ({ ...prev, [data.id]: '' }))
      setLyricsInputOpen(prev => ({ ...prev, [data.id]: false }))
      setSavingLyrics(prev => ({ ...prev, [data.id]: false }))
      setStartSec(null)
      setEndSec(null)
    }
    setSaving(false)
  }

  async function handleTranscribe(clipId: string) {
    setTranscribing(prev => ({ ...prev, [clipId]: true }))
    setTranscribeStatuses(prev => ({ ...prev, [clipId]: 'pending' }))
    setTranscribeErrors(prev => {
      const next = { ...prev }
      delete next[clipId]
      return next
    })
    try {
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clip_id: clipId }),
      })
      const body = (await res.json()) as { segments?: LyricsSegment[]; error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Transcription failed')
      setTranscribeStatuses(prev => ({ ...prev, [clipId]: 'success' }))
      setSegmentsByClip(prev => ({ ...prev, [clipId]: body.segments ?? [] }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transcription failed'
      setTranscribeStatuses(prev => ({ ...prev, [clipId]: 'failed' }))
      setTranscribeErrors(prev => ({ ...prev, [clipId]: msg }))
    } finally {
      setTranscribing(prev => ({ ...prev, [clipId]: false }))
    }
  }

  async function handleSaveLyrics(clipId: string) {
    const clip = clips.find(c => c.id === clipId)
    if (!clip) return
    const text = lyricsInput[clipId]?.trim() ?? ''
    if (!text) return

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    const start = Number(clip.start_sec)
    const end = Number(clip.end_sec)
    const step = (end - start) / lines.length

    const rows = lines.map((line, i) => ({
      clip_id: clipId,
      text: line,
      start_sec: Math.round((start + step * i) * 100) / 100,
      end_sec: Math.round((start + step * (i + 1)) * 100) / 100,
    }))

    setSavingLyrics(prev => ({ ...prev, [clipId]: true }))
    await supabase.from('lyrics_segments').delete().eq('clip_id', clipId)
    const { data } = await supabase.from('lyrics_segments').insert(rows).select()
    if (data) {
      setSegmentsByClip(prev => ({ ...prev, [clipId]: data }))
      setTranscribeStatuses(prev => ({ ...prev, [clipId]: 'success' }))
      setLyricsInputOpen(prev => ({ ...prev, [clipId]: false }))
    }
    setSavingLyrics(prev => ({ ...prev, [clipId]: false }))
  }

  async function handleRender(clipId: string) {
    setRendering(prev => ({ ...prev, [clipId]: true }))
    setRenderStatuses(prev => ({ ...prev, [clipId]: 'pending' }))
    setRenderErrors(prev => {
      const next = { ...prev }
      delete next[clipId]
      return next
    })
    stopPolling(clipId)

    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clip_id: clipId }),
      })
      const body = (await res.json()) as { queued?: boolean; error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Render failed')
      startPolling(clipId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Render failed'
      setRenderStatuses(prev => ({ ...prev, [clipId]: 'failed' }))
      setRenderErrors(prev => ({ ...prev, [clipId]: msg }))
      setRendering(prev => ({ ...prev, [clipId]: false }))
    }
  }

  async function handleDownload(clipId: string, filename: string) {
    const renderPath = renderPaths[clipId]
    if (!renderPath) return
    setDownloading(prev => ({ ...prev, [clipId]: true }))
    try {
      const { data } = await supabase.storage.from('renders').createSignedUrl(renderPath, 300)
      if (data?.signedUrl) {
        const a = document.createElement('a')
        a.href = data.signedUrl
        a.download = filename
        a.click()
      }
    } finally {
      setDownloading(prev => ({ ...prev, [clipId]: false }))
    }
  }

  const canSave = startSec !== null && endSec !== null && endSec > startSec

  return (
    <div className="space-y-3">
      {/* Video player */}
      <div className="overflow-hidden rounded-xl bg-black">
        {signedUrl ? (
          <video
            ref={videoRefCallback}
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

      {/* Waveform editor */}
      {videoEl && (
        <WaveformEditor
          mediaEl={videoEl}
          startSec={startSec}
          endSec={endSec}
          currentTime={currentTime}
          onSeek={handleSeekOnly}
          onRegionChange={(start, end) => {
            setStartSec(start)
            setEndSec(end)
          }}
        />
      )}

      {/* Controls bar */}
      <div className="rounded-xl bg-[#1d1d1f] px-5 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <span className="font-mono text-[13px] text-[rgba(255,255,255,0.5)]">
            {formatTime(currentTime)}
          </span>

          <button
            onClick={() => setStartSec(videoRef.current?.currentTime ?? 0)}
            className="rounded-lg bg-[#272729] px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-[#2a2a2d]"
          >
            <span className="mr-1.5 font-mono text-[rgba(255,255,255,0.4)]">I</span>
            In
            {startSec !== null && (
              <span className="ml-2 font-mono text-[rgba(255,255,255,0.6)]">
                {formatTime(startSec)}
              </span>
            )}
          </button>

          <button
            onClick={() => setEndSec(videoRef.current?.currentTime ?? 0)}
            className="rounded-lg bg-[#272729] px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-[#2a2a2d]"
          >
            <span className="mr-1.5 font-mono text-[rgba(255,255,255,0.4)]">O</span>
            Out
            {endSec !== null && (
              <span className="ml-2 font-mono text-[rgba(255,255,255,0.6)]">
                {formatTime(endSec)}
              </span>
            )}
          </button>

          <button
            onClick={() => handleSetDuration(30)}
            className="rounded-lg bg-[#272729] px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-[#2a2a2d]"
          >
            30 sec
          </button>

          <button
            onClick={() => handleSetDuration(60)}
            className="rounded-lg bg-[#272729] px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-[#2a2a2d]"
          >
            1 min
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
        <div className="space-y-3">
          <h3 className="px-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgba(255,255,255,0.4)]">
            Clips ({clips.length})
          </h3>
          {clips.map((clip, i) => {
            const transcribeStatus = transcribeStatuses[clip.id]
            const isTranscribing = transcribing[clip.id] ?? false
            const segments = segmentsByClip[clip.id] ?? []
            const comments = initialCommentsByClip[clip.id] ?? []
            const renderStatus = renderStatuses[clip.id]
            const isRendering = rendering[clip.id] ?? false
            const hasRenderPath = Boolean(renderPaths[clip.id])
            const isDownloading = downloading[clip.id] ?? false

            return (
              <div key={clip.id} className="space-y-2">
                {/* ── Clip header ── */}
                <div className="flex items-center gap-3 rounded-xl bg-[#1d1d1f] px-5 py-3">
                  <span className="w-6 text-center text-[12px] text-[rgba(255,255,255,0.3)]">
                    {i + 1}
                  </span>
                  <button
                    onClick={() => handleSeek(Number(clip.start_sec))}
                    className="font-mono text-[14px] text-white transition-opacity hover:opacity-70"
                  >
                    {formatTime(Number(clip.start_sec))}
                  </button>
                  <span className="text-[rgba(255,255,255,0.24)]">→</span>
                  <button
                    onClick={() => handleSeek(Number(clip.end_sec))}
                    className="font-mono text-[14px] text-white transition-opacity hover:opacity-70"
                  >
                    {formatTime(Number(clip.end_sec))}
                  </button>
                  <span className="font-mono text-[12px] text-[rgba(255,255,255,0.4)]">
                    {(Number(clip.end_sec) - Number(clip.start_sec)).toFixed(1)}s
                  </span>

                  <div className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => handleTranscribe(clip.id)}
                      disabled={isTranscribing || transcribeStatus === 'pending'}
                      className="flex items-center gap-2 rounded-lg bg-[#272729] px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-[#2a2a2d] disabled:opacity-40"
                    >
                      {isTranscribing || transcribeStatus === 'pending' ? (
                        <>
                          <span className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white" />
                          자막 추출 중…
                        </>
                      ) : (
                        '① 자막 추출'
                      )}
                    </button>
                    <button
                      onClick={() => setLyricsInputOpen(prev => ({ ...prev, [clip.id]: !prev[clip.id] }))}
                      className={`rounded-lg px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-[#2a2a2d] ${lyricsInputOpen[clip.id] ? 'bg-[#0071e3]/20 ring-1 ring-[#0071e3]' : 'bg-[#272729]'}`}
                    >
                      가사 입력
                    </button>
                  </div>
                </div>

                {lyricsInputOpen[clip.id] && (
                  <div className="rounded-xl bg-[#1d1d1f] px-5 py-4">
                    <p className="mb-2 text-[12px] text-[rgba(255,255,255,0.4)]">
                      가사를 한 줄씩 입력하세요. 줄마다 구간이 균등 배분됩니다.
                    </p>
                    <textarea
                      value={lyricsInput[clip.id] ?? ''}
                      onChange={e => setLyricsInput(prev => ({ ...prev, [clip.id]: e.target.value }))}
                      rows={8}
                      placeholder={'사랑했지만\n이젠 안녕\n...'}
                      className="w-full resize-none rounded-lg bg-[#272729] px-3 py-2 text-[14px] text-white outline-none placeholder:text-[rgba(255,255,255,0.2)] focus:ring-1 focus:ring-[#0071e3]"
                    />
                    <div className="mt-3 flex justify-end gap-2">
                      <button
                        onClick={() => setLyricsInputOpen(prev => ({ ...prev, [clip.id]: false }))}
                        className="rounded-lg bg-[#272729] px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-[#2a2a2d]"
                      >
                        취소
                      </button>
                      <button
                        onClick={() => handleSaveLyrics(clip.id)}
                        disabled={savingLyrics[clip.id] || !(lyricsInput[clip.id]?.trim())}
                        className="rounded-lg bg-[#0071e3] px-4 py-1.5 text-[13px] text-white transition-colors hover:bg-[#0077ed] disabled:opacity-30"
                      >
                        {savingLyrics[clip.id] ? '저장 중…' : '적용'}
                      </button>
                    </div>
                  </div>
                )}

                {transcribeStatus === 'failed' && (
                  <p className="px-1 text-[13px] text-red-400">
                    {transcribeErrors[clip.id] ?? '자막 추출 실패'}
                  </p>
                )}

                {transcribeStatus === 'success' && segments.length > 0 && (
                  <SubtitleEditor
                    key={`${clip.id}-${segments.length}`}
                    clipId={clip.id}
                    initialSegments={segments}
                    currentTime={currentTime}
                    onSeek={handleSeek}
                  />
                )}

                {/* ② 댓글 */}
                <CommentCard
                  clipId={clip.id}
                  videoId={project.yt_video_id ?? ''}
                  initialComments={comments}
                  onCommentsChange={(cmts) => setCommentsByClip(prev => ({ ...prev, [clip.id]: cmts }))}
                />

                {/* ③ 템플릿 */}
                <TemplatePicker
                  clipId={clip.id}
                  initialTemplateId={clip.template_id}
                  templates={templates}
                  onSelect={(id) => setTemplateIdsByClip(prev => ({ ...prev, [clip.id]: id }))}
                />

                {/* ④ BGM */}
                <BgmEditor
                  clipId={clip.id}
                  initialBgmUrl={clip.bgm_url}
                  initialBgmVolume={clip.bgm_volume}
                  initialOriginalVolume={clip.original_volume}
                  onSave={(state) => setBgmByClip(prev => ({ ...prev, [clip.id]: state }))}
                />

                {/* ⑤ 미리보기 */}
                <CanvasPreview
                  clip={{
                    start_sec: Number(clip.start_sec),
                    end_sec: Number(clip.end_sec),
                    bgm_url: bgmByClip[clip.id]?.bgm_url ?? null,
                    bgm_volume: bgmByClip[clip.id]?.bgm_volume ?? clip.bgm_volume,
                    original_volume: bgmByClip[clip.id]?.original_volume ?? clip.original_volume,
                  }}
                  segments={segments}
                  comments={commentsByClip[clip.id] ?? []}
                  layout={getLayoutForClip(templates, templateIdsByClip[clip.id] ?? null)}
                  signedUrl={signedUrl}
                />

                {/* ⑥ 렌더 */}
                <div className="rounded-xl bg-[#1d1d1f] px-5 py-4">
                  <div className="flex items-center gap-3">
                    <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgba(255,255,255,0.4)]">
                      렌더
                    </h3>

                    {renderStatus === 'success' && (
                      <span className="text-[12px] text-emerald-400">완료</span>
                    )}

                    <button
                      onClick={() => handleRender(clip.id)}
                      disabled={isRendering || renderStatus === 'pending'}
                      className="ml-auto flex items-center gap-2 rounded-lg bg-[#0071e3] px-4 py-1.5 text-[13px] text-white transition-colors hover:bg-[#0077ed] disabled:opacity-40"
                    >
                      {isRendering || renderStatus === 'pending' ? (
                        <>
                          <span className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white" />
                          렌더 중…
                        </>
                      ) : renderStatus === 'success' ? (
                        '재렌더'
                      ) : (
                        '렌더 시작'
                      )}
                    </button>
                  </div>

                  {renderStatus === 'success' && hasRenderPath && (
                    <button
                      onClick={() => handleDownload(clip.id, `clip-${i + 1}.mp4`)}
                      disabled={isDownloading}
                      className="mt-3 flex items-center gap-1.5 text-[14px] text-[#2997ff] transition-opacity hover:underline disabled:opacity-40"
                    >
                      {isDownloading ? (
                        <>
                          <span className="h-3 w-3 animate-spin rounded-full border border-[#2997ff]/40 border-t-[#2997ff]" />
                          준비 중…
                        </>
                      ) : (
                        <>↓ clip-{i + 1}.mp4 다운로드</>
                      )}
                    </button>
                  )}

                  {renderStatus === 'failed' && (
                    <p className="mt-3 text-[12px] text-red-400">
                      {renderErrors[clip.id] ?? '렌더 실패'}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
