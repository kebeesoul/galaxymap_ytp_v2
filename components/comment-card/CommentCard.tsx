'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Tables } from '@/lib/supabase/types'

type Comment = Tables<'comments'>

interface LocalComment {
  id: string | null
  username: string
  body: string
  likes_count: number
  source: string
}

interface Props {
  clipId: string
  videoId: string
  initialComments: Comment[]
}

function toLocal(c: Comment): LocalComment {
  return {
    id: c.id,
    username: c.username,
    body: c.body,
    likes_count: c.likes_count ?? 0,
    source: c.source ?? 'manual',
  }
}

export default function CommentCard({ clipId, videoId, initialComments }: Props) {
  const [comments, setComments] = useState<LocalComment[]>(initialComments.map(toLocal))
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const supabase = createClient()

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
      { id: null, username: '', body: '', likes_count: 0, source: 'manual' },
    ])
  }

  function deleteComment(idx: number) {
    setComments(prev => prev.filter((_, i) => i !== idx))
  }

  function updateField<K extends keyof LocalComment>(idx: number, key: K, value: LocalComment[K]) {
    setComments(prev => prev.map((c, i) => (i === idx ? { ...c, [key]: value } : c)))
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)

    const { error: deleteError } = await supabase
      .from('comments')
      .delete()
      .eq('clip_id', clipId)

    if (deleteError) {
      setSaveError(deleteError.message)
      setSaving(false)
      return
    }

    const rows = comments
      .filter(c => c.username.trim() || c.body.trim())
      .map(c => ({
        clip_id: clipId,
        username: c.username.trim() || '(익명)',
        body: c.body.trim(),
        likes_count: c.likes_count,
        source: c.source,
      }))

    if (rows.length > 0) {
      const { error: insertError } = await supabase.from('comments').insert(rows)
      if (insertError) {
        setSaveError(insertError.message)
        setSaving(false)
        return
      }
    }

    setSaving(false)
  }

  return (
    <div className="rounded-xl bg-[#1d1d1f] px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgba(255,255,255,0.4)]">
          댓글 ({comments.length})
        </h3>
        <button
          onClick={handleFetchYoutube}
          disabled={fetching}
          className="flex items-center gap-1.5 rounded-lg bg-[#272729] px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-[#2a2a2d] disabled:opacity-40"
        >
          {fetching ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white" />
              불러오는 중…
            </>
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

      {comments.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-[rgba(255,255,255,0.24)]">
          댓글 없음 — YouTube에서 불러오거나 직접 추가하세요.
        </p>
      ) : (
        <div className="space-y-2">
          {comments.map((comment, idx) => (
            <div key={idx} className="rounded-lg bg-[#272729] px-4 py-3">
              <div className="flex items-center gap-2">
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
