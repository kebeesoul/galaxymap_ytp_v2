'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Tables } from '@/lib/supabase/types'

type Project = Tables<'projects'>

function ImportStatusBadge({ status, importError }: { status: string | null; importError?: string | null }) {
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
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="rounded-full bg-red-100 px-3 py-1 text-[12px] font-medium text-red-700">
          Failed
        </span>
        {importError && (
          <span
            className="max-w-[220px] truncate text-[11px] text-red-400 cursor-default"
            title={importError}
          >
            {importError}
          </span>
        )}
      </div>
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
  const supabase = useMemo(() => createClient(), [])

  // On mount, fetch fresh data from the API to ensure the list is always in
  // sync with the DB — the SSR snapshot can be stale if Realtime missed an
  // INSERT event (e.g. project created before the subscription was active).
  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.ok ? r.json() as Promise<Project[]> : Promise.reject())
      .then(data => {
        setProjects(prev => {
          const apiIds = new Set(data.map(p => p.id))
          // Keep locally-added pending/processing projects not yet in the API snapshot
          const localPending = prev.filter(
            p => !apiIds.has(p.id) && (p.import_status === 'pending' || p.import_status === 'processing')
          )
          return [...localPending, ...data]
        })
      })
      .catch(() => {
        // Fallback: sync SSR snapshot the old way
        setProjects(prev => {
          const serverIds = new Set(initialProjects.map(p => p.id))
          const localPending = prev.filter(
            p => !serverIds.has(p.id) && (p.import_status === 'pending' || p.import_status === 'processing')
          )
          return [...localPending, ...initialProjects]
        })
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Immediately show a project that was just created before navigation.
  // sessionStorage bridges the gap between the insert and the server render,
  // which may return a cached snapshot that predates the insert.
  useEffect(() => {
    const raw = sessionStorage.getItem('galaxymap_new_project')
    if (!raw) return
    sessionStorage.removeItem('galaxymap_new_project')
    try {
      const newProject = JSON.parse(raw) as Project
      setProjects(prev =>
        prev.some(p => p.id === newProject.id) ? prev : [newProject, ...prev]
      )
    } catch {
      // malformed data — ignore
    }
  }, [])

  // Supabase Realtime: keep dashboard in sync with DB changes from any source
  // (ingest worker, direct Supabase edits, other sessions)
  useEffect(() => {
    const channel = supabase
      .channel('projects-dashboard')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'projects' },
        (payload) => {
          const row = payload.new as Project
          setProjects(prev => prev.some(p => p.id === row.id) ? prev : [row, ...prev])
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'projects' },
        (payload) => {
          const row = payload.new as Project
          setProjects(prev => prev.map(p => p.id === row.id ? row : p))
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'projects' },
        (payload) => {
          const old = payload.old as { id?: string }
          if (old.id) setProjects(prev => prev.filter(p => p.id !== old.id))
        }
      )
      .subscribe()
    return () => { channel.unsubscribe(); supabase.removeChannel(channel) }
  }, [supabase])

  async function deleteProject(id: string): Promise<string | null> {
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
    // 404 = already gone from DB, treat as success so UI removes the stale row
    if (res.ok || res.status === 404) return null
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    return body.error ?? `HTTP ${res.status}`
  }

  async function handleRetry(id: string, sourceUrl: string) {
    await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: id, url: sourceUrl }),
    })
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
    // No router.refresh() — calling it causes useEffect([initialProjects]) to overwrite
    // local state with a server snapshot that may still contain the just-deleted row,
    // making the project reappear. Realtime DELETE handles server-side confirmation.
  }

  async function handleDeleteAll() {
    if (projects.length === 0) return
    setDeletingAll(true)
    const snapshot = [...projects]
    const results = await Promise.all(snapshot.map(p => deleteProject(p.id)))
    const failedCount = results.filter(Boolean).length
    if (failedCount > 0) {
      const firstError = results.find(Boolean)
      alert(`${failedCount}개 프로젝트 삭제 실패: ${firstError}`)
    }
    // Use IDs (not indices) so concurrent Realtime updates don't shift positions
    const deletedIds = new Set(snapshot.filter((_, i) => results[i] === null).map(p => p.id))
    setProjects(prev => prev.filter(p => !deletedIds.has(p.id)))
    setDeletingAll(false)
  }

  return (
    <>
      <p className="fixed left-4 top-3 text-[11px] text-[rgba(0,0,0,0.28)] select-none pointer-events-none">
        ytp dashboard created by galaxymap
      </p>
      <div className="mb-12 flex items-center justify-between">
        <h1
          className="text-[40px] font-semibold leading-[1.10] text-[#1d1d1f]"
          style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", Helvetica, Arial, sans-serif' }}
        >
          <Link href="/editor" className="hover:opacity-70 transition-opacity">
            Editor
          </Link>
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
            href="/history"
            className="rounded-lg border border-[rgba(0,0,0,0.12)] bg-white px-4 py-2 text-[17px] text-[#1d1d1f] transition-colors hover:bg-[#f5f5f7]"
          >
            History
          </Link>
          <Link
            href="/select"
            className="rounded-lg bg-[#0071e3] px-4 py-2 text-[17px] text-white transition-colors hover:bg-[#0077ed]"
          >
            Select
          </Link>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-2xl bg-white py-24 text-center shadow-[rgba(0,0,0,0.08)_0px_2px_12px]">
          <p className="text-[17px] text-[rgba(0,0,0,0.48)]">No projects yet.</p>
          <Link href="/select" className="mt-4 inline-block text-[14px] text-[#0066cc] hover:underline">
            Select your first source →
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {[
            ...projects.filter(p => p.import_status === 'pending' || p.import_status === 'processing'),
            ...projects.filter(p => p.import_status !== 'pending' && p.import_status !== 'processing'),
          ].map(project => {
            const isImporting = project.import_status === 'pending' || project.import_status === 'processing'
            return (
              <div key={project.id} className="group relative">
                <Link href={`/editor/${project.id}`}>
                  <div className={`flex items-center gap-6 rounded-2xl px-6 py-5 transition-shadow ${
                    isImporting
                      ? 'bg-amber-50 ring-1 ring-amber-200 shadow-[rgba(0,0,0,0.06)_0px_2px_12px] hover:shadow-[rgba(0,0,0,0.12)_0px_4px_20px]'
                      : 'bg-white shadow-[rgba(0,0,0,0.08)_0px_2px_12px] hover:shadow-[rgba(0,0,0,0.14)_0px_4px_20px]'
                  }`}>
                    {project.yt_thumbnail_url ? (
                      <img
                        src={project.yt_thumbnail_url}
                        alt={project.yt_title ?? project.song_title}
                        className="h-16 w-28 rounded-lg object-cover"
                      />
                    ) : (
                      <div className={`h-16 w-28 shrink-0 rounded-lg ${isImporting ? 'bg-amber-100' : 'bg-[#f5f5f7]'}`} />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[21px] font-semibold leading-[1.19] tracking-[0.231px] text-[#1d1d1f]">
                        {project.song_title}
                      </p>
                      <p className="mt-0.5 text-[14px] text-[rgba(0,0,0,0.6)]">{project.artist}</p>
                    </div>
                    <ImportStatusBadge status={project.import_status} importError={project.import_error} />
                  </div>
                </Link>

                {project.import_status === 'failed' && (
                  <button
                    onClick={(e) => { e.preventDefault(); handleRetry(project.id, project.source_url) }}
                    className="absolute right-12 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full bg-white text-[rgba(0,0,0,0.3)] opacity-0 shadow-sm transition-all hover:bg-blue-50 hover:text-blue-500 group-hover:opacity-100"
                    title="다시 시도"
                  >
                    <span className="text-[14px] leading-none">↺</span>
                  </button>
                )}
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
            )
          })}
        </div>
      )}
    </>
  )
}
