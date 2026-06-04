import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import type { Tables } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'

type Recommendation = Tables<'track_recommendations'>
type Project = Tables<'projects'>
type TonePreset = Tables<'tone_presets'>

export default async function CurationPage() {
  let recommendations: Recommendation[] = []
  let projects: Project[] = []
  let tonePresets: TonePreset[] = []
  let dbError: string | null = null

  try {
    const supabase = createClient()
    const [recommendationRes, projectRes, toneRes] = await Promise.all([
      supabase
        .from('track_recommendations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(24),
      supabase
        .from('projects')
        .select('*')
        .not('description_base', 'is', null)
        .order('created_at', { ascending: false })
        .limit(12),
      supabase
        .from('tone_presets')
        .select('*')
        .eq('is_active', true)
        .order('key'),
    ])

    dbError = recommendationRes.error?.message ?? projectRes.error?.message ?? toneRes.error?.message ?? null
    recommendations = recommendationRes.data ?? []
    projects = projectRes.data ?? []
    tonePresets = toneRes.data ?? []
  } catch (err) {
    dbError = err instanceof Error ? err.message : 'Database connection failed'
  }

  return (
    <main className="min-h-screen bg-[#f5f5f7] px-6 py-16">
      <div className="mx-auto max-w-[980px]">
        <div className="mb-12">
          <p className="text-[12px] text-[rgba(0,0,0,0.48)]">Curation</p>
          <h1
            className="mt-2 text-[40px] font-semibold leading-[1.10] text-[#1d1d1f]"
            style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", Helvetica, Arial, sans-serif' }}
          >
            Inspiration Board
          </h1>
        </div>

        {dbError && (
          <p className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-[14px] text-red-600">
            {dbError}
          </p>
        )}

        <section className="mb-10">
          <h2 className="mb-4 text-[21px] font-semibold text-[#1d1d1f]">Recommended Tracks</h2>
          {recommendations.length === 0 ? (
            <EmptyState>No recommendations yet.</EmptyState>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {recommendations.map((item) => (
                <article key={item.id} className="rounded-lg bg-white p-5 shadow-[rgba(0,0,0,0.08)_0px_2px_12px]">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <span className="rounded-full bg-[#f5f5f7] px-3 py-1 text-[12px] text-[rgba(0,0,0,0.58)]">
                      {item.role ?? `Rank ${item.rank ?? '-'}`}
                    </span>
                    <span className="text-[12px] text-[rgba(0,0,0,0.48)]">{item.release_year ?? ''}</span>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[21px] font-semibold leading-[1.19] text-[#1d1d1f]">{item.song_title}</p>
                      <p className="mt-1 text-[14px] text-[rgba(0,0,0,0.58)]">{item.artist}</p>
                    </div>
                    <Link
                      href={`/select?artist=${encodeURIComponent(item.artist)}&song_title=${encodeURIComponent(item.song_title)}&resolve=1`}
                      className="shrink-0 text-[12px] text-[#0066cc] transition-colors hover:text-[#0071e3] hover:underline"
                    >
                      select
                    </Link>
                  </div>
                  {item.yt_title && (
                    <p className="mt-4 line-clamp-2 text-[14px] text-[rgba(0,0,0,0.58)]">{item.yt_title}</p>
                  )}
                  {item.reason && (
                    <p className="mt-4 text-[14px] leading-[1.43] text-[rgba(0,0,0,0.72)]">{item.reason}</p>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="mb-10">
          <h2 className="mb-4 text-[21px] font-semibold text-[#1d1d1f]">Description References</h2>
          {projects.length === 0 ? (
            <EmptyState>No saved descriptions yet.</EmptyState>
          ) : (
            <div className="space-y-4">
              {projects.map((project) => (
                <article key={project.id} className="rounded-lg bg-white p-5 shadow-[rgba(0,0,0,0.08)_0px_2px_12px]">
                  <p className="text-[17px] font-semibold text-[#1d1d1f]">
                    {project.artist} - {project.song_title}
                  </p>
                  {project.description_base && (
                    <p className="mt-3 text-[14px] leading-[1.43] text-[rgba(0,0,0,0.68)]">
                      {project.description_base}
                    </p>
                  )}
                  {project.description_styled && (
                    <p className="mt-3 rounded-lg bg-[#f5f5f7] p-4 text-[14px] leading-[1.43] text-[#1d1d1f]">
                      {project.description_styled}
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-4 text-[21px] font-semibold text-[#1d1d1f]">Tone Presets</h2>
          {tonePresets.length === 0 ? (
            <EmptyState>No active tone presets.</EmptyState>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {tonePresets.map((preset) => (
                <article key={preset.id} className="rounded-lg bg-white p-5 shadow-[rgba(0,0,0,0.08)_0px_2px_12px]">
                  <p className="text-[17px] font-semibold text-[#1d1d1f]">{preset.label}</p>
                  <p className="mt-2 text-[14px] leading-[1.43] text-[rgba(0,0,0,0.68)]">{preset.description}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-white py-16 text-center shadow-[rgba(0,0,0,0.08)_0px_2px_12px]">
      <p className="text-[17px] text-[rgba(0,0,0,0.48)]">{children}</p>
    </div>
  )
}
