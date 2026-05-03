'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export interface HistoryProject {
  id: string
  artist: string
  song_title: string
  import_status: string | null
  created_at: string | null
}

export interface HistoryRender {
  clip_id: string
  render_path: string
  render_preset: string | null
  start_sec: number
  end_sec: number
  project_id: string
  artist: string
  song_title: string
}

interface Props {
  initialProjects: HistoryProject[]
  initialRenders: HistoryRender[]
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-[#272729] text-[rgba(255,255,255,0.5)]',
  processing: 'bg-[#0071e3]/20 text-[#2997ff]',
  success: 'bg-green-900/30 text-green-400',
  failed: 'bg-red-900/30 text-red-400',
}

const PRESET_COLORS: Record<string, string> = {
  fast: 'bg-yellow-900/30 text-yellow-400',
  balanced: 'bg-blue-900/30 text-[#2997ff]',
  quality: 'bg-purple-900/30 text-purple-400',
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatDuration(start: number, end: number) {
  const sec = Math.round(end - start)
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function HistoryPanel({ initialProjects, initialRenders }: Props) {
  const [projects, setProjects] = useState(initialProjects)
  const [renders, setRenders] = useState(initialRenders)
  const [deletingProject, setDeletingProject] = useState<string | null>(null)
  const [deletingRender, setDeletingRender] = useState<string | null>(null)
  const [deletingAllProjects, setDeletingAllProjects] = useState(false)
  const [deletingAllRenders, setDeletingAllRenders] = useState(false)
  const [downloadingRender, setDownloadingRender] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editBlockedId, setEditBlockedId] = useState<string | null>(null)
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  // Poll for pending/processing projects every 3s until resolved
  const projectsRef = useRef(projects)
  projectsRef.current = projects
  const hasPending = projects.some(
    p => p.import_status === 'pending' || p.import_status === 'processing'
  )
  useEffect(() => {
    if (!hasPending) return
    const timer = setInterval(async () => {
      const ids = projectsRef.current
        .filter(p => p.import_status === 'pending' || p.import_status === 'processing')
        .map(p => p.id)
      if (ids.length === 0) return
      const { data } = await supabase
        .from('projects')
        .select('id, import_status')
        .in('id', ids)
      if (!data) return
      setProjects(prev => prev.map(p => {
        const u = data.find(d => d.id === p.id)
        return u && u.import_status !== p.import_status ? { ...p, import_status: u.import_status } : p
      }))
    }, 3000)
    return () => clearInterval(timer)
  }, [hasPending, supabase])

  function handleEditClick(p: HistoryProject) {
    if (p.import_status === 'success') {
      router.push(`/editor/${p.id}`)
    } else {
      setEditBlockedId(p.id)
      setTimeout(() => setEditBlockedId(null), 3000)
    }
  }

  async function handleDeleteProject(id: string) {
    setDeletingProject(id)
    setError(null)
    const prev = projects
    setProjects(p => p.filter(x => x.id !== id))
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      setProjects(prev)
      const body = (await res.json()) as { error?: string }
      setError(body.error ?? 'delete failed')
    } else {
      router.refresh()
    }
    setDeletingProject(null)
  }

  async function handleDeleteAllProjects() {
    if (!confirm(`프로젝트 ${projects.length}개를 모두 삭제합니다?`)) return
    setDeletingAllProjects(true)
    setError(null)
    const ids = projects.map(p => p.id)
    const results = await Promise.all(ids.map(id => fetch(`/api/projects/${id}`, { method: 'DELETE' })))
    const failed = results.filter(r => !r.ok).length
    if (failed > 0) setError(`${failed}개 삭제 실패`)
    const deletedIdxs = new Set(results.map((r, i) => r.ok ? ids[i] : null).filter(Boolean))
    setProjects(p => p.filter(x => !deletedIdxs.has(x.id)))
    router.refresh()
    setDeletingAllProjects(false)
  }

  async function handleDeleteRender(clipId: string) {
    setDeletingRender(clipId)
    setError(null)
    const prev = renders
    setRenders(r => r.filter(x => x.clip_id !== clipId))
    const res = await fetch(`/api/clips/${clipId}`, { method: 'DELETE' })
    if (!res.ok) {
      setRenders(prev)
      const body = (await res.json()) as { error?: string }
      setError(body.error ?? 'delete failed')
    } else {
      router.refresh()
    }
    setDeletingRender(null)
  }

  async function handleDeleteAllRenders() {
    if (!confirm(`렌더 ${renders.length}개를 모두 삭제합니다?`)) return
    setDeletingAllRenders(true)
    setError(null)
    const ids = renders.map(r => r.clip_id)
    await Promise.all(ids.map(id => fetch(`/api/clips/${id}`, { method: 'DELETE' })))
    setRenders([])
    router.refresh()
    setDeletingAllRenders(false)
  }

  async function handleDownload(render: HistoryRender) {
    setDownloadingRender(render.clip_id)
    setError(null)
    try {
      const filename = render.render_path.split('/').pop() ?? `${render.clip_id}.mp4`
      const { data, error: signErr } = await supabase.storage
        .from('renders')
        .createSignedUrl(render.render_path, 300, { download: filename })
      if (signErr || !data?.signedUrl) throw new Error(signErr?.message ?? 'URL 생성 실패')
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'download failed')
    } finally {
      setDownloadingRender(null)
    }
  }

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Left: Projects */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-white">Ingested Projects</h2>
          <button
            onClick={handleDeleteAllProjects}
            disabled={deletingAllProjects || projects.length === 0}
            className="rounded-lg bg-[#272729] px-3 py-1.5 text-[12px] text-red-400 transition-colors hover:bg-[#2a2a2d] disabled:opacity-30"
          >
            {deletingAllProjects ? '삭제 중…' : '전체 삭제'}
          </button>
        </div>

