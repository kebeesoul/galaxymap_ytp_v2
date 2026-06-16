import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const BodySchema = z.object({
  project_id: z.string().min(1, 'project_id is required'),
  url: z.string().optional(),
})

export async function POST(request: NextRequest) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    const projectIdIssue = parsed.error.issues.find((i) => i.path[0] === 'project_id')
    const message = projectIdIssue ? 'project_id is required' : (parsed.error.issues[0]?.message ?? 'Invalid body')
    return NextResponse.json({ error: message }, { status: 400 })
  }
  const { project_id, url } = parsed.data

  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify the project belongs to the requesting user
  const { data: owned } = await supabase
    .from('projects')
    .select('source_url')
    .eq('id', project_id)
    .eq('owner_uid', user.id)
    .single()

  if (!owned) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 })
  }

  // If url not provided, look it up from the project row
  let sourceUrl = url
  if (!sourceUrl) {
    sourceUrl = owned.source_url ?? undefined
  }

  if (!sourceUrl) {
    return NextResponse.json({ error: 'project has no source URL' }, { status: 422 })
  }

  const { data: updated } = await supabase
    .from('projects')
    .update({ import_status: 'pending', source_url: sourceUrl, import_error: null })
    .eq('id', project_id)
    .eq('owner_uid', user.id)
    .or('import_status.is.null,import_status.neq.processing')
    .select('id')

  if (!updated?.length) {
    return NextResponse.json({ error: 'already processing' }, { status: 409 })
  }

  return NextResponse.json({ queued: true }, { status: 202 })
}
