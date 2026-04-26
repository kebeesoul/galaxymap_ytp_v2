'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { formatTime } from '@/lib/utils/time'
import { extractLayout } from '@/lib/utils/template'
import type { Json } from '@/lib/supabase/types'
import type { Clip, LyricsSegment, Comment, Template } from '@/lib/types'
import type { SubtitleStyle } from '@/remotion/types'
import VideoPreview from './VideoPreview'
import SubtitleEditor from '@/components/subtitle-editor/SubtitleEditor'
import CommentCard from '@/components/comment-card/CommentCard'
import TemplatePicker from '@/components/template-picker/TemplatePicker'
import BgmEditor from '@/components/audio/BgmEditor'

const CanvasPreview = dynamic(() => import('@/components/preview/CanvasPreview'), { ssr: false })
const WaveformEditor = dynamic(() => import('./WaveformEditor'), { ssr: false })

const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = { position: 'bottom', fontSize: 42, bgOpacity: 0.72 }

function parseSubtitleStyle(raw: unknown): SubtitleStyle {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_SUBTITLE_STYLE
  const obj = raw as Record<string, unknown>
  return {
    position: (['top', 'center', 'bottom'] as const).includes(obj.position as 'top')
      ? (obj.position as SubtitleStyle['position'])
      : DEFAULT_SUBTITLE_STYLE.position,
    fontSize: typeof obj.fontSize === 'number' ? obj.fontSize : DEFAULT_SUBTITLE_STYLE.fontSize,
    bgOpacity: typeof obj.bgOpacity === 'number' ? obj.bgOpacity : DEFAULT_SUBTITLE_STYLE.bgOpacity,
  }
}

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
    song_lyrics: string | null
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
  render_progress?: number
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

  // A2: inline clip-region editing
  const [editingClipId, setEditingClipId] = useState<string | null>(null)
  const [editStartSec, setEditStartSec] = useState('')
  const [editEndSec, setEditEndSec] = useState('')

  // A10: per-clip label (note/title)
  const [labelsByClip, setLabelsByClip] = useState<Record<string, string>>(
    Object.fromEntries(initialClips.map(c => [c.id, c.label ?? '']))
  )

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

  // C1: subtitle style per clip
  const [subtitleStylesByClip, setSubtitleStylesByClip] = useState<Record<string, SubtitleStyle>>(
    Object.fromEntries(initialClips.map(c => [c.id, parseSubtitleStyle(c.subtitle_style)]))
  )

  // C5: render progress 0–100 per clip
  const [renderProgressByClip, setRenderProgressByClip] = useState<Record<string, number>>(
    Object.fromEntries(initialClips.map(c => [c.id, c.render_progress ?? 0]))
  )

  // C7: multi-select for batch operations
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set())

  // B8: full Comment rows for CommentCard (lazy-loaded on mount)
  const [rawCommentsByClip, setRawCommentsByClip] = useState<Record<string, Comment[]>>(
    initialCommentsByClip
  )

  // A8: per-clip selected comment indices (empty = all)
  const [selectedCommentIdxByClip, setSelectedCommentIdxByClip] = useState<Record<string, number[]>>(
    Object.fromEntries(initialClips.map(c => [c.id, []]))
  )
  // B3: per-clip loop play
  const [loopingClipId, setLoopingClipId] = useState<string | null>(null)
  const loopingClipRef = useRef<{ clipId: string; start: number; end: number } | null>(null)
  // B6: seek via direct time input
  const [seekInputMode, setSeekInputMode] = useState(false)
  const [seekInputValue, setSeekInputValue] = useState('')
  // B7: clip container refs for auto-scroll after save
  const clipContainerRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Project-level lyrics (full song lyrics)
  const [songLyrics, setSongLyrics] = useState(project.song_lyrics ?? '')
  const [lyricsEditOpen, setLyricsEditOpen] = useState(!(project.song_lyrics?.trim()))
  const [savingProjectLyrics, setSavingProjectLyrics] = useState(false)
  const savedLyricsRef = useRef(project.song_lyrics ?? '')
  // Lyrics scroll container ref for auto-scroll to highlighted region
  const lyricsScrollRef = useRef<HTMLDivElement>(null)
  // Line range for the current clip-in-progress (0-based indices into allLines)
  const [regionLineFrom, setRegionLineFrom] = useState<number | null>(null)
  const [regionLineTo, setRegionLineTo] = useState<number | null>(null)

  // Derived lines from project-level lyrics
  const allLines = useMemo(
    () => songLyrics.split('\n').map(l => l.trim()).filter(Boolean),
    [songLyrics]
  )

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

  // A3: auto-refresh signed URL 10 min before the 1-hour expiry
  useEffect(() => {
    if (!project.yt_source_path) return
    const id = setInterval(() => {
      supabase.storage
        .from('sources')
        .createSignedUrl(project.yt_source_path!, 3600)
        .then(({ data }) => {
          if (data?.signedUrl) setSignedUrl(data.signedUrl)
        })
    }, 50 * 60 * 1000)
    return () => clearInterval(id)
  }, [project.yt_source_path, supabase])

  // C6: Realtime render_status for all clips in this project
  useEffect(() => {
    const channel = supabase
      .channel(`project-${project.id}-clips-render`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'clips', filter: `project_id=eq.${project.id}` },
        (payload) => {
          const row = payload.new as {
            id: string
            render_status: string | null
            render_path: string | null
            render_error: string | null
            render_progress: number
          }
          setRenderStatuses(prev => ({ ...prev, [row.id]: row.render_status }))
          setRenderProgressByClip(prev => ({ ...prev, [row.id]: row.render_progress ?? 0 }))
          if (row.render_status === 'success') {
            stopPolling(row.id)
            setRendering(prev => ({ ...prev, [row.id]: false }))
            if (row.render_path) setRenderPaths(prev => ({ ...prev, [row.id]: row.render_path! }))
          } else if (row.render_status === 'failed') {
            stopPolling(row.id)
            setRendering(prev => ({ ...prev, [row.id]: false }))
            setRenderErrors(prev => ({ ...prev, [row.id]: row.render_error ?? '렌더 실패' }))
          }
        }
      )
      .subscribe()
    return () => { channel.unsubscribe(); supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, supabase])

  // B8: lazy-load segments + comments client-side (page.tsx skips these SSR queries)
  useEffect(() => {
    const clipIds = initialClips.map(c => c.id)
    if (clipIds.length === 0) return
    Promise.all([
      supabase.from('lyrics_segments').select('*').in('clip_id', clipIds).order('order', { ascending: true }),
      supabase.from('comments').select('*').in('clip_id', clipIds),
    ]).then(([{ data: segs }, { data: cmts }]) => {
      if (segs) {
        const byClip: Record<string, LyricsSegment[]> = {}
        for (const seg of segs) {
          if (!seg.clip_id) continue
          if (!byClip[seg.clip_id]) byClip[seg.clip_id] = []
          byClip[seg.clip_id].push(seg)
        }
        setSegmentsByClip(prev => ({ ...prev, ...byClip }))
        setTranscribeStatuses(prev => {
          const updated = { ...prev }
          for (const clipId of Object.keys(byClip)) {
            if (!updated[clipId]) updated[clipId] = 'success'
          }
          return updated
        })
      }
      if (cmts) {
        const rawByClip: Record<string, Comment[]> = {}
        const simplByClip: Record<string, Array<{ username: string; body: string; likes_count: number }>> = {}
        const selByClip: Record<string, number[]> = {}
        for (const c of cmts) {
          if (!c.clip_id) continue
          if (!rawByClip[c.clip_id]) rawByClip[c.clip_id] = []
          if (!simplByClip[c.clip_id]) simplByClip[c.clip_id] = []
          const idx = rawByClip[c.clip_id].length
          rawByClip[c.clip_id].push(c)
          simplByClip[c.clip_id].push({ username: c.username, body: c.body, likes_count: c.likes_count ?? 0 })
          // C3: restore persisted selection
          if (c.is_selected) {
            if (!selByClip[c.clip_id]) selByClip[c.clip_id] = []
            selByClip[c.clip_id].push(idx)
          }
        }
        setRawCommentsByClip(rawByClip)
        setCommentsByClip(simplByClip)
        setSelectedCommentIdxByClip(prev => ({ ...prev, ...selByClip }))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

        if (data.render_progress !== undefined) {
          setRenderProgressByClip(prev => ({ ...prev, [clipId]: data.render_progress! }))
        }
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
    // B3: loop back to clip start when end is reached
    const loop = loopingClipRef.current
    if (loop && t >= loop.end) {
      videoRef.current.currentTime = loop.start
      videoRef.current.play().catch(() => {})
      return
    }
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

  // B3: toggle loop playback for a clip
  function handleToggleLoop(clipId: string, startSec: number, endSec: number) {
    if (loopingClipRef.current?.clipId === clipId) {
      loopingClipRef.current = null
      setLoopingClipId(null)
    } else {
      loopingClipRef.current = { clipId, start: startSec, end: endSec }
      setLoopingClipId(clipId)
      if (videoRef.current) {
        videoRef.current.currentTime = startSec
        videoRef.current.play().catch(() => {})
      }
    }
  }

  function handleSetDuration(durationSec: number) {
    const current = videoRef.current?.currentTime ?? 0
    const maxDuration = videoRef.current?.duration ?? (project.yt_duration_sec ?? 99999)
    setStartSec(current)
    setEndSec(Math.min(current + durationSec, maxDuration))
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      // A9: spacebar play/pause
      if (e.key === ' ') {
        e.preventDefault()
        const v = videoRef.current
        if (!v) return
        v.paused ? v.play().catch(() => {}) : v.pause()
        return
      }
      if (e.key === 'i' || e.key === 'I') setStartSec(videoRef.current?.currentTime ?? 0)
      if (e.key === 'o' || e.key === 'O') setEndSec(videoRef.current?.currentTime ?? 0)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Auto-detect which lyrics lines correspond to the selected waveform region
  useEffect(() => {
    if (startSec === null || endSec === null || allLines.length === 0) {
      setRegionLineFrom(null)
      setRegionLineTo(null)
      return
    }
    const totalDur = project.yt_duration_sec ?? 0
    if (!totalDur) return
    const from = Math.max(0, Math.floor((startSec / totalDur) * allLines.length))
    const to = Math.min(
      allLines.length - 1,
      Math.ceil((endSec / totalDur) * allLines.length) - 1
    )
    setRegionLineFrom(from)
    setRegionLineTo(Math.max(from, to))
  }, [startSec, endSec, allLines.length, project.yt_duration_sec])

  // Auto-scroll lyrics panel so highlighted lines are visible
  useEffect(() => {
    if (regionLineFrom === null || !lyricsScrollRef.current) return
    const el = lyricsScrollRef.current
    const lineHeight = 28
    const target = regionLineFrom * lineHeight - el.clientHeight / 3
    el.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  }, [regionLineFrom])

  async function handleSaveProjectLyrics() {
    setSavingProjectLyrics(true)
    await supabase.from('projects').update({ song_lyrics: songLyrics }).eq('id', project.id)
    savedLyricsRef.current = songLyrics
    setSavingProjectLyrics(false)
    setLyricsEditOpen(false)
  }

  // Click a line in the lyrics list to expand / contract the selected range
  function handleLyricsLineClick(i: number) {
    if (regionLineFrom === null || regionLineTo === null) {
      setRegionLineFrom(i)
      setRegionLineTo(i)
      return
    }
    if (i < regionLineFrom) {
      setRegionLineFrom(i)
    } else if (i > regionLineTo) {
      setRegionLineTo(i)
    } else if (i === regionLineFrom && regionLineFrom < regionLineTo) {
      setRegionLineFrom(i + 1)
    } else if (i === regionLineTo && regionLineTo > regionLineFrom) {
      setRegionLineTo(i - 1)
    }
  }


  async function saveClip() {
    if (startSec === null || endSec === null || endSec <= startSec) return
    setSaving(true)
    const { data, error } = await supabase
      .from('clips')
      .insert({ project_id: project.id, start_sec: startSec, end_sec: endSec })
      .select()
      .single()
    if (!error && data) {
      // Auto-create lyrics segments from the selected line range
      if (allLines.length > 0 && regionLineFrom !== null && regionLineTo !== null) {
        const selectedLines = allLines.slice(regionLineFrom, regionLineTo + 1)
        const step = (endSec - startSec) / selectedLines.length
        const rows = selectedLines.map((text, i) => ({
          clip_id: data.id,
          text,
          start_sec: Math.round((startSec + step * i) * 100) / 100,
          end_sec: Math.round((startSec + step * (i + 1)) * 100) / 100,
        }))
        const { data: segs } = await supabase.from('lyrics_segments').insert(rows).select()
        if (segs) {
          setSegmentsByClip(prev => ({ ...prev, [data.id]: segs }))
          setTranscribeStatuses(prev => ({ ...prev, [data.id]: 'success' }))
        }
      }

      setClips(prev => [...prev, data])
      setLabelsByClip(prev => ({ ...prev, [data.id]: '' }))
      setTranscribeStatuses(prev => ({ ...prev, [data.id]: prev[data.id] ?? null }))
      setRenderStatuses(prev => ({ ...prev, [data.id]: null }))
      setTemplateIdsByClip(prev => ({ ...prev, [data.id]: null }))
      setBgmByClip(prev => ({ ...prev, [data.id]: { bgm_url: null, bgm_volume: 0.3, original_volume: 1.0 } }))
      setCommentsByClip(prev => ({ ...prev, [data.id]: [] }))
      setRawCommentsByClip(prev => ({ ...prev, [data.id]: [] }))
      setSelectedCommentIdxByClip(prev => ({ ...prev, [data.id]: [] }))
      setSubtitleStylesByClip(prev => ({ ...prev, [data.id]: DEFAULT_SUBTITLE_STYLE }))
      setRenderProgressByClip(prev => ({ ...prev, [data.id]: 0 }))
      setRegionLineFrom(null)
      setRegionLineTo(null)
      setStartSec(null)
      setEndSec(null)
      // B7: scroll to the newly created clip
      setTimeout(() => {
        clipContainerRefs.current.get(data.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    }
    setSaving(false)
  }

  // C1: save subtitle style immediately on change
  async function handleSaveSubtitleStyle(clipId: string, style: SubtitleStyle) {
    setSubtitleStylesByClip(prev => ({ ...prev, [clipId]: style }))
    await supabase.from('clips').update({ subtitle_style: style as unknown as Json }).eq('id', clipId)
  }

  // C2: duplicate a clip (same region + segments, blank comments)
  async function handleDuplicateClip(clipId: string) {
    const clip = clips.find(c => c.id === clipId)
    if (!clip) return
    const { data: newClip, error } = await supabase
      .from('clips')
      .insert({
        project_id: clip.project_id,
        start_sec: Number(clip.start_sec),
        end_sec: Number(clip.end_sec),
        template_id: clip.template_id,
        label: clip.label ? `${clip.label} (복사본)` : '복사본',
        subtitle_style: clip.subtitle_style,
      })
      .select()
      .single()
    if (error || !newClip) return
    const segs = segmentsByClip[clipId] ?? []
    if (segs.length > 0) {
      const rows = segs.map(s => ({
        clip_id: newClip.id,
        text: s.text,
        start_sec: s.start_sec,
        end_sec: s.end_sec,
        order: s.order,
      }))
      const { data: newSegs } = await supabase.from('lyrics_segments').insert(rows).select()
      if (newSegs) setSegmentsByClip(prev => ({ ...prev, [newClip.id]: newSegs }))
    }
    setClips(prev => [...prev, newClip])
    setLabelsByClip(prev => ({ ...prev, [newClip.id]: newClip.label ?? '' }))
    setTranscribeStatuses(prev => ({ ...prev, [newClip.id]: segs.length > 0 ? 'success' : null }))
    setRenderStatuses(prev => ({ ...prev, [newClip.id]: null }))
    setTemplateIdsByClip(prev => ({ ...prev, [newClip.id]: newClip.template_id }))
    setBgmByClip(prev => ({ ...prev, [newClip.id]: { bgm_url: null, bgm_volume: 0.3, original_volume: 1.0 } }))
    setCommentsByClip(prev => ({ ...prev, [newClip.id]: [] }))
    setRawCommentsByClip(prev => ({ ...prev, [newClip.id]: [] }))
    setSelectedCommentIdxByClip(prev => ({ ...prev, [newClip.id]: [] }))
    setSubtitleStylesByClip(prev => ({ ...prev, [newClip.id]: parseSubtitleStyle(newClip.subtitle_style) }))
    setRenderProgressByClip(prev => ({ ...prev, [newClip.id]: 0 }))
    setTimeout(() => {
      clipContainerRefs.current.get(newClip.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }

  // A10: save clip label on blur
  async function handleSaveLabel(clipId: string) {
    const label = labelsByClip[clipId] ?? ''
    await supabase.from('clips').update({ label }).eq('id', clipId)
  }

  // A2: save edited clip region
  async function handleSaveClipEdit(clipId: string) {
    const start = parseFloat(editStartSec)
    const end = parseFloat(editEndSec)
    if (isNaN(start) || isNaN(end) || end <= start) return
    const { error } = await supabase
      .from('clips')
      .update({ start_sec: start, end_sec: end })
      .eq('id', clipId)
    if (!error) {
      setClips(prev => prev.map(c =>
        c.id === clipId ? { ...c, start_sec: start, end_sec: end } : c
      ))
      setEditingClipId(null)
    }
  }

  async function handleDeleteClip(clipId: string) {
    if (!window.confirm('이 클립을 삭제하시겠습니까?')) return
    await supabase.from('clips').delete().eq('id', clipId)
    stopPolling(clipId)
    setClips(prev => prev.filter(c => c.id !== clipId))
    const cleanup = <T,>(rec: Record<string, T>) => {
      const n = { ...rec }
      delete n[clipId]
      return n
    }
    setSegmentsByClip(cleanup)
    setTranscribeStatuses(cleanup)
    setRenderStatuses(cleanup)
    setTemplateIdsByClip(cleanup)
    setBgmByClip(cleanup)
    setCommentsByClip(cleanup)
    setRawCommentsByClip(cleanup)
    setSelectedCommentIdxByClip(cleanup)
    setSubtitleStylesByClip(cleanup)
    setRenderProgressByClip(cleanup)
    setSelectedClipIds(prev => { const n = new Set(prev); n.delete(clipId); return n })
    if (loopingClipRef.current?.clipId === clipId) {
      loopingClipRef.current = null
      setLoopingClipId(null)
    }
  }

  // C7: batch operations
  async function handleBatchRender() {
    for (const clipId of Array.from(selectedClipIds)) {
      await handleRender(clipId)
    }
  }

  async function handleBatchDelete() {
    if (!window.confirm(`선택된 ${selectedClipIds.size}개 클립을 모두 삭제하시겠습니까?`)) return
    for (const clipId of Array.from(selectedClipIds)) {
      await supabase.from('clips').delete().eq('id', clipId)
      stopPolling(clipId)
    }
    const ids = Array.from(selectedClipIds)
    setClips(prev => prev.filter(c => !ids.includes(c.id)))
    const cleanup = <T,>(rec: Record<string, T>) => {
      const n = { ...rec }
      for (const id of ids) delete n[id]
      return n
    }
    setSegmentsByClip(cleanup); setTranscribeStatuses(cleanup); setRenderStatuses(cleanup)
    setTemplateIdsByClip(cleanup); setBgmByClip(cleanup); setCommentsByClip(cleanup)
    setRawCommentsByClip(cleanup); setSelectedCommentIdxByClip(cleanup)
    setSubtitleStylesByClip(cleanup); setRenderProgressByClip(cleanup)
    setSelectedClipIds(new Set())
  }

  async function handleBatchApplyTemplate(templateId: string) {
    for (const clipId of Array.from(selectedClipIds)) {
      await supabase.from('clips').update({ template_id: templateId }).eq('id', clipId)
      setTemplateIdsByClip(prev => ({ ...prev, [clipId]: templateId }))
    }
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
            preload="auto"
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

      {/* ── 전체 가사 패널 ─────────────────────────────────── */}
      <div className="rounded-xl bg-[#1d1d1f] px-5 py-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgba(255,255,255,0.4)]">
              전체 가사
            </span>
            {allLines.length > 0 && !lyricsEditOpen && (
              <span className="text-[12px] text-[rgba(255,255,255,0.3)]">{allLines.length}줄</span>
            )}
          </div>
          {!lyricsEditOpen && (
            <button
              onClick={() => setLyricsEditOpen(true)}
              className="text-[12px] text-[rgba(255,255,255,0.35)] transition-colors hover:text-white"
            >
              {allLines.length > 0 ? '수정' : '입력'}
            </button>
          )}
        </div>

        {lyricsEditOpen ? (
          <>
            <p className="mb-2 text-[11px] text-[rgba(255,255,255,0.3)]">
              전체 가사를 한 줄씩 입력하세요. 파형으로 구간을 선택하면 해당 줄이 자동으로 연결됩니다.
            </p>
            <textarea
              value={songLyrics}
              onChange={e => setSongLyrics(e.target.value)}
              rows={10}
              placeholder={'첫 번째 줄\n두 번째 줄\n...'}
              className="w-full resize-none rounded-lg bg-[#272729] px-3 py-2 font-mono text-[13px] text-white outline-none placeholder:text-[rgba(255,255,255,0.2)] focus:ring-1 focus:ring-[#0071e3]"
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[12px] text-[rgba(255,255,255,0.3)]">{allLines.length}줄</span>
              <div className="flex gap-2">
                {savedLyricsRef.current && (
                  <button
                    onClick={() => { setSongLyrics(savedLyricsRef.current); setLyricsEditOpen(false) }}
                    className="rounded-lg bg-[#272729] px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-[#2a2a2d]"
                  >
                    취소
                  </button>
                )}
                <button
                  onClick={handleSaveProjectLyrics}
                  disabled={savingProjectLyrics || !songLyrics.trim()}
                  className="rounded-lg bg-[#0071e3] px-4 py-1.5 text-[13px] text-white transition-colors hover:bg-[#0077ed] disabled:opacity-30"
                >
                  {savingProjectLyrics ? '저장 중…' : '저장'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div ref={lyricsScrollRef} className="max-h-52 overflow-y-auto space-y-px pr-1">
              {allLines.length === 0 ? (
                <p className="py-4 text-center text-[13px] text-[rgba(255,255,255,0.2)]">
                  전체 가사를 먼저 입력하세요 → 파형으로 구간을 잡으면 해당 가사가 자동으로 연결됩니다
                </p>
              ) : (
                allLines.map((line, i) => {
                  const inRange =
                    regionLineFrom !== null &&
                    regionLineTo !== null &&
                    i >= regionLineFrom &&
                    i <= regionLineTo
                  return (
                    <div
                      key={i}
                      onClick={() => handleLyricsLineClick(i)}
                      className={`flex cursor-pointer select-none gap-3 rounded px-2 py-1 transition-colors ${
                        inRange ? 'bg-[#0071e3]/25 hover:bg-[#0071e3]/35' : 'hover:bg-[#272729]'
                      }`}
                    >
                      <span className={`w-5 shrink-0 text-right font-mono text-[11px] ${inRange ? 'text-[#2997ff]' : 'text-[rgba(255,255,255,0.2)]'}`}>
                        {i + 1}
                      </span>
                      <span className={`text-[13px] leading-snug ${inRange ? 'text-white' : 'text-[rgba(255,255,255,0.45)]'}`}>
                        {line}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
            {allLines.length > 0 && regionLineFrom !== null && regionLineTo !== null && (
              <p className="mt-2 text-[11px] text-[#2997ff]">
                {regionLineFrom + 1}~{regionLineTo + 1}번 줄 선택 ({regionLineTo - regionLineFrom + 1}줄) — 클릭해서 범위 조정
              </p>
            )}
          </>
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
          {/* B6: click current time to seek directly */}
          {seekInputMode ? (
            <input
              type="number"
              autoFocus
              step="0.1"
              value={seekInputValue}
              onChange={e => setSeekInputValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const t = parseFloat(seekInputValue)
                  if (!isNaN(t)) handleSeekOnly(t)
                  setSeekInputMode(false)
                }
                if (e.key === 'Escape') setSeekInputMode(false)
              }}
              onBlur={() => {
                const t = parseFloat(seekInputValue)
                if (!isNaN(t)) handleSeekOnly(t)
                setSeekInputMode(false)
              }}
              className="w-20 rounded-md bg-[#272729] px-2 py-1 font-mono text-[13px] text-white outline-none focus:ring-1 focus:ring-[#0071e3]"
            />
          ) : (
            <button
              onClick={() => { setSeekInputValue(currentTime.toFixed(1)); setSeekInputMode(true) }}
              className="font-mono text-[13px] text-[rgba(255,255,255,0.5)] transition-colors hover:text-white"
              title="클릭해서 직접 이동"
            >
              {formatTime(currentTime)}
            </button>
          )}

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

          {canSave && allLines.length > 0 && regionLineFrom !== null && regionLineTo !== null && (
            <span className="font-mono text-[12px] text-[#2997ff]">
              줄 {regionLineFrom + 1}~{regionLineTo + 1}
            </span>
          )}

          <button
            onClick={saveClip}
            disabled={saving || !canSave}
            className="ml-auto rounded-lg bg-[#0071e3] px-4 py-1.5 text-[14px] text-white transition-colors hover:bg-[#0077ed] disabled:opacity-30"
          >
            {saving ? 'Saving…' : 'Save Clip'}
          </button>
        </div>
        <p className="mt-2.5 text-[12px] text-[rgba(255,255,255,0.24)]">
          <kbd className="rounded bg-[#272729] px-1.5 py-0.5 font-mono">Space</kbd> play/pause ·{' '}
          <kbd className="rounded bg-[#272729] px-1.5 py-0.5 font-mono">I</kbd> mark in ·{' '}
          <kbd className="rounded bg-[#272729] px-1.5 py-0.5 font-mono">O</kbd> mark out
        </p>
      </div>

      {/* Clips list */}
      {clips.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgba(255,255,255,0.4)]">
              Clips ({clips.length})
            </h3>
          </div>

          {/* C7: batch action bar */}
          {selectedClipIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[#272729] px-4 py-3">
              <span className="text-[13px] text-white">{selectedClipIds.size}개 선택</span>
              <button
                onClick={handleBatchRender}
                className="rounded-lg bg-[#0071e3] px-3 py-1.5 text-[13px] text-white hover:bg-[#0077ed]"
              >
                일괄 렌더
              </button>
              <select
                defaultValue=""
                onChange={e => { if (e.target.value) handleBatchApplyTemplate(e.target.value) }}
                className="rounded-lg bg-[#1d1d1f] px-3 py-1.5 text-[13px] text-white outline-none"
              >
                <option value="" disabled>템플릿 일괄 적용</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button
                onClick={handleBatchDelete}
                className="rounded-lg bg-red-950/60 px-3 py-1.5 text-[13px] text-red-400 hover:bg-red-900/60"
              >
                일괄 삭제
              </button>
              <button
                onClick={() => setSelectedClipIds(new Set())}
                className="ml-auto text-[13px] text-[rgba(255,255,255,0.4)] hover:text-white"
              >
                선택 해제
              </button>
            </div>
          )}
          {clips.map((clip, i) => {
            const transcribeStatus = transcribeStatuses[clip.id]
            const isTranscribing = transcribing[clip.id] ?? false
            const segments = segmentsByClip[clip.id] ?? []
            const comments = rawCommentsByClip[clip.id] ?? []
            const allComments = commentsByClip[clip.id] ?? []
            const selectedCommentIdx = selectedCommentIdxByClip[clip.id] ?? []
            const filteredComments = selectedCommentIdx.length > 0
              ? allComments.filter((_, i) => selectedCommentIdx.includes(i))
              : allComments
            const renderStatus = renderStatuses[clip.id]
            const isRendering = rendering[clip.id] ?? false
            const hasRenderPath = Boolean(renderPaths[clip.id])
            const isDownloading = downloading[clip.id] ?? false

            return (
              <div
                key={clip.id}
                ref={el => {
                  if (el) clipContainerRefs.current.set(clip.id, el)
                  else clipContainerRefs.current.delete(clip.id)
                }}
                className="space-y-2"
              >
                {/* ── Clip header ── */}
                <div className="rounded-xl bg-[#1d1d1f] px-5 py-3">
                {/* A10: label input row / C7: checkbox */}
                <div className="mb-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedClipIds.has(clip.id)}
                    onChange={e => setSelectedClipIds(prev => {
                      const n = new Set(prev)
                      if (e.target.checked) n.add(clip.id); else n.delete(clip.id)
                      return n
                    })}
                    className="h-4 w-4 shrink-0 cursor-pointer accent-[#0071e3]"
                  />
                  <span className="w-5 text-center text-[12px] text-[rgba(255,255,255,0.3)]">{i + 1}</span>
                  <input
                    value={labelsByClip[clip.id] ?? ''}
                    onChange={e => setLabelsByClip(prev => ({ ...prev, [clip.id]: e.target.value }))}
                    onBlur={() => handleSaveLabel(clip.id)}
                    placeholder="노트 추가…"
                    className="flex-1 rounded-md bg-transparent px-1 py-0.5 text-[13px] text-[rgba(255,255,255,0.6)] outline-none placeholder:text-[rgba(255,255,255,0.2)] hover:bg-[#272729] focus:bg-[#272729] focus:ring-1 focus:ring-[#0071e3]"
                  />
                </div>
                <div className="flex items-center gap-3">
                  {/* A2: edit mode or normal timecode display */}
                  {editingClipId === clip.id ? (
                    <>
                      <input
                        type="number"
                        step="0.1"
                        value={editStartSec}
                        onChange={e => setEditStartSec(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSaveClipEdit(clip.id)}
                        className="w-20 rounded-md bg-[#272729] px-2 py-1 font-mono text-[13px] text-white outline-none focus:ring-1 focus:ring-[#0071e3]"
                      />
                      <span className="text-[rgba(255,255,255,0.3)]">→</span>
                      <input
                        type="number"
                        step="0.1"
                        value={editEndSec}
                        onChange={e => setEditEndSec(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSaveClipEdit(clip.id)}
                        className="w-20 rounded-md bg-[#272729] px-2 py-1 font-mono text-[13px] text-white outline-none focus:ring-1 focus:ring-[#0071e3]"
                      />
                      <div className="ml-auto flex items-center gap-2">
                        <button
                          onClick={() => handleSaveClipEdit(clip.id)}
                          className="rounded-lg bg-[#0071e3] px-3 py-1 text-[13px] text-white hover:bg-[#0077ed]"
                        >
                          저장
                        </button>
                        <button
                          onClick={() => setEditingClipId(null)}
                          className="rounded-lg bg-[#272729] px-3 py-1 text-[13px] text-white hover:bg-[#2a2a2d]"
                        >
                          취소
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
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
                        {/* B3: loop play for this clip */}
                        <button
                          onClick={() => handleToggleLoop(clip.id, Number(clip.start_sec), Number(clip.end_sec))}
                          className={`rounded-lg px-2.5 py-1.5 text-[13px] transition-colors ${
                            loopingClipId === clip.id
                              ? 'bg-[#0071e3]/20 text-[#2997ff] ring-1 ring-[#2997ff]/40'
                              : 'bg-[#272729] text-[rgba(255,255,255,0.4)] hover:bg-[#2a2a2d] hover:text-white'
                          }`}
                          title={loopingClipId === clip.id ? '루프 중지' : '클립 루프 재생'}
                        >
                          ↻
                        </button>
                        <button
                          onClick={() => {
                            setEditStartSec(String(Number(clip.start_sec)))
                            setEditEndSec(String(Number(clip.end_sec)))
                            setEditingClipId(clip.id)
                          }}
                          className="rounded-lg bg-[#272729] px-2.5 py-1.5 text-[13px] text-[rgba(255,255,255,0.4)] transition-colors hover:bg-[#2a2a2d] hover:text-white"
                          title="구간 수정"
                        >
                          ✏︎
                        </button>
                    {/* A7: show spinner only when actively transcribing; allow retry on stale pending */}
                    <button
                      onClick={() => handleTranscribe(clip.id)}
                      disabled={isTranscribing}
                      className="flex items-center gap-2 rounded-lg bg-[#272729] px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-[#2a2a2d] disabled:opacity-40"
                    >
                      {isTranscribing ? (
                        <>
                          <span className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white" />
                          자막 추출 중…
                        </>
                      ) : transcribeStatus === 'pending' ? (
                        '재시도'
                      ) : (
                        'Whisper 자막 추출'
                      )}
                    </button>
                    <button
                      onClick={() => handleDuplicateClip(clip.id)}
                      className="rounded-lg bg-[#272729] px-2.5 py-1.5 text-[13px] text-[rgba(255,255,255,0.4)] transition-colors hover:bg-[#2a2a2d] hover:text-white"
                      title="클립 복제"
                    >
                      ⊕
                    </button>
                    <button
                      onClick={() => handleDeleteClip(clip.id)}
                      className="rounded-lg bg-[#272729] px-3 py-1.5 text-[13px] text-[rgba(255,255,255,0.4)] transition-colors hover:bg-red-950/60 hover:text-red-400"
                      title="클립 삭제"
                    >
                      ✕
                    </button>
                      </div>
                    </>
                  )}
                </div>
                </div>

                {/* C1: subtitle style */}
                <details className="rounded-xl bg-[#1d1d1f]">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-[12px] text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.6)]">
                    <span>자막 스타일</span>
                    <span>▾</span>
                  </summary>
                  <div className="space-y-3 px-5 pb-4">
                    <div>
                      <p className="mb-1.5 text-[11px] text-[rgba(255,255,255,0.3)]">위치</p>
                      <div className="flex gap-1">
                        {(['top', 'center', 'bottom'] as const).map(pos => (
                          <button
                            key={pos}
                            onClick={() => handleSaveSubtitleStyle(clip.id, { ...subtitleStylesByClip[clip.id], position: pos })}
                            className={`flex-1 rounded-md py-1.5 text-[12px] transition-colors ${
                              (subtitleStylesByClip[clip.id] ?? DEFAULT_SUBTITLE_STYLE).position === pos
                                ? 'bg-[#0071e3] text-white'
                                : 'bg-[#272729] text-[rgba(255,255,255,0.5)] hover:bg-[#2a2a2d]'
                            }`}
                          >
                            {pos === 'top' ? '상단' : pos === 'center' ? '중앙' : '하단'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-1.5 text-[11px] text-[rgba(255,255,255,0.3)]">
                        폰트 크기{' '}
                        <span className="text-white">{(subtitleStylesByClip[clip.id] ?? DEFAULT_SUBTITLE_STYLE).fontSize}px</span>
                      </p>
                      <input
                        type="range" min={24} max={72} step={2}
                        value={(subtitleStylesByClip[clip.id] ?? DEFAULT_SUBTITLE_STYLE).fontSize}
                        onChange={e => setSubtitleStylesByClip(prev => ({
                          ...prev,
                          [clip.id]: { ...(prev[clip.id] ?? DEFAULT_SUBTITLE_STYLE), fontSize: Number(e.target.value) },
                        }))}
                        onMouseUp={() => handleSaveSubtitleStyle(clip.id, subtitleStylesByClip[clip.id] ?? DEFAULT_SUBTITLE_STYLE)}
                        className="w-full accent-[#0071e3]"
                      />
                    </div>
                    <div>
                      <p className="mb-1.5 text-[11px] text-[rgba(255,255,255,0.3)]">
                        배경 불투명도{' '}
                        <span className="text-white">{Math.round((subtitleStylesByClip[clip.id] ?? DEFAULT_SUBTITLE_STYLE).bgOpacity * 100)}%</span>
                      </p>
                      <input
                        type="range" min={0} max={1} step={0.05}
                        value={(subtitleStylesByClip[clip.id] ?? DEFAULT_SUBTITLE_STYLE).bgOpacity}
                        onChange={e => setSubtitleStylesByClip(prev => ({
                          ...prev,
                          [clip.id]: { ...(prev[clip.id] ?? DEFAULT_SUBTITLE_STYLE), bgOpacity: Number(e.target.value) },
                        }))}
                        onMouseUp={() => handleSaveSubtitleStyle(clip.id, subtitleStylesByClip[clip.id] ?? DEFAULT_SUBTITLE_STYLE)}
                        className="w-full accent-[#0071e3]"
                      />
                    </div>
                  </div>
                </details>

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
                  key={`${clip.id}-comments-${comments.length}`}
                  clipId={clip.id}
                  videoId={project.yt_video_id ?? ''}
                  initialComments={comments}
                  selectedIndices={selectedCommentIdx}
                  onSelectionChange={(indices) => setSelectedCommentIdxByClip(prev => ({ ...prev, [clip.id]: indices }))}
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
                    subtitle_style: subtitleStylesByClip[clip.id] ?? null,
                  }}
                  segments={segments}
                  comments={filteredComments}
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

                  {/* C5: render progress bar */}
                  {(isRendering || renderStatus === 'pending') && (
                    <div className="mt-3">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#272729]">
                        <div
                          className="h-full rounded-full bg-[#0071e3] transition-all duration-500"
                          style={{ width: `${renderProgressByClip[clip.id] ?? 0}%` }}
                        />
                      </div>
                      {(renderProgressByClip[clip.id] ?? 0) > 0 && (
                        <p className="mt-1 text-right font-mono text-[11px] text-[rgba(255,255,255,0.4)]">
                          {Math.round(renderProgressByClip[clip.id] ?? 0)}%
                        </p>
                      )}
                    </div>
                  )}

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
