import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface ImportBody {
  project_id: string
  url?: string
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as ImportBody
  const { project_id, url } = body

  if (!project_id) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const supabase = createClient()

  // If url not provided, look it up from the project row
  let sourceUrl = url
  if (!sourceUrl) {
    const { data: project } = await supabase
      .from('projects')
      .select('source_url')
      .eq('id', project_id)
      .single()
    sourceUrl = project?.source_url ?? undefined
  }

  if (!sourceUrl) {
    return NextResponse.json({ error: 'project has no source URL' }, { status: 422 })
  }

  const { data: updated, error: updateError } = await supabase
    .from('projects')
    .update({ import_status: 'pending', source_url: sourceUrl, import_error: null })
    .eq('id', project_id)
    .or('import_status.is.null,import_status.neq.processing')
    .select('id')

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  if (!updated?.length) {
    // Project is currently in 'processing' — force-reset to allow re-queue
    const { error: resetError } = await supabase
      .from('projects')
      .update({ import_status: 'pending', source_url: sourceUrl, import_error: null })
      .eq('id', project_id)
    if (resetError) {
      return NextResponse.json({ error: 'already processing — reset failed: ' + resetError.message }, { status: 500 })
    }
  }

  return NextResponse.json({ queued: true }, { status: 202 })
}
