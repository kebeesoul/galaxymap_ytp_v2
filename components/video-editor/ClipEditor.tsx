'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { formatTime } from '@/lib/utils/time'
import { extractLayout } from '@/lib/utils/template'
import {
  DEFAULT_FONT_KEY,
  FONT_KEYS,
  FONT_REGISTRY,
  getFontFamily,
  resolveFontKey,
} from '@/lib/fonts'
import type { Json } from '@/lib/supabase/types'
import type { Clip, LyricsSegment, Comment, Template } from '@/lib/types'
import type { SubtitleStyle, CommentStyle } from '@/remotion/types'
import {
  DEFAULT_TEXT_OVERLAY,
  textOverlaySchema,
  type TextOverlay,
} from '@/lib/text-overlays'
import VideoPreview from './VideoPreview'
import SubtitleEditor from '@/components/subtitle-editor/SubtitleEditor'
import CommentCard from '@/components/comment-card/CommentCard'
import TemplatePicker from '@/components/template-picker/TemplatePicker'
import BgmEditor from '@/components/audio/BgmEditor'
import TextOverlayPanel from '@/components/text-overlay/TextOverlayPanel'

const CanvasPreview = dynamic(() => import('@/components/preview/CanvasPreview'), { ssr: false })
const WaveformEditor = dynamic(() => import('./WaveformEditor'), { ssr: false })

const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  position: 'bottom',
  fontSize: 42,
  bgOpacity: 0.72,
  theme: 'white-on-black',
  font_key: DEFAULT_FONT_KEY,
}

const DEFAULT_COMMENT_STYLE: CommentStyle = {
  theme: 'white-on-black',
  font_key: DEFAULT_FONT_KEY,
  fontScale: 1,
  durationSec: 5,
}

function parseSubtitleStyle(raw: unknown): SubtitleStyle {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_SUBTITLE_STYLE
  const obj = raw as Record<string, unknown>
  return {
    position: (['top', 'center', 'bottom'] as const).includes(obj.position as 'top')
      ? (obj.position as SubtitleStyle['position'])
      : DEFAULT_SUBTITLE_STYLE.position,
    fontSize: typeof obj.fontSize === 'number' ? obj.fontSize : DEFAULT_SUBTITLE_STYLE.fontSize,
    bgOpacity: typeof obj.bgOpacity === 'number' ? obj.bgOpacity : DEFAULT_SUBTITLE_STYLE.bgOpacity,
    theme: obj.theme === 'black-on-white' ? 'black-on-white' : 'white-on-black',
    font_key: resolveFontKey(obj.font_key ?? obj.fontKey ?? obj.fontFamily),
  }
}

function parseCommentStyle(raw: unknown): CommentStyle {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_COMMENT_STYLE
  const obj = raw as Record<string, unknown>
  const fontScale = typeof obj.fontScale === 'number' ? obj.fontScale : DEFAULT_COMMENT_STYLE.fontScale
  const durationSec = typeof obj.durationSec === 'number' ? obj.durationSec : DEFAULT_COMMENT_STYLE.durationSec
  return {
    theme: obj.theme === 'black-on-white' ? 'black-on-white' : 'white-on-black',
    font_key: resolveFontKey(obj.font_key ?? obj.fontKey ?? obj.fontFamily),
    fontScale: Math.min(1.2, Math.max(0.8, fontScale)),
    durationSec: Math.min(8, Math.max(3, durationSec)),
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
    song_lyrics_timestamps: unknown
  }
  initialClips: Clip[]
  initialSegmentsByClip: Record<string, LyricsSegment[]>
  initialCommentsByClip: Record<string, Comment[]>
  initialTextOverlaysByClip: Record<string, TextOverlay[]>
  templates: Template[]
}

