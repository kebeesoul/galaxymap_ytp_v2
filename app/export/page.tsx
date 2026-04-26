import { createClient } from '@/lib/supabase/server'
import ExportList from './ExportList'

export const dynamic = 'force-dynamic'

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

export default async function ExportPage() {
  let rows: ExportRow[] = []
  let dbError: string | null = null

  try {
    const supabase = createClient()
    const [{ data: clipRows, error: clipErr }, { data: projectRows, error: projectErr }] =
      await Promise.all([
        supabase
          .from('clips')
          .select('id, label, start_sec, end_sec, render_path, project_id')
          .eq('render_status', 'success')
          .not('render_path', 'is', null)
          .order('id'),
        supabase.from('projects').select('id, artist, song_title, yt_thumbnail_url'),
      ])
    if (clipErr || projectErr) {
      dbError = clipErr?.message ?? projectErr?.message ?? 'unknown error'
    } else {
      const projectById = new Map(
        (projectRows ?? []).map((p) => [p.id, p]),
      )
      rows = (clipRows ?? []).flatMap((r) => {
        if (!r.render_path || !r.project_id) return []
        const project = projectById.get(r.project_id)
        if (!project) return []
        return [{
          clip_id: r.id,
          clip_label: r.label,
          start_sec: r.start_sec,
          end_sec: r.end_sec,
          render_path: r.render_path,
          project_id: r.project_id,
          artist: project.artist,
          song_title: project.song_title,
          thumbnail_url: project.yt_thumbnail_url,
        }]
      })
    }
  } catch (err) {
    dbError = err instanceof Error ? err.message : 'Database connection failed'
  }

  if (dbError) {
    return (
      <main className="min-h-screen bg-[#f5f5f7] px-6 py-16">
        <div className="mx-auto max-w-[980px]">
          <div className="rounded-2xl bg-red-50 px-8 py-10 shadow-[rgba(0,0,0,0.08)_0px_2px_12px]">
            <p className="text-[21px] font-semibold text-red-600">서비스 연결 오류</p>
            <p className="mt-2 font-mono text-[13px] text-red-400">{dbError}</p>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#f5f5f7] px-6 py-16">
      <div className="mx-auto max-w-[980px]">
        <ExportList rows={rows} />
      </div>
    </main>
  )
}
