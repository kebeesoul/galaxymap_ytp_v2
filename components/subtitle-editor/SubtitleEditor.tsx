'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Tables } from '@/lib/supabase/types'
import { formatTime } from '@/lib/utils/time'
import { extendFinalSegmentToClipEnd } from '@/lib/subtitles/normalize'

type Segment = Tables<'lyrics_segments'>

interface LocalSegment {
  localId: number
  id: string | null
  text: string
  start_sec: number
  end_sec: number
}

interface Props {
  clipId: string
  initialSegments: Segment[]
  currentTime?: number
  /** Clip's absolute start time in the source video — used to convert displayed timecodes
   *  to clip-relative so they match the preview player's 0:00-based clock. */
  clipStartSec?: number
  clipEndSec: number
  /** When true, skips the outer rounded card wrapper and h3 title (used inside a parent <details>) */
  noWrapper?: boolean
  /** Called on every segments state change so the preview can show unsaved edits live. */
  onSegmentsChange?: (segs: Array<{ text: string; start_sec: number; end_sec: number }>) => void
  /** Called when user clicks or finishes dragging a timecode — seeks + plays the preview. */
  onSeekAndPlay?: (clipRelSec: number) => void
}

let _localIdCounter = 0

// Drag sensitivity: how many seconds the timestamp moves per pixel of vertical mouse drag.
// 0.05s/px → 1s = 20px, fine enough for 0.1s nudges (2px) yet quick for ~5s reach (100px).
const SECONDS_PER_PIXEL = 0.05