const POLL_INTERVAL_MS = 3_000
const POLL_MAX = 300

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
  initialTextOverlaysByClip,
  templates,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const lastTimeRef = useRef(0)

  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)

  // Stable ref callback — prevents WaveSurfer from reinitialising on parent re-renders
  const videoRefCallback = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el
    setVideoEl(el)
  }, [])
  const [currentTime, setCurrentTime] = useState(0)
  // Per-clip preview playback time (absolute video seconds) — drives subtitle active-line highlight
  // and the "싱크 맞추기" tap, so the source of truth is the preview, not the top original video.
  const [previewTimeByClip, setPreviewTimeByClip] = useState<Record<string, number>>({})
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
    bgm_start_sec: number
  }>>(Object.fromEntries(initialClips.map(c => [c.id, {
    bgm_url: c.bgm_url,
    bgm_volume: c.bgm_volume,
    original_volume: c.original_volume,
    bgm_start_sec: (c as Record<string, unknown>).bgm_start_sec as number ?? 0,
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

  const [segmentsByClip, setSegmentsByClip] =
    useState<Record<string, LyricsSegment[]>>(initialSegmentsByClip)

  const [renderStatuses, setRenderStatuses] = useState<Record<string, string | null>>(
    Object.fromEntries(initialClips.map(c => [c.id, c.render_status]))
  )
  const [rendering, setRendering] = useState<Record<string, boolean>>({})
  const [renderErrors, setRenderErrors] = useState<Record<string, string>>({})
  const [renderPaths, setRenderPaths] = useState<Record<string, string>>(
    Object.fromEntries(initialClips.flatMap(c => (c.render_path ? [[c.id, c.render_path]] : [])))
  )
  const [downloading, setDownloading] = useState<Record<string, boolean>>({})
  const [renderPresetsByClip, setRenderPresetsByClip] = useState<Record<string, 'fast' | 'balanced' | 'quality'>>({})

  // C1: subtitle style per clip
  const [subtitleStylesByClip, setSubtitleStylesByClip] = useState<Record<string, SubtitleStyle>>(
    Object.fromEntries(initialClips.map(c => [c.id, parseSubtitleStyle(c.subtitle_style)]))
  )
  const [barEnabledByClip, setBarEnabledByClip] = useState<Record<string, boolean>>(
    Object.fromEntries(initialClips.map(c => [c.id, c.bar_enabled ?? false]))
  )
  const [textOverlaysByClip, setTextOverlaysByClip] =
    useState<Record<string, TextOverlay[]>>(initialTextOverlaysByClip)
  const [selectedTextOverlayIdByClip, setSelectedTextOverlayIdByClip] =
    useState<Record<string, string | null>>(
      Object.fromEntries(initialClips.map((clip) => [
        clip.id,
        initialTextOverlaysByClip[clip.id]?.[0]?.id ?? null,
      ])),
    )

  // comment style per clip
  const [commentStylesByClip, setCommentStylesByClip] = useState<Record<string, CommentStyle>>(
    Object.fromEntries(initialClips.map(c => [c.id, parseCommentStyle(c.comment_style)]))
  )

  // Live subtitle edits from SubtitleEditor — fed into CanvasPreview so unsaved changes show up immediately
  const [liveSegsByClip, setLiveSegsByClip] = useState<Record<string, Array<{ id: string | null; text: string; start_sec: number; end_sec: number }>>>({})
  // Stable seek-and-play function refs per clip — populated by CanvasPreview, called from SubtitleEditor
  const seekAndPlayRefs = useRef<Map<string, { current: ((clipRelSec: number) => void) | null }>>(new Map())
  // Toggle-play refs per clip — populated by CanvasPreview, called from spacebar handler
  const togglePlayRefs = useRef<Map<string, { current: (() => void) | null }>>(new Map())
  // Tracks which player (source video vs. preview) was most recently played — spacebar targets it
  const lastActivePlayerRef = useRef<'source' | 'preview'>('source')
  const lastActiveClipIdRef = useRef<string | null>(null)

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
  const [lyricsError, setLyricsError] = useState<string | null>(null)
  const savedLyricsRef = useRef(project.song_lyrics ?? '')
  // Lyrics scroll container ref for auto-scroll to highlighted region
  const lyricsScrollRef = useRef<HTMLDivElement>(null)
  // Line range for the current clip-in-progress (0-based indices into allLines)
  const [regionLineFrom, setRegionLineFrom] = useState<number | null>(null)
  const [regionLineTo, setRegionLineTo] = useState<number | null>(null)
  // User-adjustable offset (fallback when no timestamps are set)
  const [lyricsShift, setLyricsShift] = useState(0)
  const prevLyricsLineRef = useRef<number | null>(null)

  // Per-line timestamps for accurate sync (parallel array to allLines)
  const [lyricsTimestamps, setLyricsTimestamps] = useState<(number | null)[]>(() => {
    const raw = project.song_lyrics_timestamps
    if (!Array.isArray(raw)) return []
    return raw.map(v => (typeof v === 'number' ? v : null))
  })
  const [lyricsSyncMode, setLyricsSyncMode] = useState(false)
  const [lyricsSyncTapIdx, setLyricsSyncTapIdx] = useState(0)
  const [savingLyricsTimestamps, setSavingLyricsTimestamps] = useState(false)
  const lyricsTapButtonRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

  // Derived lines from project-level lyrics
  const allLines = useMemo(
    () => songLyrics.split('\n').map(l => l.trim()).filter(Boolean),
    [songLyrics]
  )

  const hasLyricsTimestamps = useMemo(
    () => lyricsTimestamps.some(t => t !== null),
    [lyricsTimestamps]
  )

  const pollingIntervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({})
  const pollCountsRef = useRef<Record<string, number>>({})

  // Single stable Supabase client — never recreated on re-render
  const supabase = useMemo(() => createClient(), [])

  const loadSourceUrl = useCallback(async () => {
    if (!project.yt_source_path) return
    setSourceError(null)

    try {
      const response = await fetch(`/api/source-url?project_id=${encodeURIComponent(project.id)}`, {
        cache: 'no-store',
      })
      const body = (await response.json()) as { url?: string; error?: string }
      if (!response.ok || !body.url) {
        throw new Error(body.error ?? 'Failed to load video source')
      }
      setSignedUrl(body.url)
    } catch (error) {
      setSignedUrl(null)
      setSourceError(error instanceof Error ? error.message : 'Failed to load video source')
    }
  }, [project.id, project.yt_source_path])

  // The browser receives an authenticated playback URL, never a local file path.
  useEffect(() => {
    void loadSourceUrl()
  }, [loadSourceUrl])

  // A3: auto-refresh signed URL 10 min before the 1-hour expiry
  useEffect(() => {
    if (!project.yt_source_path) return
    const id = setInterval(() => {
      void loadSourceUrl()
    }, 50 * 60 * 1000)
    return () => clearInterval(id)
  }, [loadSourceUrl, project.yt_source_path])

  // C6: Realtime render_status + external deletes for all clips in this project
  useEffect(() => {
    const channel = supabase
      .channel(`project-${project.id}-clips-render`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'clips', filter: `project_id=eq.${project.id}` },
        (payload) => {
          const raw = payload.new
          if (!raw || typeof raw !== 'object' || !('id' in raw) || typeof (raw as Record<string, unknown>).id !== 'string') {
            console.error('[ClipEditor] Unexpected Realtime payload:', payload.new)
            return
          }
          const row = raw as {
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
          } else if (row.render_status === 'cancelled') {
            stopPolling(row.id)
            setRendering(prev => ({ ...prev, [row.id]: false }))
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'clips', filter: `project_id=eq.${project.id}` },
        (payload) => {
          const deletedId = (payload.old as { id?: string }).id
          if (!deletedId) return
          stopPolling(deletedId)
          setClips(prev => prev.filter(c => c.id !== deletedId))
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
      supabase.from('lyrics_segments').select('*').in('clip_id', clipIds).order('start_sec', { ascending: true }),
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

  // Resume polling for in-progress renders on page load
  useEffect(() => {
    const pollingIntervals = pollingIntervalsRef.current

    for (const clip of initialClips) {
      if (clip.render_status === 'pending' || clip.render_status === 'processing') {
        setRendering(prev => ({ ...prev, [clip.id]: true }))
        startPolling(clip.id)
      }
    }
    return () => {
      for (const id of Object.values(pollingIntervals)) {
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
        // Final DB check before declaring timeout — render may have completed
        try {
          const { data: clipRow } = await supabase
            .from('clips')
            .select('render_status, render_path, render_error, render_progress')
            .eq('id', clipId)
            .single()
          if (clipRow) {
            if (clipRow.render_status === 'success') {
              setRendering(prev => ({ ...prev, [clipId]: false }))
              setRenderStatuses(prev => ({ ...prev, [clipId]: 'success' }))
              if (clipRow.render_path) setRenderPaths(prev => ({ ...prev, [clipId]: clipRow.render_path! }))
              return
            }
            if (clipRow.render_status === 'failed') {
              setRendering(prev => ({ ...prev, [clipId]: false }))
              setRenderStatuses(prev => ({ ...prev, [clipId]: 'failed' }))
              setRenderErrors(prev => ({ ...prev, [clipId]: clipRow.render_error ?? '렌더 실패' }))
              return
            }
          }
        } catch { /* ignore */ }
        setRendering(prev => ({ ...prev, [clipId]: false }))
        setRenderStatuses(prev => ({ ...prev, [clipId]: 'failed' }))
        setRenderErrors(prev => ({ ...prev, [clipId]: '렌더 타임아웃 (15분 초과)' }))
        return
      }

      try {
        const { data: clipRow } = await supabase
          .from('clips')
          .select('render_status, render_path, render_error, render_progress')
          .eq('id', clipId)
          .single()
        if (!clipRow) return

        if (clipRow.render_progress !== undefined && clipRow.render_progress !== null) {
          setRenderProgressByClip(prev => ({ ...prev, [clipId]: clipRow.render_progress! }))
        }
        if (clipRow.render_status === 'success') {
          stopPolling(clipId)
          setRendering(prev => ({ ...prev, [clipId]: false }))
          setRenderStatuses(prev => ({ ...prev, [clipId]: 'success' }))
          if (clipRow.render_path) {
            setRenderPaths(prev => ({ ...prev, [clipId]: clipRow.render_path! }))
          }
        } else if (clipRow.render_status === 'failed') {
          stopPolling(clipId)
          setRendering(prev => ({ ...prev, [clipId]: false }))
          setRenderStatuses(prev => ({ ...prev, [clipId]: 'failed' }))
          setRenderErrors(prev => ({
            ...prev,
            [clipId]: clipRow.render_error ?? '렌더 실패',
          }))
        } else if (clipRow.render_status === 'cancelled') {
          stopPolling(clipId)
          setRendering(prev => ({ ...prev, [clipId]: false }))
          setRenderStatuses(prev => ({ ...prev, [clipId]: 'cancelled' }))
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
      // A9: spacebar play/pause — targets last-active player (source or preview)
      if (e.key === ' ') {
        e.preventDefault()
        if (lastActivePlayerRef.current === 'preview' && lastActiveClipIdRef.current) {
          togglePlayRefs.current.get(lastActiveClipIdRef.current)?.current?.()
        } else {
          const v = videoRef.current
          if (!v) return
          v.paused ? v.play().catch(() => {}) : v.pause()
        }
        return
      }
      if (e.key === 'i' || e.key === 'I') setStartSec(videoRef.current?.currentTime ?? 0)
      if (e.key === 'o' || e.key === 'O') setEndSec(videoRef.current?.currentTime ?? 0)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Resize lyricsTimestamps when lyrics lines change (add/remove lines)
  useEffect(() => {
    setLyricsTimestamps(prev => {
      if (prev.length === allLines.length) return prev
      const next: (number | null)[] = new Array(allLines.length).fill(null)
      for (let i = 0; i < Math.min(prev.length, next.length); i++) next[i] = prev[i]
      return next
    })
  }, [allLines.length])

  // Auto-detect which lyrics lines correspond to the selected waveform region
  useEffect(() => {
    if (startSec === null || endSec === null || allLines.length === 0) {
      setRegionLineFrom(null)
      setRegionLineTo(null)
      return
    }
    if (hasLyricsTimestamps) {
      let from = -1, to = -1
      for (let i = 0; i < lyricsTimestamps.length; i++) {
        const t = lyricsTimestamps[i]
        if (t !== null && t >= startSec && t <= endSec) {
          if (from === -1) from = i
          to = i
        }
      }
      if (from !== -1) {
        setRegionLineFrom(from)
        setRegionLineTo(to)
        return
      }
    }
    const totalDur = project.yt_duration_sec ?? 0
    if (!totalDur) return
    const from = Math.max(0, Math.floor((startSec / totalDur) * allLines.length) + lyricsShift)
    const to = Math.min(
      allLines.length - 1,
      Math.ceil((endSec / totalDur) * allLines.length) - 1 + lyricsShift
    )
    setRegionLineFrom(from)
    setRegionLineTo(Math.max(from, to))
  }, [startSec, endSec, allLines.length, project.yt_duration_sec, hasLyricsTimestamps, lyricsTimestamps, lyricsShift])

  // Current line index driven by playback position — uses explicit timestamps when set
  const currentLyricsLineIdx = useMemo(() => {
    if (allLines.length === 0) return null
    if (hasLyricsTimestamps) {
      let best = -1
      for (let i = 0; i < lyricsTimestamps.length; i++) {
        if (lyricsTimestamps[i] !== null && lyricsTimestamps[i]! <= currentTime) best = i
      }
      if (best >= 0) return best
      const first = lyricsTimestamps.findIndex(t => t !== null)
      return Math.max(0, first - 1)
    }
    if (!project.yt_duration_sec) return null
    const raw = Math.floor((currentTime / project.yt_duration_sec) * allLines.length) + lyricsShift
    return Math.max(0, Math.min(allLines.length - 1, raw))
  }, [currentTime, allLines.length, lyricsTimestamps, hasLyricsTimestamps, project.yt_duration_sec, lyricsShift])

  // Auto-scroll so the currently playing line stays visible; only triggers on line change
  useEffect(() => {
    if (currentLyricsLineIdx === null || currentLyricsLineIdx === prevLyricsLineRef.current) return
    prevLyricsLineRef.current = currentLyricsLineIdx
    if (!lyricsScrollRef.current) return
    const el = lyricsScrollRef.current
    const lineHeight = 28
    el.scrollTo({ top: Math.max(0, currentLyricsLineIdx * lineHeight - el.clientHeight / 2), behavior: 'smooth' })
  }, [currentLyricsLineIdx])

  // Auto-scroll lyrics panel so highlighted region lines are visible (on region change)
  useEffect(() => {
    if (regionLineFrom === null || !lyricsScrollRef.current) return
    const el = lyricsScrollRef.current
    const lineHeight = 28
    const target = regionLineFrom * lineHeight - el.clientHeight / 3
    el.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  }, [regionLineFrom])

  async function handleSaveProjectLyrics() {
    setSavingProjectLyrics(true)
    setLyricsError(null)
    const { error } = await supabase.from('projects').update({ song_lyrics: songLyrics }).eq('id', project.id)
    if (!error) {
      savedLyricsRef.current = songLyrics
      setLyricsEditOpen(false)
    } else {
      setLyricsError(error.message)
    }
    setSavingProjectLyrics(false)
  }

  async function saveLyricsTimestamps(timestamps: (number | null)[]) {
    setSavingLyricsTimestamps(true)
    const resized: (number | null)[] = Array.from({ length: allLines.length }, (_, i) => timestamps[i] ?? null)
    await supabase
      .from('projects')
      .update({ song_lyrics_timestamps: resized as unknown as Json })
      .eq('id', project.id)
    setSavingLyricsTimestamps(false)
  }

  function handleTapLyricsSync(idx: number) {
    const t = videoRef.current?.currentTime ?? currentTime
    const next = [...lyricsTimestamps]
    next[idx] = t
    setLyricsTimestamps(next)
    if (idx === allLines.length - 1) {
      setLyricsSyncMode(false)
      setLyricsSyncTapIdx(0)
      void saveLyricsTimestamps(next)
    } else {
      const nextIdx = idx + 1
      setLyricsSyncTapIdx(nextIdx)
      setTimeout(() => {
        lyricsTapButtonRefs.current.get(nextIdx)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 0)
    }
  }

  function handleResetLyricsTimestamps() {
    const cleared: (number | null)[] = new Array(allLines.length).fill(null)
    setLyricsTimestamps(cleared)
    void saveLyricsTimestamps(cleared)
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
        }
      }

      setClips(prev => [...prev, data])
      setLabelsByClip(prev => ({ ...prev, [data.id]: '' }))
      setRenderStatuses(prev => ({ ...prev, [data.id]: null }))
      setTemplateIdsByClip(prev => ({ ...prev, [data.id]: null }))
      setBgmByClip(prev => ({ ...prev, [data.id]: { bgm_url: null, bgm_volume: 0.3, original_volume: 1.0, bgm_start_sec: 0 } }))
      setCommentsByClip(prev => ({ ...prev, [data.id]: [] }))
      setRawCommentsByClip(prev => ({ ...prev, [data.id]: [] }))
      setSelectedCommentIdxByClip(prev => ({ ...prev, [data.id]: [] }))
      setSubtitleStylesByClip(prev => ({ ...prev, [data.id]: DEFAULT_SUBTITLE_STYLE }))
      setBarEnabledByClip(prev => ({ ...prev, [data.id]: data.bar_enabled ?? false }))
      setTextOverlaysByClip(prev => ({ ...prev, [data.id]: [] }))
      setSelectedTextOverlayIdByClip(prev => ({ ...prev, [data.id]: null }))
      setCommentStylesByClip(prev => ({ ...prev, [data.id]: DEFAULT_COMMENT_STYLE }))
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

  async function handleSaveBarEnabled(clipId: string, enabled: boolean) {
    setBarEnabledByClip(prev => ({ ...prev, [clipId]: enabled }))
    await supabase.from('clips').update({ bar_enabled: enabled }).eq('id', clipId)
  }

  function handleDraftTextOverlay(clipId: string, overlay: TextOverlay) {
    setTextOverlaysByClip((previous) => ({
      ...previous,
      [clipId]: (previous[clipId] ?? []).map((item) =>
        item.id === overlay.id ? overlay : item
      ),
    }))
  }

  async function handleCommitTextOverlay(clipId: string, overlay: TextOverlay) {
    handleDraftTextOverlay(clipId, overlay)
    await supabase
      .from('text_overlays')
      .update({
        zone: overlay.zone,
        content: overlay.content,
        x: overlay.x,
        y: overlay.y,
        rotation: overlay.rotation,
        font_key: overlay.font_key,
        size: overlay.size,
        color: overlay.color,
        align: overlay.align,
        effect: overlay.effect,
        z_index: overlay.z_index,
        start_sec: overlay.start_sec,
        end_sec: overlay.end_sec,
      })
      .eq('id', overlay.id)
  }

  async function handleAddTextOverlay(clipId: string) {
    if (!(barEnabledByClip[clipId] ?? false)) {
      await handleSaveBarEnabled(clipId, true)
    }
    const zIndex = (textOverlaysByClip[clipId] ?? []).length
    const { data, error } = await supabase
      .from('text_overlays')
      .insert({
        clip_id: clipId,
        ...DEFAULT_TEXT_OVERLAY,
        z_index: zIndex,
      })
      .select()
      .single()
    if (error || !data) return
    const parsed = textOverlaySchema.safeParse(data)
    if (!parsed.success) return
    setTextOverlaysByClip((previous) => ({
      ...previous,
      [clipId]: [...(previous[clipId] ?? []), parsed.data],
    }))
    setSelectedTextOverlayIdByClip((previous) => ({
      ...previous,
      [clipId]: parsed.data.id,
    }))
  }

  async function handleDeleteTextOverlay(clipId: string, overlayId: string) {
    const { error } = await supabase.from('text_overlays').delete().eq('id', overlayId)
    if (error) return
    setTextOverlaysByClip((previous) => {
      const next = (previous[clipId] ?? []).filter((overlay) => overlay.id !== overlayId)
      setSelectedTextOverlayIdByClip((selected) => ({
        ...selected,
        [clipId]: next[0]?.id ?? null,
      }))
      return { ...previous, [clipId]: next }
    })
  }

  async function handleSaveCommentStyle(clipId: string, style: CommentStyle) {
    setCommentStylesByClip(prev => ({ ...prev, [clipId]: style }))
    await supabase.from('clips').update({ comment_style: style as unknown as Json }).eq('id', clipId)
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
        bar_enabled: barEnabledByClip[clipId] ?? clip.bar_enabled ?? false,
        subtitle_style: clip.subtitle_style,
        comment_style: clip.comment_style,
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
    const overlays = textOverlaysByClip[clipId] ?? []
    let duplicatedOverlays: TextOverlay[] = []
    if (overlays.length > 0) {
      const { data: newOverlays } = await supabase
        .from('text_overlays')
        .insert(overlays.map(({ id: _id, clip_id: _clipId, ...overlay }) => ({
          ...overlay,
          clip_id: newClip.id,
        })))
        .select()
      duplicatedOverlays = (newOverlays ?? []).flatMap((row) => {
        const parsed = textOverlaySchema.safeParse(row)
        return parsed.success ? [parsed.data] : []
      })
    }
    setClips(prev => [...prev, newClip])
    setLabelsByClip(prev => ({ ...prev, [newClip.id]: newClip.label ?? '' }))
    setRenderStatuses(prev => ({ ...prev, [newClip.id]: null }))
    setTemplateIdsByClip(prev => ({ ...prev, [newClip.id]: newClip.template_id }))
    setBgmByClip(prev => ({ ...prev, [newClip.id]: { bgm_url: null, bgm_volume: 0.3, original_volume: 1.0, bgm_start_sec: 0 } }))
    setCommentsByClip(prev => ({ ...prev, [newClip.id]: [] }))
    setRawCommentsByClip(prev => ({ ...prev, [newClip.id]: [] }))
    setSelectedCommentIdxByClip(prev => ({ ...prev, [newClip.id]: [] }))
    setSubtitleStylesByClip(prev => ({ ...prev, [newClip.id]: parseSubtitleStyle(newClip.subtitle_style) }))
    setBarEnabledByClip(prev => ({ ...prev, [newClip.id]: newClip.bar_enabled ?? false }))
    setTextOverlaysByClip(prev => ({ ...prev, [newClip.id]: duplicatedOverlays }))
    setSelectedTextOverlayIdByClip(prev => ({
      ...prev,
      [newClip.id]: duplicatedOverlays[0]?.id ?? null,
    }))
    setCommentStylesByClip(prev => ({ ...prev, [newClip.id]: parseCommentStyle(newClip.comment_style) }))
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
    const res = await fetch(`/api/clips/${clipId}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 404) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      alert(`클립 삭제 실패: ${body.error ?? `HTTP ${res.status}`}`)
      return
    }
    stopPolling(clipId)
    setClips(prev => prev.filter(c => c.id !== clipId))
    const cleanup = <T,>(rec: Record<string, T>) => {
      const n = { ...rec }
      delete n[clipId]
      return n
    }
    setSegmentsByClip(cleanup)
    setRenderStatuses(cleanup)
    setRendering(cleanup)
    setRenderErrors(cleanup)
    setRenderPaths(cleanup)
    setDownloading(cleanup)
    setLabelsByClip(cleanup)
    setTemplateIdsByClip(cleanup)
    setBgmByClip(cleanup)
    setCommentsByClip(cleanup)
    setRawCommentsByClip(cleanup)
    setSelectedCommentIdxByClip(cleanup)
    setSubtitleStylesByClip(cleanup)
    setTextOverlaysByClip(cleanup)
    setSelectedTextOverlayIdByClip(cleanup)
    setCommentStylesByClip(cleanup)
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
    const ids = Array.from(selectedClipIds)
    const results = await Promise.all(
      ids.map(clipId =>
        fetch(`/api/clips/${clipId}`, { method: 'DELETE' }).then(r => ({ clipId, ok: r.ok || r.status === 404 }))
      )
    )
    const succeeded = results.filter(r => r.ok).map(r => r.clipId)
    const failedCount = results.length - succeeded.length
    if (failedCount > 0) alert(`${failedCount}개 클립 삭제 실패`)
    for (const clipId of succeeded) stopPolling(clipId)
    setClips(prev => prev.filter(c => !succeeded.includes(c.id)))
    const cleanup = <T,>(rec: Record<string, T>) => {
      const n = { ...rec }
      for (const id of succeeded) delete n[id]
      return n
    }
    setSegmentsByClip(cleanup)
    setRenderStatuses(cleanup); setRendering(cleanup)
    setRenderErrors(cleanup); setRenderPaths(cleanup); setDownloading(cleanup)
    setLabelsByClip(cleanup); setTemplateIdsByClip(cleanup); setBgmByClip(cleanup)
    setCommentsByClip(cleanup); setRawCommentsByClip(cleanup)
    setSelectedCommentIdxByClip(cleanup)
    setSubtitleStylesByClip(cleanup); setCommentStylesByClip(cleanup); setRenderProgressByClip(cleanup)
    setTextOverlaysByClip(cleanup); setSelectedTextOverlayIdByClip(cleanup)
    setSelectedClipIds(prev => {
      const n = new Set(prev)
      for (const id of succeeded) n.delete(id)
      return n
    })
    if (loopingClipRef.current && succeeded.includes(loopingClipRef.current.clipId)) {
      loopingClipRef.current = null
      setLoopingClipId(null)
    }
  }

  async function handleBatchApplyTemplate(templateId: string) {
    for (const clipId of Array.from(selectedClipIds)) {
      await supabase.from('clips').update({ template_id: templateId }).eq('id', clipId)
      setTemplateIdsByClip(prev => ({ ...prev, [clipId]: templateId }))
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

    // Auto-save unsaved timecode edits before rendering
    const liveSegs = liveSegsByClip[clipId]
    if (liveSegs && liveSegs.length > 0) {
      try {
        const toUpdate = liveSegs.filter(s => s.id !== null)
        const toInsert = liveSegs.filter(s => s.id === null).map((s, i) => ({
          clip_id: clipId,
          text: s.text,
          start_sec: s.start_sec,
          end_sec: s.end_sec,
          order: i,
        }))
        await Promise.all([
          ...toUpdate.map(s =>
            supabase
              .from('lyrics_segments')
              .update({ text: s.text, start_sec: s.start_sec, end_sec: s.end_sec })
              .eq('id', s.id!)
          ),
          ...(toInsert.length > 0
            ? [supabase.from('lyrics_segments').insert(toInsert)]
            : []),
        ])
      } catch { /* non-fatal — proceed with render */ }
    }

    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clip_id: clipId, preset: renderPresetsByClip[clipId] ?? 'balanced' }),
      })
      const body = (await res.json()) as {
        queued?: boolean
        error?: string
        render_status?: string
      }
      if (res.status === 409 && body.render_status === 'processing') {
        setRenderStatuses(prev => ({ ...prev, [clipId]: 'processing' }))
        startPolling(clipId)
        return
      }
      if (!res.ok) throw new Error(body.error ?? 'Render failed')
      startPolling(clipId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Render failed'
      setRenderStatuses(prev => ({ ...prev, [clipId]: 'failed' }))
      setRenderErrors(prev => ({ ...prev, [clipId]: msg }))
      setRendering(prev => ({ ...prev, [clipId]: false }))
    }
  }

  async function handleCancelRender(clipId: string) {
    stopPolling(clipId)
    setRendering(prev => ({ ...prev, [clipId]: false }))
    setRenderStatuses(prev => ({ ...prev, [clipId]: 'cancelled' }))
    try {
      await fetch('/api/render/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clip_id: clipId }),
      })
    } catch { /* ignore — UI already updated */ }
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

  // Stable props for CanvasPreview — prevents memo() from failing on every onTimeUpdate tick
  const canvasClipsByClip = useMemo(() =>
    Object.fromEntries(clips.map(c => [c.id, {
      start_sec:      Number(c.start_sec),
      end_sec:        Number(c.end_sec),
      bgm_url:        bgmByClip[c.id]?.bgm_url ?? null,
      bgm_volume:     bgmByClip[c.id]?.bgm_volume ?? c.bgm_volume,
      original_volume: bgmByClip[c.id]?.original_volume ?? c.original_volume,
      bgm_start_sec:  bgmByClip[c.id]?.bgm_start_sec ?? (c as Record<string, unknown>).bgm_start_sec as number ?? 0,
      bar_enabled:    barEnabledByClip[c.id] ?? false,
      subtitle_style: subtitleStylesByClip[c.id] ?? null,
      comment_style:  commentStylesByClip[c.id] ?? null,
      text_overlays:  textOverlaysByClip[c.id] ?? [],
    }])),
    [clips, bgmByClip, barEnabledByClip, subtitleStylesByClip, commentStylesByClip, textOverlaysByClip]
  )

  const canvasSegsByClip = useMemo(() =>
    Object.fromEntries(clips.map(c => {
      const segs = segmentsByClip[c.id] ?? []
      return [c.id, liveSegsByClip[c.id] ??
        segs.map(s => ({ text: s.text, start_sec: s.start_sec, end_sec: s.end_sec }))]
    })),
    [clips, segmentsByClip, liveSegsByClip]
  )

  const canvasCommentsByClip = useMemo(() =>
    Object.fromEntries(clips.map(c => {
      const all = commentsByClip[c.id] ?? []
      const sel = selectedCommentIdxByClip[c.id] ?? []
      return [c.id, sel.length > 0 ? all.filter((_, i) => sel.includes(i)) : all]
    })),
    [clips, commentsByClip, selectedCommentIdxByClip]
  )

  const canvasTimeUpdatesByClip = useMemo(() =>
    Object.fromEntries(clips.map(c => [
      c.id,
      (t: number) => setPreviewTimeByClip(prev => ({ ...prev, [c.id]: t })),
    ])),
    [clips]
  )

  const canvasActivateByClip = useMemo(() =>
    Object.fromEntries(clips.map(c => [c.id, () => {
      lastActivePlayerRef.current = 'preview'
      lastActiveClipIdRef.current = c.id
    }])),
    [clips]
  )

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
            onPlay={() => { lastActivePlayerRef.current = 'source' }}
          />
        ) : (
          <div>
            <VideoPreview
              thumbnailUrl={project.yt_thumbnail_url}
              title={project.yt_title}
              durationSec={project.yt_duration_sec}
            />
            {sourceError && (
              <div className="flex items-center justify-between gap-4 bg-red-950/40 px-4 py-3">
                <p className="text-[13px] text-red-300">{sourceError}</p>
                <button
                  type="button"
                  onClick={() => void loadSourceUrl()}
                  className="shrink-0 text-[13px] text-[#2997ff] hover:underline"
                >
                  다시 불러오기
                </button>
              </div>
            )}
          </div>
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
            {hasLyricsTimestamps && !lyricsEditOpen && (
              <span className="text-[11px] text-[#2997ff]/60">싱크 완료</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {allLines.length > 0 && !lyricsEditOpen && lyricsSyncMode && (
              <>
                <span className="text-[11px] text-red-400/80">
                  다음: {lyricsSyncTapIdx + 1}번 줄
                </span>
                <button
                  onClick={() => {
                    void saveLyricsTimestamps(lyricsTimestamps)
                    setLyricsSyncMode(false)
                    setLyricsSyncTapIdx(0)
                  }}
                  disabled={savingLyricsTimestamps}
                  className="rounded-lg bg-[#0071e3] px-3 py-1 text-[12px] text-white disabled:opacity-40"
                >
                  {savingLyricsTimestamps ? '저장 중…' : '저장'}
                </button>
                <button
                  onClick={() => { setLyricsSyncMode(false); setLyricsSyncTapIdx(0) }}
                  className="text-[12px] text-[rgba(255,255,255,0.35)] transition-colors hover:text-white"
                >
                  취소
                </button>
              </>
            )}
            {allLines.length > 0 && !lyricsEditOpen && !lyricsSyncMode && (
              <>
                {!hasLyricsTimestamps && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setLyricsShift(s => s - 1)}
                      className="flex h-5 w-5 items-center justify-center rounded bg-[#272729] text-[13px] text-[rgba(255,255,255,0.5)] transition-colors hover:bg-[#2a2a2d] hover:text-white"
                      title="가사 1줄 앞으로"
                    >
                      −
                    </button>
                    <span className="w-8 text-center font-mono text-[11px] text-[rgba(255,255,255,0.4)]">
                      {lyricsShift > 0 ? `+${lyricsShift}` : lyricsShift}
                    </span>
                    <button
                      onClick={() => setLyricsShift(s => s + 1)}
                      className="flex h-5 w-5 items-center justify-center rounded bg-[#272729] text-[13px] text-[rgba(255,255,255,0.5)] transition-colors hover:bg-[#2a2a2d] hover:text-white"
                      title="가사 1줄 뒤로"
                    >
                      +
                    </button>
                  </div>
                )}
                {hasLyricsTimestamps && (
                  <button
                    onClick={handleResetLyricsTimestamps}
                    className="text-[11px] text-[rgba(255,255,255,0.25)] transition-colors hover:text-red-400"
                    title="싱크 초기화"
                  >
                    초기화
                  </button>
                )}
                <button
                  onClick={() => {
                    setLyricsSyncMode(true)
                    setLyricsSyncTapIdx(0)
                  }}
                  className="rounded-lg bg-[#272729] px-3 py-1 text-[12px] text-[rgba(255,255,255,0.5)] transition-colors hover:bg-[#2a2a2d] hover:text-white"
                >
                  싱크 맞추기
                </button>
              </>
            )}
            {!lyricsEditOpen && !lyricsSyncMode && (
              <button
                onClick={() => setLyricsEditOpen(true)}
                className="text-[12px] text-[rgba(255,255,255,0.35)] transition-colors hover:text-white"
              >
                {allLines.length > 0 ? '수정' : '입력'}
              </button>
            )}
          </div>
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
            {lyricsError && (
              <p className="mb-2 text-[12px] text-red-400">{lyricsError}</p>
            )}
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[12px] text-[rgba(255,255,255,0.3)]">{allLines.length}줄</span>
              <div className="flex gap-2">
                {savedLyricsRef.current && (
                  <button
                    onClick={() => { setSongLyrics(savedLyricsRef.current); setLyricsEditOpen(false); setLyricsError(null) }}
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
            {lyricsSyncMode && (
              <p className="mb-2 text-[11px] text-red-400/80">
                ▶ 음악 재생 후, 각 줄이 시작되는 순간 ● 버튼을 누르세요 — 강조된 줄이 다음 차례
              </p>
            )}
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
                  const isCurrent = currentLyricsLineIdx === i
                  const isNextTap = lyricsSyncMode && i === lyricsSyncTapIdx
                  const ts = lyricsTimestamps[i]
                  if (lyricsSyncMode) {
                    return (
                      <div
                        key={i}
                        className={`flex items-center gap-2 rounded px-2 py-0.5 ${isNextTap ? 'bg-red-500/10' : ''}`}
                      >
                        <button
                          ref={el => {
                            if (el) lyricsTapButtonRefs.current.set(i, el)
                            else lyricsTapButtonRefs.current.delete(i)
                          }}
                          type="button"
                          onClick={() => handleTapLyricsSync(i)}
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white transition-all hover:scale-110 active:scale-95 ${
                            isNextTap
                              ? 'scale-110 bg-red-500 ring-2 ring-red-400 ring-offset-1 ring-offset-[#1d1d1f]'
                              : 'bg-red-900/50 hover:bg-red-500'
                          }`}
                          title="지금 재생 위치로 싱크"
                        >
                          <span className="text-[8px] leading-none">●</span>
                        </button>
                        <span className="flex-1 text-[13px] leading-snug text-[rgba(255,255,255,0.6)]">
                          {line}
                        </span>
                        {ts !== null && (
                          <span className="font-mono text-[10px] text-[#2997ff]/60">
                            {formatTime(ts)}
                          </span>
                        )}
                      </div>
                    )
                  }
                  return (
                    <div
                      key={i}
                      onClick={() => handleLyricsLineClick(i)}
                      className={`flex cursor-pointer select-none items-center gap-3 rounded px-2 py-1 transition-colors ${
                        isCurrent
                          ? 'bg-[rgba(255,255,255,0.07)]'
                          : inRange
                            ? 'bg-[#0071e3]/25 hover:bg-[#0071e3]/35'
                            : 'hover:bg-[#272729]'
                      }`}
                    >
                      <span className={`w-5 shrink-0 text-right font-mono text-[11px] ${
                        isCurrent ? 'text-white' : inRange ? 'text-[#2997ff]' : 'text-[rgba(255,255,255,0.2)]'
                      }`}>
                        {isCurrent ? '▶' : i + 1}
                      </span>
                      <span className={`flex-1 text-[13px] leading-snug ${
                        isCurrent ? 'font-medium text-white' : inRange ? 'text-white' : 'text-[rgba(255,255,255,0.45)]'
                      }`}>
                        {line}
                      </span>
                      {ts !== null && (
                        <span className={`font-mono text-[10px] ${isCurrent ? 'text-[#2997ff]' : 'text-[rgba(255,255,255,0.18)]'}`}>
                          {formatTime(ts)}
                        </span>
                      )}
                    </div>
                  )
                })
              )}
            </div>
            {!lyricsSyncMode && allLines.length > 0 && regionLineFrom !== null && regionLineTo !== null && (
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
            const segments = segmentsByClip[clip.id] ?? []

            // Lazy-init stable refs for this clip
            if (!seekAndPlayRefs.current.has(clip.id)) {
              seekAndPlayRefs.current.set(clip.id, { current: null })
            }
            if (!togglePlayRefs.current.has(clip.id)) {
              togglePlayRefs.current.set(clip.id, { current: null })
            }
            const seekAndPlayRef = seekAndPlayRefs.current.get(clip.id)!
            const togglePlayRef = togglePlayRefs.current.get(clip.id)!
            const comments = rawCommentsByClip[clip.id] ?? []
            const textOverlays = textOverlaysByClip[clip.id] ?? []
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

                <div className="md:grid md:grid-cols-[minmax(0,360px)_minmax(0,1fr)] md:gap-2 space-y-2 md:space-y-0">

                {/* C1: subtitle style + editor (merged) */}
                <details className="group rounded-xl bg-[#1d1d1f] md:col-start-2" open>
                  <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-[12px] text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.6)]">
                    <span className="font-semibold uppercase tracking-[0.08em]">
                      자막{segments.length > 0 ? ` (${segments.length})` : ''}
                    </span>
                    <span className="transition-transform duration-200 group-open:rotate-180">▾</span>
                  </summary>
                  <div className="px-5 pb-4">
                    {/* Style controls */}
                    <div className="mb-4 space-y-3">
                      {/* Position */}
                      <div>
                        <p className="mb-1.5 text-[11px] text-[rgba(255,255,255,0.3)]">위치</p>
                        <div className="flex gap-1">
                          {(['top', 'center', 'bottom'] as const).map(pos => (
                            <button
                              key={pos}
                              onClick={() => handleSaveSubtitleStyle(clip.id, { ...(subtitleStylesByClip[clip.id] ?? DEFAULT_SUBTITLE_STYLE), position: pos })}
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
                      {/* Font size — slider in % relative to 42px base */}
                      <div>
                        {(() => {
                          const fontSize = (subtitleStylesByClip[clip.id] ?? DEFAULT_SUBTITLE_STYLE).fontSize
                          const fontPct = Math.round((fontSize / DEFAULT_SUBTITLE_STYLE.fontSize - 1) * 100)
                          const fontPctLabel = fontPct > 0 ? `+${fontPct}%` : `${fontPct}%`
                          return (
                            <>
                              <p className="mb-1.5 text-[11px] text-[rgba(255,255,255,0.3)]">
                                폰트 크기{' '}
                                <span className="text-white">{fontPctLabel}</span>
                              </p>
                              <input
                                type="range" min={-20} max={50} step={5}
                                value={fontPct}
                                onChange={e => {
                                  const pct = Number(e.target.value)
                                  const px = Math.round(DEFAULT_SUBTITLE_STYLE.fontSize * (1 + pct / 100))
                                  setSubtitleStylesByClip(prev => ({
                                    ...prev,
                                    [clip.id]: { ...(prev[clip.id] ?? DEFAULT_SUBTITLE_STYLE), fontSize: px },
                                  }))
                                }}
                                onMouseUp={() => handleSaveSubtitleStyle(clip.id, subtitleStylesByClip[clip.id] ?? DEFAULT_SUBTITLE_STYLE)}
                                className="w-full accent-[#0071e3]"
                              />
                            </>
                          )
                        })()}
                      </div>
                      {/* Background opacity */}
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
                      {/* Text theme */}
                      <div>
                        <p className="mb-1.5 text-[11px] text-[rgba(255,255,255,0.3)]">텍스트 스타일</p>
                        <div className="flex gap-1">
                          {([
                            { value: 'white-on-black', label: '흰글씨+검정배경' },
                            { value: 'black-on-white', label: '검정글씨+흰배경' },
                          ] as const).map(opt => (
                            <button
                              key={opt.value}
                              onClick={() => handleSaveSubtitleStyle(clip.id, { ...(subtitleStylesByClip[clip.id] ?? DEFAULT_SUBTITLE_STYLE), theme: opt.value })}
                              className={`flex-1 rounded-md py-1.5 text-[12px] transition-colors ${
                                (subtitleStylesByClip[clip.id] ?? DEFAULT_SUBTITLE_STYLE).theme === opt.value
                                  ? 'bg-[#0071e3] text-white'
                                  : 'bg-[#272729] text-[rgba(255,255,255,0.5)] hover:bg-[#2a2a2d]'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Font family */}
                      <div>
                        <p className="mb-1.5 text-[11px] text-[rgba(255,255,255,0.3)]">폰트</p>
                        <div className="grid grid-cols-3 gap-1.5">
                          {FONT_KEYS.map(fontKey => (
                            <button
                              key={fontKey}
                              onClick={() => handleSaveSubtitleStyle(clip.id, { ...(subtitleStylesByClip[clip.id] ?? DEFAULT_SUBTITLE_STYLE), font_key: fontKey })}
                              style={{
                                fontFamily: `'${getFontFamily(fontKey)}', sans-serif`,
                                fontWeight: FONT_REGISTRY[fontKey].weight,
                              }}
                              className={`rounded-md py-2 text-[12px] transition-colors ${
                                (subtitleStylesByClip[clip.id] ?? DEFAULT_SUBTITLE_STYLE).font_key === fontKey
                                  ? 'bg-[#0071e3] text-white'
                                  : 'bg-[#272729] text-[rgba(255,255,255,0.6)] hover:bg-[#2a2a2d]'
                              }`}
                            >
                              {FONT_REGISTRY[fontKey].label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {segments.length > 0 && (
                      <div className="border-t border-[rgba(255,255,255,0.06)] pt-4">
                        <SubtitleEditor
                          key={`${clip.id}-${segments.length}`}
                          clipId={clip.id}
                          initialSegments={segments}
                          currentTime={previewTimeByClip[clip.id]}
                          clipStartSec={Number(clip.start_sec)}
                          clipEndSec={Number(clip.end_sec)}
                          noWrapper
                          onSegmentsChange={(segs) => setLiveSegsByClip(prev => ({ ...prev, [clip.id]: segs }))}
                          onSeekAndPlay={(relSec) => seekAndPlayRefs.current.get(clip.id)?.current?.(relSec)}
                        />
                      </div>
                    )}
                  </div>
                </details>

                {/* ② 댓글 */}
                <details className="group rounded-xl bg-[#1d1d1f] md:col-start-2" open>
                  <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-[12px] text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.6)]">
                    <span className="font-semibold uppercase tracking-[0.08em]">
                      댓글 ({comments.length})
                    </span>
                    <span className="transition-transform duration-200 group-open:rotate-180">▾</span>
                  </summary>
                  <div className="px-5 pb-4">
                    {/* Comment style controls */}
                    <div className="mb-4 space-y-3">
                      <div>
                        <p className="mb-1.5 text-[11px] text-[rgba(255,255,255,0.3)]">폰트</p>
                        <div className="grid grid-cols-3 gap-1.5">
                          {FONT_KEYS.map(fontKey => (
                            <button
                              key={fontKey}
                              onClick={() => handleSaveCommentStyle(clip.id, { ...(commentStylesByClip[clip.id] ?? DEFAULT_COMMENT_STYLE), font_key: fontKey })}
                              style={{
                                fontFamily: `'${getFontFamily(fontKey)}', sans-serif`,
                                fontWeight: FONT_REGISTRY[fontKey].weight,
                              }}
                              className={`rounded-md py-2 text-[12px] transition-colors ${
                                (commentStylesByClip[clip.id] ?? DEFAULT_COMMENT_STYLE).font_key === fontKey
                                  ? 'bg-[#0071e3] text-white'
                                  : 'bg-[#272729] text-[rgba(255,255,255,0.6)] hover:bg-[#2a2a2d]'
                              }`}
                            >
                              {FONT_REGISTRY[fontKey].label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Font scale: -20% ~ +20% */}
                      <div>
                        <p className="mb-1.5 text-[11px] text-[rgba(255,255,255,0.3)]">
                          폰트 크기{' '}
                          <span className="text-white">
                            {Math.round(((commentStylesByClip[clip.id] ?? DEFAULT_COMMENT_STYLE).fontScale - 1) * 100) >= 0 ? '+' : ''}
                            {Math.round(((commentStylesByClip[clip.id] ?? DEFAULT_COMMENT_STYLE).fontScale - 1) * 100)}%
                          </span>
                        </p>
                        <input
                          type="range" min={0.8} max={1.2} step={0.05}
                          value={(commentStylesByClip[clip.id] ?? DEFAULT_COMMENT_STYLE).fontScale}
                          onChange={e => setCommentStylesByClip(prev => ({
                            ...prev,
                            [clip.id]: { ...(prev[clip.id] ?? DEFAULT_COMMENT_STYLE), fontScale: Number(e.target.value) },
                          }))}
                          onMouseUp={() => handleSaveCommentStyle(clip.id, commentStylesByClip[clip.id] ?? DEFAULT_COMMENT_STYLE)}
                          className="w-full accent-[#0071e3]"
                        />
                      </div>
                      {/* Per-comment duration: 3 ~ 8 sec */}
                      <div>
                        <p className="mb-1.5 text-[11px] text-[rgba(255,255,255,0.3)]">
                          댓글 표시 시간{' '}
                          <span className="text-white">
                            {(commentStylesByClip[clip.id] ?? DEFAULT_COMMENT_STYLE).durationSec.toFixed(1)}초
                          </span>
                        </p>
                        <input
                          type="range" min={3} max={8} step={0.5}
                          value={(commentStylesByClip[clip.id] ?? DEFAULT_COMMENT_STYLE).durationSec}
                          onChange={e => setCommentStylesByClip(prev => ({
                            ...prev,
                            [clip.id]: { ...(prev[clip.id] ?? DEFAULT_COMMENT_STYLE), durationSec: Number(e.target.value) },
                          }))}
                          onMouseUp={() => handleSaveCommentStyle(clip.id, commentStylesByClip[clip.id] ?? DEFAULT_COMMENT_STYLE)}
                          className="w-full accent-[#0071e3]"
                        />
                      </div>
                    </div>
                    <div className="border-t border-[rgba(255,255,255,0.06)] pt-4">
                      <CommentCard
                        key={`${clip.id}-comments-${comments.length}`}
                        clipId={clip.id}
                        videoId={project.yt_video_id ?? ''}
                        initialComments={comments}
                        selectedIndices={selectedCommentIdx}
                        onSelectionChange={(indices) => setSelectedCommentIdxByClip(prev => ({ ...prev, [clip.id]: indices }))}
                        onCommentsChange={(cmts) => setCommentsByClip(prev => ({ ...prev, [clip.id]: cmts }))}
                        noWrapper
                      />
                    </div>
                  </div>
                </details>

                <div className="md:col-start-2">
                {/* ③ 템플릿 */}
                <TemplatePicker
                  clipId={clip.id}
                  initialTemplateId={clip.template_id}
                  templates={templates}
                  onSelect={(id) => setTemplateIdsByClip(prev => ({ ...prev, [clip.id]: id }))}
                />
                <button
                  type="button"
                  onClick={() => {
                    void handleSaveBarEnabled(clip.id, !(barEnabledByClip[clip.id] ?? false))
                  }}
                  className={`mt-2 flex w-full items-center justify-between rounded-lg px-4 py-3 text-[13px] transition-colors ${
                    (barEnabledByClip[clip.id] ?? false)
                      ? 'bg-[#0071e3]/20 text-[#2997ff] ring-1 ring-[#2997ff]/40'
                      : 'bg-[#1d1d1f] text-[rgba(255,255,255,0.6)] hover:bg-[#272729]'
                  }`}
                >
                  <span>상·하단 블랙 바</span>
                  <span>{(barEnabledByClip[clip.id] ?? false) ? '15% 켜짐' : '꺼짐'}</span>
                </button>
                </div>

                <TextOverlayPanel
                  overlays={textOverlays}
                  selectedId={selectedTextOverlayIdByClip[clip.id] ?? null}
                  onSelect={(id) => setSelectedTextOverlayIdByClip((previous) => ({
                    ...previous,
                    [clip.id]: id,
                  }))}
                  onAdd={() => void handleAddTextOverlay(clip.id)}
                  onDelete={(id) => void handleDeleteTextOverlay(clip.id, id)}
                  onChange={(overlay) => void handleCommitTextOverlay(clip.id, overlay)}
                />

                <div className="md:col-start-2">
                {/* ④ BGM */}
                <BgmEditor
                  clipId={clip.id}
                  clipDuration={clip.end_sec - clip.start_sec}
                  initialBgmUrl={clip.bgm_url}
                  initialBgmVolume={clip.bgm_volume}
                  initialOriginalVolume={clip.original_volume}
                  initialBgmStartSec={(clip as Record<string, unknown>).bgm_start_sec as number ?? 0}
                  onSave={(state) => setBgmByClip(prev => ({ ...prev, [clip.id]: state }))}
                  onVolumeChange={(state) =>
                    setBgmByClip(prev => {
                      const cur = prev[clip.id] ?? { bgm_url: clip.bgm_url ?? null, bgm_volume: clip.bgm_volume ?? 0.3, original_volume: clip.original_volume ?? 1.0, bgm_start_sec: (clip as Record<string, unknown>).bgm_start_sec as number ?? 0 }
                      return { ...prev, [clip.id]: { ...cur, ...state } }
                    })
                  }
                />
                </div>

                {/* Sticky left sidebar — preview + render */}
                <div className="md:col-start-1 md:row-start-1 md:sticky md:top-4 md:self-start space-y-2">
                {/* ⑤ 미리보기 */}
                <CanvasPreview
                  clip={canvasClipsByClip[clip.id]}
                  segments={canvasSegsByClip[clip.id]}
                  comments={canvasCommentsByClip[clip.id]}
                  layout={getLayoutForClip(templates, templateIdsByClip[clip.id] ?? null)}
                  signedUrl={signedUrl}
                  onTimeUpdate={canvasTimeUpdatesByClip[clip.id]}
                  seekAndPlayRef={seekAndPlayRef}
                  togglePlayRef={togglePlayRef}
                  onActivate={canvasActivateByClip[clip.id]}
                  selectedTextOverlayId={selectedTextOverlayIdByClip[clip.id] ?? null}
                  onSelectTextOverlay={(id) => setSelectedTextOverlayIdByClip((previous) => ({
                    ...previous,
                    [clip.id]: id,
                  }))}
                  onDraftTextOverlay={(overlay) => handleDraftTextOverlay(clip.id, overlay)}
                  onCommitTextOverlay={(overlay) => void handleCommitTextOverlay(clip.id, overlay)}
                />

                {/* ⑥ 렌더 */}
                <details className="group rounded-xl bg-[#1d1d1f]" open>
                  <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-[12px] text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.6)]">
                    <span className="flex items-center gap-2 font-semibold uppercase tracking-[0.08em]">
                      렌더
                      {renderStatus === 'success' && (
                        <span className="text-emerald-400">완료</span>
                      )}
                      {(isRendering || renderStatus === 'pending' || renderStatus === 'processing') && (
                        <span className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white" />
                      )}
                    </span>
                    <span className="transition-transform duration-200 group-open:rotate-180">▾</span>
                  </summary>

                  <div className="px-5 pb-4">
                    {/* Render quality preset selector */}
                    <div className="mb-3 flex rounded-lg bg-[#272729] p-0.5">
                      {(['fast', 'balanced', 'quality'] as const).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setRenderPresetsByClip(prev => ({ ...prev, [clip.id]: p }))}
                          disabled={isRendering || renderStatus === 'pending' || renderStatus === 'processing'}
                          className={`flex-1 rounded-md py-1.5 text-[12px] transition-colors disabled:opacity-40 ${
                            (renderPresetsByClip[clip.id] ?? 'balanced') === p
                              ? 'bg-[#0071e3] text-white'
                              : 'bg-transparent text-[rgba(255,255,255,0.5)] hover:bg-[#2a2a2d]'
                          }`}
                        >
                          {p === 'fast' ? '빠름' : p === 'balanced' ? '균형' : '고품질'}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleRender(clip.id)}
                        disabled={isRendering || renderStatus === 'pending' || renderStatus === 'processing'}
                        className="ml-auto flex items-center gap-2 rounded-lg bg-[#0071e3] px-4 py-1.5 text-[13px] text-white transition-colors hover:bg-[#0077ed] disabled:opacity-40"
                      >
                        {isRendering || renderStatus === 'pending' || renderStatus === 'processing' ? (
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
                      {(isRendering || renderStatus === 'pending' || renderStatus === 'processing') && (
                        <button
                          onClick={() => handleCancelRender(clip.id)}
                          className="flex items-center rounded-lg border border-white/20 px-3 py-1.5 text-[13px] text-white/50 transition-colors hover:border-white/40 hover:text-white/80"
                        >
                          중지
                        </button>
                      )}
                    </div>

                    {/* C5: render progress bar */}
                    {(isRendering || renderStatus === 'pending' || renderStatus === 'processing') && (
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

                    {renderStatus === 'cancelled' && (
                      <p className="mt-3 text-[12px] text-[rgba(255,255,255,0.4)]">
                        렌더가 중지되었습니다
                      </p>
                    )}
                  </div>
                </details>
                </div>{/* close sticky sidebar */}

                </div>{/* close 2-col grid */}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
