import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function ProjectsPage() {
  const supabase = createClient()
  const { data: projects } = await supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false })

  return (
    <main className="min-h-screen bg-[#f5f5f7] px-6 py-16">
      <div className="mx-auto max-w-[980px]">
        <div className="mb-12 flex items-center justify-between">
          <h1
            className="text-[40px] font-semibold leading-[1.10] text-[#1d1d1f]"
            style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", Helvetica, Arial, sans-serif' }}
          >
            Projects
          </h1>
          <Link
            href="/projects/new"
            className="rounded-lg bg-[#0071e3] px-4 py-2 text-[17px] text-white transition-colors hover:bg-[#0077ed]"
          >
            New Project
          </Link>
        </div>

        {!projects?.length ? (
          <div className="rounded-2xl bg-white py-24 text-center shadow-[rgba(0,0,0,0.08)_0px_2px_12px]">
            <p className="text-[17px] text-[rgba(0,0,0,0.48)]">No projects yet.</p>
            <Link
              href="/projects/new"
              className="mt-4 inline-block text-[14px] text-[#0066cc] hover:underline"
            >
              Create your first project →
            </Link>
          </div>
        ) : (
          <div className="grid gap-3">
            {projects.map((project) => (
              <Link key={project.id} href={`/editor/${project.id}`}>
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
            ))}
          </div>
        )}
      </div>
    </main>
  )
}

function ImportStatusBadge({ status }: { status: string | null }) {
  if (status === 'success') {
    return (
      <span className="shrink-0 rounded-full bg-green-100 px-3 py-1 text-[12px] font-medium text-green-700">
        Ready
      </span>
    )
  }
  if (status === 'pending') {
    return (
      <span className="shrink-0 rounded-full bg-yellow-100 px-3 py-1 text-[12px] font-medium text-yellow-700">
        Importing…
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="shrink-0 rounded-full bg-red-100 px-3 py-1 text-[12px] font-medium text-red-700">
        Failed
      </span>
    )
  }
  return (
    <span className="shrink-0 rounded-full bg-[#f5f5f7] px-3 py-1 text-[12px] text-[rgba(0,0,0,0.4)]">
      Not imported
    </span>
  )
}
