import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get('project_id')
  if (!projectId) return NextResponse.json({ error: 'project_id required' }, { status: 400 })

  const supabase = createClient()
  const { data } = await supabase
    .from('projects')
    .select('import_status, import_error')
    .eq('id', projectId)
    .single()

  return NextResponse.json(data ?? {})
}
