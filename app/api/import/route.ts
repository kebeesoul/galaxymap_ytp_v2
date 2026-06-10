import { NextRequest, NextResponse } from 'next/server'
import { importRequestSchema } from '@/lib/api/request-schemas'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = importRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const { project_id, url } = parsed.data
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

  const { data: updated } = await supabase
    .from('projects')
    .update({ import_status: 'pending', source_url: sourceUrl, import_error: null })
    .eq('id', project_id)
    .or('import_status.is.null,import_status.neq.processing')
    .select('id')

  if (!updated?.length) {
    return NextResponse.json({ error: 'already processing' }, { status: 409 })
  }

  return NextResponse.json({ queued: true }, { status: 202 })
}
