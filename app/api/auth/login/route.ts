import { NextRequest, NextResponse } from 'next/server'
import { loginRequestSchema } from '@/lib/api/request-schemas'
import { createClient } from '@/lib/supabase/server'

function authErrorStatus(status: number | undefined): number {
  if (!status || status < 400 || status >= 500) return 401
  return status
}

function isFetchFailure(message: string): boolean {
  return /failed to fetch|fetch failed|network/i.test(message)
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = loginRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 })
  }

  const supabase = createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    const message = error.message
    if (isFetchFailure(message)) {
      return NextResponse.json(
        { error: 'Unable to reach Supabase Auth. Check Supabase URL/key and network access.' },
        { status: 502 },
      )
    }
    return NextResponse.json(
      { error: message },
      { status: authErrorStatus(error.status) },
    )
  }

  return NextResponse.json({ ok: true })
}
