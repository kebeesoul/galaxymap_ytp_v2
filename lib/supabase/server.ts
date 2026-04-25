import { createClient as _createClient } from '@supabase/supabase-js'
import type { Database } from './types'

// RLS is disabled (single-user local dev) — no cookie-based session needed
export function createClient() {
  return _createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