        {projects.length === 0 ? (
          <div className="rounded-xl bg-[#1d1d1f] px-6 py-10 text-center text-[13px] text-[rgba(255,255,255,0.3)]">
            아직 데이터가 없습니다
          </div>
        ) : (
          <div className="space-y-2">
            {projects.map(p => (
              <div key={p.id} className="rounded-xl bg-[#1d1d1f] px-4 py-3">
                <div className="mb-1.5 flex items-start justify-between gap-2">
                  <span className="text-[13px] font-medium text-white">
                    {p.artist} – {p.song_title}
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => handleEditClick(p)}
                      className="rounded-md bg-[#272729] px-2 py-1 text-[11px] text-[rgba(255,255,255,0.6)] hover:text-white"
                    >
                      편집
                    </button>
                    <button
                      onClick={() => handleDeleteProject(p.id)}
                      disabled={deletingProject === p.id}
                      className="rounded-md bg-[#272729] px-2 py-1 text-[11px] text-red-400 hover:text-red-300 disabled:opacity-30"
                    >
                      {deletingProject === p.id ? '…' : '×'}
                    </button>
                  </div>
                </div>
                {editBlockedId === p.id && (
                  <p className="mb-1.5 text-[11px] text-[rgba(255,255,255,0.45)]">
                    파일 생성 중입니다. 잠시만 기다리세요.
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_COLORS[p.import_status ?? ''] ?? STATUS_COLORS.pending}`}>
                    {p.import_status ?? 'pending'}
                  </span>
                  <span className="text-[11px] text-[rgba(255,255,255,0.3)]">
                    {formatDate(p.created_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Right: Renders */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-white">Rendered Outputs</h2>
          <button
            onClick={handleDeleteAllRenders}
            disabled={deletingAllRenders || renders.length === 0}
            className="rounded-lg bg-[#272729] px-3 py-1.5 text-[12px] text-red-400 transition-colors hover:bg-[#2a2a2d] disabled:opacity-30"
          >
            {deletingAllRenders ? '삭제 중…' : '전체 삭제'}
          </button>
        </div>

        {renders.length === 0 ? (
          <div className="rounded-xl bg-[#1d1d1f] px-6 py-10 text-center text-[13px] text-[rgba(255,255,255,0.3)]">
            아직 데이터가 없습니다
          </div>
        ) : (
          <div className="space-y-2">
            {renders.map(r => {
              const filename = r.render_path.split('/').pop() ?? r.clip_id
              return (
                <div key={r.clip_id} className="rounded-xl bg-[#1d1d1f] px-4 py-3">
                  <div className="mb-1.5 flex items-start justify-between gap-2">
                    <span className="break-all text-[12px] font-mono text-white">{filename}</span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() => handleDownload(r)}
                        disabled={downloadingRender === r.clip_id}
                        className="rounded-md bg-[#0071e3] px-2 py-1 text-[11px] text-white hover:bg-[#0077ed] disabled:opacity-30"
                      >
                        {downloadingRender === r.clip_id ? '…' : '다운로드'}
                      </button>
                      <button
                        onClick={() => handleDeleteRender(r.clip_id)}
                        disabled={deletingRender === r.clip_id}
                        className="rounded-md bg-[#272729] px-2 py-1 text-[11px] text-red-400 hover:text-red-300 disabled:opacity-30"
                      >
                        {deletingRender === r.clip_id ? '…' : '×'}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.render_preset && (
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${PRESET_COLORS[r.render_preset] ?? PRESET_COLORS.balanced}`}>
                        {r.render_preset}
                      </span>
                    )}
                    <span className="text-[11px] text-[rgba(255,255,255,0.3)]">
                      {formatDuration(r.start_sec, r.end_sec)} · {r.artist}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {error && (
        <div className="col-span-2 rounded-lg bg-red-900/30 px-4 py-2 text-[12px] text-red-400">
          {error}
        </div>
      )}
    </div>
  )
}
