import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import EditorClient from './EditorClient'
import { textOverlaySchema, type TextOverlay } from '@/lib/text-overlays'

export const dynamic = 'force-dynamic'

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

  const { data: templates } = await supabase.from('templates').select('*').order('name')
  const clipIds = (clips ?? []).map((clip) => clip.id)
  const { data: overlayRows } = clipIds.length > 0
    ? await supabase
      .from('text_overlays')
      .select('*')
      .in('clip_id', clipIds)
      .order('z_index')
    : { data: [] }
  const initialTextOverlaysByClip = (overlayRows ?? []).reduce<Record<string, TextOverlay[]>>(
    (result, row) => {
      const parsed = textOverlaySchema.safeParse(row)
      if (!parsed.success) return result
      const clipOverlays = result[parsed.data.clip_id] ?? []
      clipOverlays.push(parsed.data)
      result[parsed.data.clip_id] = clipOverlays
      return result
    },
    {},
  )

  return (
    <div className="min-h-screen bg-black">
      <div className="mx-auto max-w-[980px] px-6 py-8">
        <EditorClient
          project={project}
          initialClips={clips ?? []}
          initialSegmentsByClip={{}}
          initialCommentsByClip={{}}
          initialTextOverlaysByClip={initialTextOverlaysByClip}
          templates={templates ?? []}
        />
      </div>
    </div>
  )
}
