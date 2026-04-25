import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Tables } from '@/lib/supabase/types'
import EditorClient from './EditorClient'

export const dynamic = 'force-dynamic'

type LyricsSegment = Tables<'lyrics_segments'>
type Comment = Tables<'comments'>
type Template = Tables<'templates'>

interface Props {
  params: { id: string }
}

export default async function EditorPage({ params }: Props) {
  let supabase: ReturnType<typeof createClient>
  try {
    supabase = createClient()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Database connection failed'
    return (
      <div className="min-h-screen bg-black px-6 py-16">
        <div className="mx-auto max-w-[980px] rounded-xl bg-red-950/40 px-8 py-10">
          <p className="text-[21px] font-semibold text-red-400">서비스 연결 오류</p>
          <p className="mt-2 font-mono text-[13px] text-red-300/70">{message}</p>
          <p className="mt-4 text-[14px] text-[rgba(255,255,255,0.4)]">
            Railway → Service → Variables에서 환경변수를 확인하세요.
          </p>
        </div>
      </div>
    )
  }

  const { data: project, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !project) notFound()

  const { data: clips } = await supabase
    .from('clips')
    .select('*')
    .eq('project_id', params.id)
    .order('created_at', { ascending: true })

  const clipIds = (clips ?? []).map(c => c.id)

  let segmentsByClip: Record<string, LyricsSegment[]> = {}
  let commentsByClip: Record<string, Comment[]> = {}

  if (clipIds.length > 0) {
    const [{ data: segments }, { data: comments }] = await Promise.all([
      supabase.from('lyrics_segments').select('*').in('clip_id', clipIds).order('start_sec'),
      supabase.from('comments').select('*').in('clip_id', clipIds),
    ])

    for (const seg of segments ?? []) {
      if (!seg.clip_id) continue
      if (!segmentsByClip[seg.clip_id]) segmentsByClip[seg.clip_id] = []
      segmentsByClip[seg.clip_id].push(seg)
    }

    for (const c of comments ?? []) {
      if (!c.clip_id) continue
      if (!commentsByClip[c.clip_id]) commentsByClip[c.clip_id] = []
      commentsByClip[c.clip_id].push(c)
    }
  }

  const { data: templates } = await supabase.from('templates').select('*').order('name')

  return (
    <div className="min-h-screen bg-black">
      <nav className="sticky top-0 z-10 flex h-12 items-center gap-3 border-b border-white/[0.08] bg-black/80 px-6 backdrop-blur-xl">
        <Link
          href="/projects"
          className="text-[12px] text-[rgba(255,255,255,0.5)] transition-colors hover:text-white"
        >
          ← Projects
        </Link>
        <span className="text-[rgba(255,255,255,0.2)]">/</span>
        <span className="max-w-[200px] truncate text-[12px] text-[rgba(255,255,255,0.7)]">
          {project.song_title}
        </span>
        <span className="text-[12px] text-[rgba(255,255,255,0.35)]">{project.artist}</span>
      </nav>

      <div className="mx-auto max-w-[980px] px-6 py-8">
        <EditorClient
          project={project}
          initialClips={clips ?? []}
          initialSegmentsByClip={segmentsByClip}
          initialCommentsByClip={commentsByClip}
          templates={templates ?? []}
        />
      </div>
    </div>
  )
}
