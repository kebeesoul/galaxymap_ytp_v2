'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import ClipEditor from '@/components/video-editor/ClipEditor'
import VideoPreview from '@/components/video-editor/VideoPreview'
import type { Project, Clip, LyricsSegment, Comment, Template } from '@/lib/types'

interface Props {
  project: Project
  initialClips: Clip[]
  initialSegmentsByClip: Record<string, LyricsSegment[]>
  initialCommentsByClip: Record<string, Comment[]>
  templates: Template[]
}

export default function EditorClient({
  project,
  initialClips,
  initialSegmentsByClip,
  initialCommentsByClip,
  templates,
}: Props) {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router
  const supabase = useMemo(() => createClient(), [])

  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')

  // C6: Supabase Realtime for import_status (replaces 3s polling)
  useEffect(() => {
    if (project.import_status !== 'pending' && project.import_status !== 'processing') return
    const channel = supabase
      .channel(`project-import-${project.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${project.id}` },
        (payload) => {
          const status = (payload.new as { import_status?: string }).import_status
          if (status === 'success' || status === 'failed') window.location.reload()
        }
      )
      .subscribe()
    return () => { channel.unsubscribe(); supabase.removeChannel(channel) }
  }, [project.import_status, project.id, supabase])

  async function handleImport() {
    setImporting(true)
    setError('')
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: project.id, url: project.source_url }),
      })
      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error ?? 'Import failed')
      }
      // 202 received — refresh immediately to show pending state, then polling takes over
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setImporting(false)
    }
  }

  if (project.import_status === 'success') {
    return (
      <div className="space-y-6">
        <div className="flex gap-6">
          <div className="w-48 shrink-0">
            <VideoPreview
              thumbnailUrl={project.yt_thumbnail_url}
              title={null}
              durationSec={project.yt_duration_sec}
            />
          </div>
          <div className="min-w-0 flex-1 pt-1">
            <h2 className="text-[28px] font-semibold leading-[1.14] tracking-[0.196px] text-white">
              {project.song_title}
            </h2>
            <p className="mt-1 text-[17px] tracking-[-0.374px] text-[rgba(255,255,255,0.6)]">
              {project.artist}
            </p>
            {project.yt_title && (
              <p className="mt-3 text-[14px] tracking-[-0.224px] text-[rgba(255,255,255,0.3)]">
                {project.yt_title}
              </p>
            )}
            {project.yt_duration_sec && (
              <p className="mt-1 text-[14px] text-[rgba(255,255,255,0.3)]">
                {Math.floor(project.yt_duration_sec / 60)}:
                {(project.yt_duration_sec % 60).toString().padStart(2, '0')}
              </p>
            )}
          </div>
        </div>
        <ClipEditor
          project={project}
          initialClips={initialClips}
          initialSegmentsByClip={initialSegmentsByClip}
          initialCommentsByClip={initialCommentsByClip}
          templates={templates}
        />
      </div>
    )
  }

  if (project.import_status === 'failed') {
    return (
      <div className="space-y-4">
        <ProjectHeader project={project} />
        <div className="rounded-xl bg-red-950/40 p-6">
          <p className="text-[17px] font-semibold text-red-400">Import Failed</p>
          {project.import_error && (
            <p className="mt-2 font-mono text-[13px] text-red-300/70">{project.import_error}</p>
          )}
          <ImportButton onClick={handleImport} loading={importing} label="Retry Import" />
          {error && <p className="mt-2 text-[14px] text-red-400">{error}</p>}
        </div>
      </div>
    )
  }

  if (project.import_status === 'pending' || project.import_status === 'processing') {
    const label = project.import_status === 'processing' ? 'Downloading…' : 'Queued…'
    return (
      <div className="space-y-4">
        <ProjectHeader project={project} />
        <div className="rounded-xl bg-[#1d1d1f] p-6">
          <div className="flex items-center gap-4">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            <span className="text-[17px] text-white">{label}</span>
          </div>
          <p className="mt-3 text-[13px] text-[rgba(255,255,255,0.35)]">
            동영상을 다운로드하고 있습니다. 잠시 기다려 주세요.
          </p>
          <ImportButton onClick={handleImport} loading={importing} label="재시도" />
          {error && <p className="mt-2 text-[14px] text-red-400">{error}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <ProjectHeader project={project} />
      <div className="rounded-xl bg-[#1d1d1f] p-6">
        <p className="mb-5 text-[17px] tracking-[-0.374px] text-[rgba(255,255,255,0.8)]">
          Import the YouTube video to start editing clips.
        </p>
        <ImportButton onClick={handleImport} loading={importing} label="Import Video" />
        {error && <p className="mt-3 text-[14px] text-red-400">{error}</p>}
      </div>
    </div>
  )
}

function ProjectHeader({ project }: { project: Project }) {
  return (
    <div className="rounded-xl bg-[#272729] px-6 py-5">
      <p className="text-[21px] font-semibold leading-[1.19] tracking-[0.231px] text-white">
        {project.song_title}
      </p>
      <p className="mt-0.5 text-[14px] tracking-[-0.224px] text-[rgba(255,255,255,0.5)]">
        {project.artist}
      </p>
      <p className="mt-3 break-all font-mono text-[12px] text-[rgba(255,255,255,0.24)]">
        {project.source_url}
      </p>
    </div>
  )
}

function ImportButton({
  onClick,
  loading,
  label,
}: {
  onClick: () => void
  loading: boolean
  label: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="mt-5 flex items-center gap-2 rounded-lg bg-[#0071e3] px-6 py-3 text-[17px] text-white transition-colors hover:bg-[#0077ed] disabled:opacity-50"
    >
      {loading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      )}
      {loading ? 'Importing…' : label}
    </button>
  )
}
