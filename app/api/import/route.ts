import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface ImportBody {
  project_id: string
  url: string
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as ImportBody
  const { project_id, url } = body

  if (!project_id || !url) {
    return NextResponse.json({ error: 'project_id and url are required' }, { status: 400 })
  }

  const supabase = createClient()

  const { data: updated } = await supabase
    .from('projects')
    .update({ import_status: 'pending', import_error: null })
    .eq('id', project_id)
    .not('import_status', 'eq', 'processing')
    .select('id')

  if (!updated?.length) {
    return NextResponse.json({ error: 'already processing' }, { status: 409 })
  }

  return NextResponse.json({ queued: true }, { status: 202 })
}
