import { createClient } from '@/lib/supabase/server'
import DashboardNav from '@/components/dashboard/nav'
import HistoryPanel from './HistoryPanel'
import type { HistoryProject, HistoryRender } from './HistoryPanel'

export const dynamic = 'force-dynamic'

export default async function HistoryPage() {
  const supabase = createClient()

  const [{ data: projectRows }, { data: clipRows }, { data: projectForClips }] =
    await Promise.all([
      supabase
        .from('projects')
        .select('id, artist, song_title, import_status, created_at')
        .order('created_at', { ascending: false }),
      supabase
        .from('clips')
        .select('id, render_path, render_preset, render_status, start_sec, end_sec, project_id')
        .not('render_status', 'is', null)
        .order('id'),
      supabase.from('projects').select('id, artist, song_title'),
    ])

  const projectById = new Map((projectForClips ?? []).map(p => [p.id, p]))

  const renders: HistoryRender[] = (clipRows ?? []).flatMap(c => {
    if (!c.project_id) return []
    const proj = projectById.get(c.project_id)
    if (!proj) return []
    return [{
      clip_id: c.id,
      render_path: c.render_path ?? null,
      render_preset: c.render_preset,
      render_status: c.render_status,
      start_sec: c.start_sec,
      end_sec: c.end_sec,
      project_id: c.project_id,
      artist: proj.artist,
      song_title: proj.song_title,
    }]
  })

  return (
    <div className="min-h-screen bg-black">
      <DashboardNav />
      <main className="mx-auto max-w-[1200px] px-6 py-10">
        <h1 className="mb-8 text-[28px] font-semibold text-white">History</h1>
        <HistoryPanel
          initialProjects={(projectRows ?? []) as HistoryProject[]}
          initialRenders={renders}
        />
      </main>
    </div>
  )
}
