import { NextResponse } from 'next/server'
import { createClient as createStorageClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const supabase = createClient()
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('yt_source_path')
    .eq('id', params.id)
    .single()

  if (projectError || !project?.yt_source_path) {
    return NextResponse.json({ error: 'Project source is not available' }, { status: 404 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json({ error: 'Supabase storage is not configured' }, { status: 503 })
  }

  // Project ownership is verified above through the authenticated RLS client.
  // Use a stateless storage client so legacy objects remain signable until R2 migration.
  const storage = createStorageClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error: signError } = await storage.storage
    .from('sources')
    .createSignedUrl(project.yt_source_path, 3600)

  if (signError || !data?.signedUrl) {
    return NextResponse.json(
      { error: signError?.message ?? 'Failed to create source URL' },
      { status: 502 },
    )
  }

  return NextResponse.json({ url: data.signedUrl })
}
