import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '(not set)'
  const hasAnonKey = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

  try {
    const supabase = createClient()
    const { data, error, count } = await supabase
      .from('projects')
      .select('id, song_title, import_status', { count: 'exact' })

    return NextResponse.json({
      supabase_url: supabaseUrl,
      has_anon_key: hasAnonKey,
      project_count: count ?? data?.length ?? 0,
      projects: data ?? [],
      error: error?.message ?? null,
    })
  } catch (err) {
    return NextResponse.json({
      supabase_url: supabaseUrl,
      has_anon_key: hasAnonKey,
      project_count: -1,
      projects: [],
      error: err instanceof Error ? err.message : 'unknown error',
    })
  }
}
