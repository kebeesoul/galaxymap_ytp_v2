'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatMmss } from '@/lib/utils/time'
export interface ExportRow {
  clip_id: string
  clip_label: string | null
  start_sec: number
  end_sec: number
  render_path: string
  project_id: string
  artist: string
  song_title: string
  thumbnail_url: string | null
}

const supabase = createClient()

interface ProjectGroup {
  project_id: string
  artist: string
  song_title: string
  thumbnail_url: string | null
  clips: ExportRow[]
}

export default function ExportList({ rows: initialRows }: { rows: ExportRow[] }) {
  const router = useRouter()
  const [rows, setRows] = useState<ExportRow[]>(initialRows)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null)
  const [deletingAll, setDeletingAll] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Issue 2: sync local state when router.refresh() delivers new server props
  useEffect(() => {
    setRows(initialRows)
  }, [initialRows])

  // Issue 3: Realtime — auto-append clips whose render_status just became 'success'
  useEffect(() => {
    const channel = supabase
      .channel('renders-realtime')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'clips', filter: 'render_status=eq.success' },
        async (payload) => {
          const clip = payload.new as Record<string, unknown>
          const clipId = clip.id as string
          const renderPath = clip.render_path as string | null
          const projectId = clip.project_id as string | null
          if (!renderPath || !projectId) return

          const { data: project } = await supabase
            .from('projects')
            .select('id, artist, song_title, yt_thumbnail_url')
            .eq('id', projectId)
            .single()
          if (!project) return

          setRows(prev => {
            if (prev.some(r => r.clip_id === clipId)) return prev
            const newRow: ExportRow = {
              clip_id: clipId,
              clip_label: (clip.label as string | null) ?? null,
              start_sec: clip.start_sec as number,
              end_sec: clip.end_sec as number,
              render_path: renderPath,
              project_id: projectId,
              artist: project.artist,
              song_title: project.song_title,
              thumbnail_url: project.yt_thumbnail_url,
            }
            return [...prev, newRow]
          })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  const groups = useMemo<ProjectGroup[]>(() => {
    const map = new Map<string, ProjectGroup>()
    for (const r of rows) {
      const g = map.get(r.project_id)
      if (g) {
        g.clips.push(r)
      } else {
        map.set(r.project_id, {
          project_id: r.project_id,
          artist: r.artist,
          song_title: r.song_title,
          thumbnail_url: r.thumbnail_url,
          clips: [r],
        })
      }
    }
    return Array.from(map.values())
  }, [rows])

  async function handleDownload(row: ExportRow) {
    setDownloading(row.clip_id)
    setError(null)
    try {
      const filename = row.render_path.split('/').pop() ?? `${row.clip_id}.mp4`
      const { data, error: signErr } = await supabase.storage
        .from('renders')
        .createSignedUrl(row.render_path, 300, { download: filename })
      if (signErr || !data?.signedUrl) {
        throw new Error(signErr?.message ?? 'failed to get download url')
      }
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'download failed')
    } finally {
      setDownloading(null)
    }
  }

  async function handleDeleteClip(clipId: string) {
    setDeleting(clipId)
    setError(null)
    try {
      const res = await fetch(`/api/clips/${clipId}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error ?? 'delete failed')
      }
      setRows(prev => prev.filter(r => r.clip_id !== clipId))
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed')
    } finally {
      setDeleting(null)
    }
  }

  async function handleDeleteGroup(projectId: string) {
    const clipIds = groups.find(g => g.project_id === projectId)?.clips.map(c => c.clip_id) ?? []
    if (clipIds.length === 0) return
    setDeletingGroup(projectId)
    setError(null)
    try {
      const responses = await Promise.all(clipIds.map(id => fetch(`/api/clips/${id}`, { method: 'DELETE' })))
      const failed = responses.filter(r => !r.ok)
      if (failed.length > 0) throw new Error(`${failed.length}개 클립 삭제 실패`)
      setRows(prev => prev.filter(r => r.project_id !== projectId))
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed')
    } finally {
      setDeletingGroup(null)
    }
  }

  // Issue 1: delete ALL renders across all projects with confirmation
  async function handleDeleteAll() {
    if (!confirm('모든 렌더 파일을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return
    setDeletingAll(true)
    setError(null)
    try {
      const responses = await Promise.all(rows.map(r => fetch(`/api/clips/${r.clip_id}`, { method: 'DELETE' })))
      const failed = responses.filter(r => !r.ok)
      if (failed.length > 0) throw new Error(`${failed.length}개 클립 삭제 실패`)
      setRows([])
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed')
    } finally {
      setDeletingAll(false)
    }
  }

  return (
    <>
      <div className="mb-12 flex items-center justify-between">
        {/* Issue 2: click to refresh */}
        <button
          type="button"
          onClick={() => router.refresh()}
          className="transition-opacity hover:opacity-60"
          title="클릭하여 새로고침"
        >
          <h1
            className="cursor-pointer text-[40px] font-semibold leading-[1.10] text-[#1d1d1f]"
            style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", Helvetica, Arial, sans-serif' }}
          >
            Renders Dashboard
          </h1>
        </button>
        <div className="flex items-center gap-3">
          {rows.length > 0 && (
            <button
              onClick={handleDeleteAll}
              disabled={deletingAll}
              className="rounded-lg border border-red-200 px-4 py-2 text-[14px] text-red-500 transition-colors hover:bg-red-50 disabled:opacity-40"
            >
              {deletingAll ? '삭제 중…' : '전체 삭제'}
            </button>
          )}
          <Link href="/projects" className="text-[14px] text-[#0066cc] hover:underline">
            ← Projects
          </Link>
        </div>
      </div>

      {error && (
        <p className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-[14px] text-red-600">{error}</p>
      )}

      {groups.length === 0 ? (
        <div className="rounded-2xl bg-white py-24 text-center shadow-[rgba(0,0,0,0.08)_0px_2px_12px]">
          <p className="text-[17px] text-[rgba(0,0,0,0.48)]">렌더 완료된 클립이 아직 없습니다.</p>
          <p className="mt-2 text-[14px] text-[rgba(0,0,0,0.4)]">
            에디터에서 '렌더 시작' 버튼을 누르면 로컬 워커가 인코딩 후 여기에 표시됩니다.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <div
              key={g.project_id}
              className="rounded-2xl bg-white shadow-[rgba(0,0,0,0.08)_0px_2px_12px]"
            >
              <div className="flex items-center gap-6 px-6 py-5 border-b border-[rgba(0,0,0,0.06)]">
                {g.thumbnail_url ? (
                  <img
                    src={g.thumbnail_url}
                    alt={g.song_title}
                    className="h-16 w-28 rounded-lg object-cover"
                  />
                ) : (
                  <div className="h-16 w-28 shrink-0 rounded-lg bg-[#f5f5f7]" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[21px] font-semibold leading-[1.19] tracking-[0.231px] text-[#1d1d1f]">
                    {g.song_title}
                  </p>
                  <p className="mt-0.5 text-[14px] text-[rgba(0,0,0,0.6)]">{g.artist}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="rounded-full bg-[#f5f5f7] px-3 py-1 text-[12px] text-[rgba(0,0,0,0.6)]">
                    {g.clips.length} clip{g.clips.length === 1 ? '' : 's'}
                  </span>
                  <button
                    onClick={() => handleDeleteGroup(g.project_id)}
                    disabled={deletingGroup === g.project_id || deletingAll}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-[13px] text-red-500 transition-colors hover:bg-red-50 disabled:opacity-40"
                  >
                    {deletingGroup === g.project_id ? '삭제 중…' : '전체 삭제'}
                  </button>
                </div>
              </div>

              <ul>
                {g.clips.map((c) => (
                  <li
                    key={c.clip_id}
                    className="flex items-center gap-4 px-6 py-4 border-b border-[rgba(0,0,0,0.04)] last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] text-[#1d1d1f]">
                        {c.clip_label || '(라벨 없음)'}
                      </p>
                      <p className="mt-0.5 font-mono text-[12px] text-[rgba(0,0,0,0.5)]">
                        {formatMmss(c.start_sec)} – {formatMmss(c.end_sec)}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDownload(c)}
                      disabled={downloading === c.clip_id || deleting === c.clip_id || deletingAll}
                      className="rounded-lg bg-[#0071e3] px-4 py-2 text-[14px] text-white transition-colors hover:bg-[#0077ed] disabled:opacity-40"
                    >
                      {downloading === c.clip_id ? '다운로드 중…' : '다운로드'}
                    </button>
                    <button
                      onClick={() => handleDeleteClip(c.clip_id)}
                      disabled={deleting === c.clip_id || downloading === c.clip_id || deletingAll}
                      className="rounded-lg border border-red-200 px-3 py-2 text-[14px] text-red-500 transition-colors hover:bg-red-50 disabled:opacity-40"
                    >
                      {deleting === c.clip_id ? '삭제 중…' : '삭제'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
