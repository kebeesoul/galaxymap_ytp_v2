import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get('project_id')
  if (!projectId) return NextResponse.json({ error: 'project_id required' }, { status: 400 })

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('projects')
    .select('import_status, import_error')
    .eq('id', projectId)
    .eq('owner_uid', user.id)
    .single()

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json(
      { error: 'Failed to fetch import status' },
      { status: 500 },
    )
  }

  return NextResponse.json(data ?? {})
}
