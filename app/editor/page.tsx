import { createClient } from '@/lib/supabase/server'
import type { Tables } from '@/lib/supabase/types'
import ProjectList from '../projects/ProjectList'

export const dynamic = 'force-dynamic'

type Project = Tables<'projects'>

export default async function EditorIndexPage() {
  let projects: Project[] = []
  let dbError: string | null = null

  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) dbError = error.message
    else projects = data ?? []
  } catch (error) {
    dbError = error instanceof Error ? error.message : 'Database connection failed'
  }

  if (dbError) {
    return (
      <main className="min-h-screen bg-[#f5f5f7] px-6 py-16">
        <div className="mx-auto max-w-[980px]">
          <div className="rounded-lg bg-red-50 px-8 py-10 shadow-[rgba(0,0,0,0.08)_0px_2px_12px]">
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
        <ProjectList initialProjects={projects} />
      </div>
    </main>
  )
}
