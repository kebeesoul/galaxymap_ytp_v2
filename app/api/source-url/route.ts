import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createLocalSourcePlaybackUrl } from '@/lib/source-storage'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  project_id: z.string().uuid(),
})

export async function GET(request: Request) {
  const parsed = QuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid project_id' }, { status: 400 })
  }

  const supabase = createClient()
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('owner_uid, yt_source_path')
    .eq('id', parsed.data.project_id)
    .single()

  if (projectError || !project?.yt_source_path) {
    return NextResponse.json({ error: 'Project source is not available' }, { status: 404 })
  }

  const ownedPrefix = `${authData.user.id}/`
  if (project.owner_uid !== authData.user.id || !project.yt_source_path.startsWith(ownedPrefix)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json({ url: createLocalSourcePlaybackUrl(parsed.data.project_id) })
}
