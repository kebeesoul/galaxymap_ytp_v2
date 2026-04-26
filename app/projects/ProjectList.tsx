'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Tables } from '@/lib/supabase/types'

type Project = Tables<'projects'>

function ImportStatusBadge({ status }: { status: string | null }) {
  if (status === 'success')
    return (
      <span className="shrink-0 rounded-full bg-green-100 px-3 py-1 text-[12px] font-medium text-green-700">
        Ready
      </span>
    )
  if (status === 'pending' || status === 'processing')
    return (
      <span className="shrink-0 flex items-center gap-1.5 rounded-full bg-yellow-100 px-3 py-1 text-[12px] font-medium text-yellow-700">
        <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-yellow-300 border-t-yellow-600" />
        Importing…
      </span>
    )
  if (status === 'failed')
    return (
      <span className="shrink-0 rounded-full bg-red-100 px-3 py-1 text-[12px] font-medium text-red-700">
        Failed
      </span>
    )
  return (
    <span className="shrink-0 rounded-full bg-[#f5f5f7] px-3 py-1 text-[12px] text-[rgba(0,0,0,0.4)]">
      Not imported
    </span>
  )
}

export default function ProjectList({ initialProjects }: { initialProjects: Project[] }) {
  const [projects, setProjects] = useState(initialProjects)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deletingAll, setDeletingAll] = useState(false)
  const router = useRouter()

  // Sync fresh server data (from router.refresh) into local state
  useEffect(() => {
    setProjects(initialProjects)
  }, [initialProjects])

  // Auto-refresh every 3s while any project is still importing
  useEffect(() => {
    const hasImporting = projects.some(
      p => p.import_status === 'pending' || p.import_status === 'processing'
    )
    if (!hasImporting) return
    const id = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(id)
  }, [projects, router])

  async function deleteProject(id: string): Promise<string | null> {
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
    if (res.ok) return null
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    return body.error ?? `HTTP ${res.status}`
  }

  async function handleDelete(id: string) {
    setDeleting(id)
    const error = await deleteProject(id)
    if (error) {
      alert(`삭제 실패: ${error}`)
      setDeleting(null)
      return
    }
    setProjects(prev => prev.filter(p => p.id !== id))
    setDeleting(null)
    router.refresh()
  }

  async function handleDeleteAll() {
    if (projects.length === 0) return
    setDeletingAll(true)
    const results = await Promise.all(projects.map(p => deleteProject(p.id)))
    const failedCount = results.filter(Boolean).length
    if (failedCount > 0) {
      const firstError = results.find(Boolean)
      alert(`${failedCount}개 프로젝트 삭제 실패: ${firstError}`)
    }
    setProjects(prev => prev.filter((_, i) => results[i] !== null))
    setDeletingAll(false)
    router.refresh()
  }

  return (
    <>
      <div className="mb-12 flex items-center justify-between">
        <h1
          className="text-[40px] font-semibold leading-[1.10] text-[#1d1d1f]"
          style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", Helvetica, Arial, sans-serif' }}
        >
          Projects
        </h1>
        <div className="flex items-center gap-3">
          {projects.length > 0 && (
            <button
              onClick={handleDeleteAll}
              disabled={deletingAll}
              className="rounded-lg border border-red-200 px-4 py-2 text-[14px] text-red-500 transition-colors hover:bg-red-50 disabled:opacity-40"
            >
              {deletingAll ? '삭제 중…' : '전체 삭제'}
            </button>
          )}
          <Link
            href="/export"
            className="rounded-lg border border-[rgba(0,0,0,0.12)] bg-white px-4 py-2 text-[17px] text-[#1d1d1f] transition-colors hover:bg-[#f5f5f7]"
          >
            Export
          </Link>
          <Link
            href="/projects/new"
            className="rounded-lg bg-[#0071e3] px-4 py-2 text-[17px] text-white transition-colors hover:bg-[#0077ed]"
          >
            New Project
          </Link>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-2xl bg-white py-24 text-center shadow-[rgba(0,0,0,0.08)_0px_2px_12px]">
          <p className="text-[17px] text-[rgba(0,0,0,0.48)]">No projects yet.</p>
          <Link href="/projects/new" className="mt-4 inline-block text-[14px] text-[#0066cc] hover:underline">
            Create your first project →
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {projects.map(project => (
            <div key={project.id} className="group relative">
              <Link href={`/editor/${project.id}`}>
                <div className="flex items-center gap-6 rounded-2xl bg-white px-6 py-5 shadow-[rgba(0,0,0,0.08)_0px_2px_12px] transition-shadow hover:shadow-[rgba(0,0,0,0.14)_0px_4px_20px]">
                  {project.yt_thumbnail_url ? (
                    <img
                      src={project.yt_thumbnail_url}
                      alt={project.yt_title ?? project.song_title}
                      className="h-16 w-28 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="h-16 w-28 shrink-0 rounded-lg bg-[#f5f5f7]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[21px] font-semibold leading-[1.19] tracking-[0.231px] text-[#1d1d1f]">
                      {project.song_title}
                    </p>
                    <p className="mt-0.5 text-[14px] text-[rgba(0,0,0,0.6)]">{project.artist}</p>
                  </div>
                  <ImportStatusBadge status={project.import_status} />
                </div>
              </Link>

              <button
                onClick={() => handleDelete(project.id)}
                disabled={deleting === project.id}
                className="absolute right-4 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full bg-white text-[rgba(0,0,0,0.3)] opacity-0 shadow-sm transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 disabled:opacity-40"
                title="삭제"
              >
                {deleting === project.id ? (
                  <span className="h-3 w-3 animate-spin rounded-full border border-red-300 border-t-red-500" />
                ) : (
                  <span className="text-[14px] leading-none">✕</span>
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
