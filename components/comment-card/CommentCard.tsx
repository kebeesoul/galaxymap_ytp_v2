'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Tables } from '@/lib/supabase/types'

type Comment = Tables<'comments'>

interface LocalComment {
  id: string | null
  username: string
  body: string
  likes_count: number
  source: string
  is_selected: boolean
}

interface Props {
  clipId: string
  videoId: string
  initialComments: Comment[]
  // A8: indices of comments selected for preview/render (empty = all)
  selectedIndices?: number[]
  onSelectionChange?: (indices: number[]) => void
  onCommentsChange?: (comments: Array<{ username: string; body: string; likes_count: number }>) => void
}

function toLocal(c: Comment): LocalComment {
  return {
    id: c.id,
    username: c.username,
    body: c.body,
    likes_count: c.likes_count ?? 0,
    source: c.source ?? 'manual',
    is_selected: c.is_selected ?? false,
  }
}

export default function CommentCard({
  clipId,
  videoId,
  initialComments,
  selectedIndices,
  onSelectionChange,
  onCommentsChange,
}: Props) {
  const [comments, setComments] = useState<LocalComment[]>(initialComments.map(toLocal))
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const supabase = useMemo(() => createClient(), [])
  const originalIdsRef = useRef<Set<string>>(
    new Set(initialComments.map(c => c.id).filter(Boolean) as string[])
  )

  const hasYoutubeComments = comments.some(c => c.source === 'youtube')
  const selected = selectedIndices ?? []

  const onCommentsChangeRef = useRef(onCommentsChange)
  onCommentsChangeRef.current = onCommentsChange
  useEffect(() => {
    onCommentsChangeRef.current?.(
      comments.map(c => ({ username: c.username, body: c.body, likes_count: c.likes_count }))
    )
  }, [comments])

  function toggleSelection(idx: number) {
    if (!onSelectionChange) return
    const isNowSelected = !selected.includes(idx)
    const newSelected = isNowSelected
      ? [...selected, idx]
      : selected.filter(i => i !== idx)
    onSelectionChange(newSelected)
    // C3: persist is_selected immediately for existing DB rows (fire-and-forget)
    const comment = comments[idx]
    if (comment.id) {
      supabase.from('comments').update({ is_selected: isNowSelected }).eq('id', comment.id)
        .then(({ error }) => { if (error) console.error('[is_selected]', error.message) })
    }
  }

  async function handleFetchYoutube() {
    setFetching(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/comments/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clip_id: clipId, video_id: videoId }),
      })
      const body = (await res.json()) as { comments?: Comment[]; error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Failed to fetch comments')
      setComments(prev => [...prev, ...(body.comments ?? []).map(toLocal)])
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch comments')
    } finally {
      setFetching(false)
    }
  }

  function addComment() {
    setComments(prev => [
      ...prev,
      { id: null, username: '', body: '', likes_count: 0, source: 'manual', is_selected: false },
    ])
  }

  function deleteComment(idx: number) {
    setComments(prev => prev.filter((_, i) => i !== idx))
    // Fix selection indices after deletion
    if (onSelectionChange && selected.length > 0) {
      onSelectionChange(
        selected.filter(i => i !== idx).map(i => (i > idx ? i - 1 : i))
      )
    }
  }

  function updateField<K extends keyof LocalComment>(idx: number, key: K, value: LocalComment[K]) {
    setComments(prev => prev.map((c, i) => (i === idx ? { ...c, [key]: value } : c)))
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)

    const valid = comments.filter(c => c.username.trim() || c.body.trim())
    const toInsert = valid.filter(c => c.id === null)
    const toUpdate = valid.filter(c => c.id !== null)
    const currentIds = new Set(toUpdate.map(c => c.id!))
    const toDelete = Array.from(originalIdsRef.current).filter(id => !currentIds.has(id))
    const commentToIdx = new Map(comments.map((c, i) => [c, i] as const))

    // Step 1: INSERT new rows first — if this fails, existing data is untouched
    if (toInsert.length > 0) {
      const insertRows = toInsert.map(c => ({
        clip_id: clipId,
        username: c.username.trim() || '(익명)',
        body: c.body.trim(),
        likes_count: c.likes_count,
        source: c.source,
        is_selected: selected.includes(commentToIdx.get(c) ?? -1),
      }))
      const { data: inserted, error: insertError } = await supabase
        .from('comments').insert(insertRows).select()
      if (insertError) { setSaveError(insertError.message); setSaving(false); return }
      // Update local state with returned IDs
      if (inserted) {
        let insertIdx = 0
        setComments(prev => prev.map(c => {
          if (c.id !== null) return c
          const row = inserted[insertIdx++]
          return row ? { ...c, id: row.id } : c
        }))
        for (const row of inserted) originalIdsRef.current.add(row.id)
      }
    }

    // Step 2: UPDATE existing rows
    for (const c of toUpdate) {
      const idx = commentToIdx.get(c) ?? -1
      const { error } = await supabase.from('comments').update({
        username: c.username.trim() || '(익명)',
        body: c.body.trim(),
        likes_count: c.likes_count,
        is_selected: selected.includes(idx),
      }).eq('id', c.id!)
      if (error) { setSaveError(error.message); setSaving(false); return }
    }

    // Step 3: DELETE removed rows — safe because new data is already in DB
    if (toDelete.length > 0) {
      const { error: deleteError } = await supabase.from('comments').delete().in('id', toDelete)
      if (deleteError) { setSaveError(deleteError.message); setSaving(false); return }
      for (const id of toDelete) originalIdsRef.current.delete(id)
    }

    setSaving(false)
  }

  return (
    <div className="rounded-xl bg-[#1d1d1f] px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgba(255,255,255,0.4)]">
          댓글 ({comments.length})
          {selected.length > 0 && (
            <span className="ml-2 text-[#2997ff]">{selected.length}개 선택</span>
          )}
        </h3>
        <button
          onClick={handleFetchYoutube}
          disabled={fetching || hasYoutubeComments}
          title={hasYoutubeComments ? '이미 YouTube 댓글을 불러왔습니다' : undefined}
          className="flex items-center gap-1.5 rounded-lg bg-[#272729] px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-[#2a2a2d] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {fetching ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white" />
              불러오는 중…
            </>
          ) : hasYoutubeComments ? (
            'YouTube 댓글 완료'
          ) : (
            'YouTube 댓글 불러오기'
          )}
        </button>
        <button
          onClick={addComment}
          className="rounded-lg bg-[#272729] px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-[#2a2a2d]"
        >
          + 댓글 추가
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="ml-auto rounded-lg bg-[#0071e3] px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-[#0077ed] disabled:opacity-30"
        >
          {saving ? '저장 중…' : '저장'}
        </button>
      </div>

      {fetchError && <p className="mb-3 text-[12px] text-red-400">{fetchError}</p>}
      {saveError && <p className="mb-3 text-[12px] text-red-400">{saveError}</p>}

      {selected.length > 0 && (
        <p className="mb-2 text-[11px] text-[#2997ff]">
          체크된 댓글만 미리보기·렌더에 사용됩니다
        </p>
      )}

      {comments.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-[rgba(255,255,255,0.24)]">
          댓글 없음 — YouTube에서 불러오거나 직접 추가하세요.
        </p>
      ) : (
        <div className="space-y-2">
          {comments.map((comment, idx) => (
            <div
              key={idx}
              className={`rounded-lg px-4 py-3 transition-colors ${
                selected.length > 0
                  ? selected.includes(idx)
                    ? 'bg-[#0071e3]/20 ring-1 ring-[#0071e3]/40'
                    : 'bg-[#272729] opacity-50'
                  : 'bg-[#272729]'
              }`}
            >
              <div className="flex items-center gap-2">
                {/* A8: selection checkbox */}
                {onSelectionChange && (
                  <input
                    type="checkbox"
                    checked={selected.includes(idx)}
                    onChange={() => toggleSelection(idx)}
                    className="h-4 w-4 shrink-0 cursor-pointer accent-[#0071e3]"
                    title="렌더에 포함"
                  />
                )}
                <input
                  value={comment.username}
                  onChange={e => updateField(idx, 'username', e.target.value)}
                  placeholder="username"
                  className="w-32 shrink-0 rounded-md bg-[#1d1d1f] px-2 py-1 text-[13px] text-white outline-none placeholder:text-[rgba(255,255,255,0.2)] focus:ring-1 focus:ring-[#0071e3]"
                />
                <input
                  type="number"
                  value={comment.likes_count}
                  onChange={e => {
                    const v = parseInt(e.target.value, 10)
                    updateField(idx, 'likes_count', isNaN(v) ? 0 : v)
                  }}
                  className="w-16 shrink-0 rounded-md bg-[#1d1d1f] px-2 py-1 text-[13px] text-[rgba(255,255,255,0.6)] outline-none focus:ring-1 focus:ring-[#0071e3]"
                />
                <span className="text-[11px] text-[rgba(255,255,255,0.3)]">👍</span>
                {comment.source === 'youtube' && (
                  <span className="rounded bg-[#1d1d1f] px-1.5 py-0.5 font-mono text-[10px] text-[rgba(255,255,255,0.3)]">
                    YT
                  </span>
                )}
                <button
                  onClick={() => deleteComment(idx)}
                  className="ml-auto text-[13px] text-[rgba(255,255,255,0.3)] transition-colors hover:text-red-400"
                >
                  ✕
                </button>
              </div>
              <textarea
                value={comment.body}
                onChange={e => updateField(idx, 'body', e.target.value)}
                rows={2}
                placeholder="댓글 내용"
                className="mt-2 w-full resize-none rounded-md bg-[#1d1d1f] px-2 py-1.5 text-[13px] text-white outline-none placeholder:text-[rgba(255,255,255,0.2)] focus:ring-1 focus:ring-[#0071e3]"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
