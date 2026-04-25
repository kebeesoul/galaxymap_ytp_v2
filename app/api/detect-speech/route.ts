import { NextRequest, NextResponse } from 'next/server'

interface DetectSpeechResult {
  start_sec: number
  end_sec: number
  confidence: number
}

const WORKER_URL = process.env.INGEST_WORKER_URL ?? 'http://localhost:8001'

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { project_id?: string }
  if (!body.project_id) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  try {
    const res = await fetch(`${WORKER_URL}/detect-speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: body.project_id }),
      signal: AbortSignal.timeout(90_000),
    })
    const data = (await res.json()) as DetectSpeechResult | { detail?: string }
    if (!res.ok) {
      const msg = 'detail' in data ? data.detail : 'detect-speech failed'
      return NextResponse.json({ error: msg }, { status: res.status })
    }
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Worker unreachable'
    return NextResponse.json({ error: message }, { status: 503 })
  }
}