export default function SubtitleEditor({ clipId, initialSegments, currentTime, clipStartSec = 0, clipEndSec, noWrapper, onSegmentsChange, onSeekAndPlay }: Props) {
  const [segments, setSegments] = useState<LocalSegment[]>(() =>
    extendFinalSegmentToClipEnd(initialSegments, clipEndSec).map(seg => ({
      localId: _localIdCounter++,
      id: seg.id,
      text: seg.text,
      start_sec: seg.start_sec,
      end_sec: seg.end_sec,
    }))
  )
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [syncMode, setSyncMode] = useState(false)
  // B4: index of the next line to tap in sync mode
  const [syncTapIdx, setSyncTapIdx] = useState(0)

  // B5: track IDs that existed at mount so we can DELETE removed ones without a full wipe
  const originalIdsRef = useRef<Set<string>>(
    new Set(initialSegments.map(s => s.id).filter(Boolean) as string[])
  )
  const inputRefs = useRef<Map<number, HTMLTextAreaElement>>(new Map())
  const tapButtonRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

  // Stable callback refs — avoid stale closure in effects
  const onSegmentsChangeRef = useRef(onSegmentsChange)
  const onSeekAndPlayRef = useRef(onSeekAndPlay)
  const clipStartSecRef = useRef(clipStartSec)
  onSegmentsChangeRef.current = onSegmentsChange
  onSeekAndPlayRef.current = onSeekAndPlay
  clipStartSecRef.current = clipStartSec

  // Notify parent whenever segments change so the preview reflects unsaved edits
  useEffect(() => {
    const normalized = extendFinalSegmentToClipEnd(segments, clipEndSec)
    onSegmentsChangeRef.current?.(normalized.map(s => ({ text: s.text, start_sec: s.start_sec, end_sec: s.end_sec })))
  }, [clipEndSec, segments])

  // Drag-to-adjust state for timecodes: vertical drag changes start_sec.
  // Mouse up → earlier, mouse down → later. Previous segment's end_sec follows to avoid gaps.
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const dragStateRef = useRef<{ idx: number; startY: number; startSec: number; currentSec: number } | null>(null)

  useEffect(() => {
    if (dragIdx === null) return
    function handleMove(e: MouseEvent) {
      const s = dragStateRef.current
      if (!s) return
      const deltaY = e.clientY - s.startY
      const newStart = Math.max(0, s.startSec + deltaY * SECONDS_PER_PIXEL)
      s.currentSec = newStart
      setSegments(prev => {
        const updated = [...prev]
        updated[s.idx] = { ...updated[s.idx], start_sec: newStart }
        if (s.idx > 0) updated[s.idx - 1] = { ...updated[s.idx - 1], end_sec: newStart }
        return updated
      })
    }
    function handleUp() {
      const state = dragStateRef.current
      dragStateRef.current = null
      setDragIdx(null)
      if (state) {
        onSeekAndPlayRef.current?.(state.currentSec - clipStartSecRef.current)
      }
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
  }, [dragIdx])

  function handleTimecodeMouseDown(idx: number, e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault()
    const seg = segments[idx]
    dragStateRef.current = { idx, startY: e.clientY, startSec: seg.start_sec, currentSec: seg.start_sec }
    setDragIdx(idx)
  }

  const supabase = useMemo(() => createClient(), [])

  const activeIdx = useMemo(() => {
    if (currentTime === undefined) return -1
    return segments.reduce<number>((found, s, i) => {
      if (currentTime >= s.start_sec && currentTime < s.end_sec) return i
      return found
    }, -1)
  }, [currentTime, segments])

  function handleDeleteRow(idx: number) {
    setSegments(prev => prev.filter((_, i) => i !== idx))
  }

  function handleAddSubtitle() {
    if (currentTime === undefined) return
    const safeSec = Math.max(currentTime, clipStartSec)
    const newLocalId = _localIdCounter++
    setSegments(prev => {
      const insertIdx = prev.findIndex(s => s.start_sec > safeSec)
      const targetIdx = insertIdx === -1 ? prev.length : insertIdx
      const endSec = prev[targetIdx]?.start_sec ?? safeSec + 3
      const newSeg: LocalSegment = {
        localId: newLocalId,
        id: null,
        text: '',
        start_sec: safeSec,
        end_sec: endSec,
      }
      const updated = [...prev]
      updated.splice(targetIdx, 0, newSeg)
      return updated
    })
    setTimeout(() => {
      inputRefs.current.get(newLocalId)?.focus()
    }, 0)
  }

  // B4: Tap-to-sync — set start_sec, close gap with previous, then advance to next line
  function handleTapSync(idx: number) {
    if (currentTime === undefined) return
    setSegments(prev => {
      const updated = [...prev]
      if (idx > 0) {
        updated[idx - 1] = { ...updated[idx - 1], end_sec: currentTime }
      }
      updated[idx] = { ...updated[idx], start_sec: currentTime }
      if (idx === updated.length - 1) {
        updated[idx] = { ...updated[idx], end_sec: Math.max(clipEndSec, currentTime + 0.1) }
      }
      return updated
    })
    if (idx === segments.length - 1) {
      // Last segment tapped — auto-exit sync mode
      setSyncMode(false)
      setSyncTapIdx(0)
    } else {
      const nextIdx = idx + 1
      setSyncTapIdx(nextIdx)
      setTimeout(() => {
        tapButtonRefs.current.get(nextIdx)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 0)
    }
  }

  function handleTextChange(idx: number, value: string) {
    setSegments(prev => prev.map((s, i) => (i === idx ? { ...s, text: value } : s)))
  }

  function handleKeyDown(idx: number, e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget
    const selStart = el.selectionStart ?? 0
    const selEnd = el.selectionEnd ?? 0

    if (e.key === 'Enter') {
      e.preventDefault()
      const text = el.value
      const beforeText = text.slice(0, selStart)
      const afterText = text.slice(selStart)
      const newLocalId = _localIdCounter++

      setSegments(prev => {
        const seg = prev[idx]
        const mid = (seg.start_sec + seg.end_sec) / 2
        const updated = [...prev]
        updated[idx] = { ...seg, text: beforeText, end_sec: mid }
        updated.splice(idx + 1, 0, {
          localId: newLocalId,
          id: null,
          text: afterText,
          start_sec: mid,
          end_sec: seg.end_sec,
        })
        return updated
      })

      setTimeout(() => {
        const nextEl = inputRefs.current.get(newLocalId)
        if (nextEl) {
          nextEl.focus()
          nextEl.selectionStart = 0
          nextEl.selectionEnd = 0
        }
      }, 0)
    }

    if (e.key === 'Backspace' && selStart === 0 && selEnd === 0 && idx > 0) {
      e.preventDefault()
      const prevLocalId = segments[idx - 1].localId
      const prevTextLen = segments[idx - 1].text.length

      setSegments(prev => {
        const prevSeg = prev[idx - 1]
        const curSeg = prev[idx]
        const merged: LocalSegment = {
          localId: prevSeg.localId,
          id: prevSeg.id,
          text: prevSeg.text + curSeg.text,
          start_sec: prevSeg.start_sec,
          end_sec: curSeg.end_sec,
        }
        const updated = [...prev]
        updated.splice(idx - 1, 2, merged)
        return updated
      })

      setTimeout(() => {
        const prevEl = inputRefs.current.get(prevLocalId)
        if (prevEl) {
          prevEl.focus()
          prevEl.selectionStart = prevTextLen
          prevEl.selectionEnd = prevTextLen
        }
      }, 0)
    }
  }

  // B5: Safer save — INSERT new rows first, then UPDATE existing, then DELETE removed.
  // Never lose data: we only delete after the new data is safely in the DB.
  async function handleSave() {
    setSaving(true)
    setSaveError(null)

    const valid = extendFinalSegmentToClipEnd(
      segments.filter(s => s.text.trim()),
      clipEndSec,
    )

    // Rows without a DB id need to be inserted
    const toInsert = valid
      .filter(s => s.id === null)
      .map(s => {
        const order = valid.findIndex(v => v.localId === s.localId)
        return {
          clip_id: clipId,
          text: s.text.trim(),
          start_sec: s.start_sec,
          end_sec: s.end_sec,
          order,
        }
      })

    // Rows with a DB id need to be updated
    const toUpdate = valid.filter(s => s.id !== null)

    // IDs that were in the DB at mount but are no longer in valid segments → delete them
    const currentIds = new Set(toUpdate.map(s => s.id!))
    const toDelete = Array.from(originalIdsRef.current).filter(id => !currentIds.has(id))

    // Step 1: Insert new segments
    let insertedIds: string[] = []
    if (toInsert.length > 0) {
      const { data, error } = await supabase.from('lyrics_segments').insert(toInsert).select('id')
      if (error) {
        setSaveError(error.message)
        setSaving(false)
        return
      }
      insertedIds = data?.map(r => r.id) ?? []
      // Assign returned DB IDs to local state so subsequent saves don't re-insert the same rows
      if (data) {
        let insertedIdx = 0
        setSegments(prev => prev.map(s => {
          if (s.id !== null) return s
          const row = data[insertedIdx++]
          return row ? { ...s, id: row.id } : s
        }))
      }
    }

    // Step 2: Update existing segments (B1: include order)
    for (let i = 0; i < toUpdate.length; i++) {
      const s = toUpdate[i]
      const order = valid.findIndex(v => v.id === s.id)
      const { error } = await supabase.from('lyrics_segments').update({
        text: s.text.trim(),
        start_sec: s.start_sec,
        end_sec: s.end_sec,
        order,
      }).eq('id', s.id!)
      if (error) { setSaveError(error.message); setSaving(false); return }
    }

    // Step 3: Delete rows that were removed by the user
    if (toDelete.length > 0) {
      const { error } = await supabase.from('lyrics_segments').delete().in('id', toDelete)
      if (error) {
        setSaveError(error.message)
        setSaving(false)
        return
      }
    }

    // Update the known-ID set for future saves
    originalIdsRef.current = new Set(Array.from(currentIds).concat(insertedIds))

    setSaving(false)
  }

  const bodyContent = (
    <>
      <div className={`mb-3 flex items-center ${noWrapper ? 'justify-end' : 'justify-between'}`}>
        {!noWrapper && (
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgba(255,255,255,0.4)]">
            자막 ({segments.length})
          </h3>
        )}
        <div className="flex items-center gap-2">
          {currentTime !== undefined && (
            <>
              <button
                onClick={handleAddSubtitle}
                className="rounded-lg bg-[#272729] px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-[#2a2a2d]"
              >
                자막추가
              </button>
              <button
                onClick={() => {
                  setSyncMode(prev => {
                    const next = !prev
                    if (next) setSyncTapIdx(0)
                    return next
                  })
                }}
                className={`rounded-lg px-3 py-1.5 text-[13px] text-white transition-colors ${
                  syncMode
                    ? 'bg-red-500/80 ring-1 ring-red-400 hover:bg-red-400/80'
                    : 'bg-[#272729] hover:bg-[#2a2a2d]'
                }`}
              >
                {syncMode ? '● 싱크 중' : '싱크 맞추기'}
              </button>
            </>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-[#0071e3] px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-[#0077ed] disabled:opacity-30"
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>

      {saveError && (
        <div className="mb-3 rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3">
          <p className="text-[13px] font-semibold text-red-400">저장 실패</p>
          <p className="mt-1 font-mono text-[11px] text-red-300/70">{saveError}</p>
        </div>
      )}

      {syncMode ? (
        <p className="mb-2 text-[11px] text-red-400/80">
          ▶ 미리보기 재생 후, 각 줄이 시작되는 순간 ● 버튼을 누르면 싱크가 설정됩니다 — 강조된 줄이 다음 차례
        </p>
      ) : currentTime !== undefined ? (
        <p className="mb-2 text-[11px] text-[rgba(255,255,255,0.2)]">
          타임코드 위·아래 드래그 → 시작 시간 미세 조정 &nbsp;·&nbsp; 싱크 맞추기 → 미리보기 재생 중 각 줄 시작 시점에 ● 탭
        </p>
      ) : null}

      <div className="space-y-1">
        {segments.map((seg, idx) => {
          const isActive = idx === activeIdx
          const isNextTap = syncMode && idx === syncTapIdx
          return (
            <div
              key={seg.localId}
              className={`flex items-start gap-2 rounded-lg px-2 py-1 transition-colors ${
                isActive ? 'bg-[#0071e3]/20' : isNextTap ? 'bg-red-500/10' : ''
              }`}
            >
              {syncMode ? (
                <button
                  ref={el => {
                    if (el) tapButtonRefs.current.set(idx, el)
                    else tapButtonRefs.current.delete(idx)
                  }}
                  type="button"
                  onClick={() => handleTapSync(idx)}
                  className={`mt-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white transition-all hover:scale-110 active:scale-95 ${
                    isNextTap
                      ? 'scale-110 bg-red-500 ring-2 ring-red-400 ring-offset-1 ring-offset-[#1d1d1f]'
                      : 'bg-red-900/50 hover:bg-red-500'
                  }`}
                  title="지금 재생 위치로 싱크"
                >
                  <span className="text-[9px] leading-none">●</span>
                </button>
              ) : (
                <button
                  type="button"
                  onMouseDown={(e) => handleTimecodeMouseDown(idx, e)}
                  title="위·아래로 드래그하여 시작 시간 조정"
                  className={`mt-2 w-16 shrink-0 select-none text-left font-mono text-[11px] transition-colors cursor-ns-resize ${
                    dragIdx === idx
                      ? 'text-[#2997ff]'
                      : isActive
                        ? 'text-[#2997ff]'
                        : 'text-[rgba(255,255,255,0.3)] hover:text-[#2997ff]'
                  }`}
                >
                  {formatTime(seg.start_sec - clipStartSec)}
                </button>
              )}
              <textarea
                ref={el => {
                  if (el) inputRefs.current.set(seg.localId, el)
                  else inputRefs.current.delete(seg.localId)
                }}
                value={seg.text}
                rows={1}
                onChange={e => handleTextChange(idx, e.target.value)}
                onKeyDown={e => handleKeyDown(idx, e)}
                className="flex-1 resize-none rounded-lg bg-[#272729] px-3 py-2 text-[14px] text-white outline-none focus:ring-1 focus:ring-[#0071e3]"
              />
              {segments.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleDeleteRow(idx)}
                  title="이 줄 삭제"
                  className="mt-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[rgba(255,255,255,0.2)] transition-colors hover:bg-red-500/10 hover:text-red-400"
                >
                  <span className="text-[14px] leading-none">−</span>
                </button>
              )}
            </div>
          )
        })}
      </div>
    </>
  )

  if (noWrapper) return bodyContent
  return <div className="rounded-xl bg-[#1d1d1f] px-5 py-4">{bodyContent}</div>
}
