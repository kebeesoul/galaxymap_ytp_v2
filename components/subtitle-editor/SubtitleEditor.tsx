'use client'

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Tables } from '@/lib/supabase/types'

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
}

let _localIdCounter = 0

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.floor((sec % 1) * 10)
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`
}

export default function SubtitleEditor({ clipId, initialSegments }: Props) {
  const [segments, setSegments] = useState<LocalSegment[]>(() =>
    initialSegments.map(seg => ({
      localId: _localIdCounter++,
      id: seg.id,
      text: seg.text,
      start_sec: seg.start_sec,
      end_sec: seg.end_sec,
    }))
  )
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [insertFailed, setInsertFailed] = useState(false)
  const inputRefs = useRef<Map<number, HTMLTextAreaElement>>(new Map())
  const supabase = createClient()

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

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    setInsertFailed(false)

    const { error: deleteError } = await supabase
      .from('lyrics_segments')
      .delete()
      .eq('clip_id', clipId)

    if (deleteError) {
      setSaveError(deleteError.message)
      setSaving(false)
      return
    }

    const rows = segments
      .filter(s => s.text.trim())
      .map(s => ({
        clip_id: clipId,
        text: s.text.trim(),
        start_sec: s.start_sec,
        end_sec: s.end_sec,
      }))

    const { error: insertError } = await supabase.from('lyrics_segments').insert(rows)

    if (insertError) {
      setSaveError(insertError.message)
      setInsertFailed(true)
    }

    setSaving(false)
  }

  return (
    <div className="rounded-xl bg-[#1d1d1f] px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgba(255,255,255,0.4)]">
          자막 ({segments.length})
        </h3>
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-[#0071e3] px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-[#0077ed] disabled:opacity-30"
        >
          {saving ? '저장 중…' : '저장'}
        </button>
      </div>

      {saveError && (
        <div className="mb-3 rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3">
          <p className="text-[13px] font-semibold text-red-400">
            {insertFailed ? '저장 실패 — 자막 데이터가 삭제됐습니다. 지금 바로 재시도하세요.' : '저장 실패'}
          </p>
          <p className="mt-1 font-mono text-[11px] text-red-300/70">{saveError}</p>
          {insertFailed && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="mt-3 rounded-lg bg-red-600 px-4 py-1.5 text-[13px] text-white transition-colors hover:bg-red-500 disabled:opacity-40"
            >
              {saving ? '재시도 중…' : '재시도'}
            </button>
          )}
        </div>
      )}

      <div className="space-y-1">
        {segments.map((seg, idx) => (
          <div key={seg.localId} className="flex items-start gap-3">
            <span className="mt-2 w-16 shrink-0 font-mono text-[11px] text-[rgba(255,255,255,0.2)]">
              {formatTime(seg.start_sec)}
            </span>
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
          </div>
        ))}
      </div>
    </div>
  )
}
