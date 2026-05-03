import { createClient } from '@/lib/supabase/server'
import DashboardNav from '@/components/dashboard/nav'
import CuratorBoard from './CuratorBoard'

export const dynamic = 'force-dynamic'

export default async function ProjectsPage() {
  const supabase = createClient()
  const { data } = await supabase
    .from('tone_presets')
    .select('key, label, description')
    .eq('is_active', true)
    .order('key')

  return (
    <div className="min-h-screen bg-black">
      <DashboardNav />
      <main className="mx-auto max-w-[1200px] px-6 py-10">
        <h1 className="mb-8 text-[28px] font-semibold text-white">Curator</h1>
        <CuratorBoard tonePresets={data ?? []} />
      </main>
    </div>
  )
}
