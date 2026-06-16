import { NextRequest, NextResponse } from 'next/server'
import { getIngestWorkerUrlWithFallback } from '@/lib/utils/worker'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const clipId = formData.get('clip_id')
  if (!clipId || typeof clipId !== 'string' || !formData.get('file')) {
    return NextResponse.json({ error: 'clip_id and file are required' }, { status: 400 })
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify the clip belongs to the requesting user via its parent project
  const { data: clip } = await supabase
    .from('clips')
    .select('id, projects!inner(owner_uid)')
    .eq('id', clipId)
    .eq('projects.owner_uid', user.id)
    .single()

  if (!clip) {
    return NextResponse.json({ error: 'clip not found' }, { status: 404 })
  }

  let workerUrl: string
  try {
    workerUrl = getIngestWorkerUrlWithFallback()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ingest worker URL is not configured'
    return NextResponse.json({ error: message }, { status: 503 })
  }

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
