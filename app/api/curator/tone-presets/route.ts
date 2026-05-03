import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('tone_presets')
    .select('key, label, description')
    .eq('is_active', true)
    .order('key', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ presets: data ?? [] })
}
