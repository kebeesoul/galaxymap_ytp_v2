import { NextRequest, NextResponse } from 'next/server'
import { getIngestWorkerUrlWithFallback } from '@/lib/utils/worker'

export async function POST(request: NextRequest) {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  if (!formData.get('clip_id') || !formData.get('file')) {
    return NextResponse.json({ error: 'clip_id and file are required' }, { status: 400 })
  }

  const workerUrl = getIngestWorkerUrlWithFallback()

  try {
    const res = await fetch(`${workerUrl}/upload-bgm`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(120_000),
    })
    const data = (await res.json()) as { url?: string; path?: string; detail?: string }
    if (!res.ok) {
      return NextResponse.json({ error: data.detail ?? 'Upload failed' }, { status: res.status })
    }
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Worker unreachable'
    return NextResponse.json({ error: message }, { status: 503 })
  }
}
