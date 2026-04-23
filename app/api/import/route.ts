import { NextRequest, NextResponse } from 'next/server'
import axios, { isAxiosError } from 'axios'
import { createClient } from '@/lib/supabase/server'

interface ImportBody {
  project_id: string
  url: string
}

interface WorkerResponse {
  video_id: string
  title: string
  duration_sec: number
  thumbnail_url: string
  preview_path: string
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as ImportBody
  const { project_id, url } = body

  if (!project_id || !url) {
    return NextResponse.json({ error: 'project_id and url are required' }, { status: 400 })
  }

  const supabase = createClient()

  await supabase
    .from('projects')
    .update({ import_status: 'pending', import_error: null })
    .eq('id', project_id)

  try {
    const workerUrl = process.env.PYTHON_WORKER_URL ?? 'http://localhost:8001'
    const { data } = await axios.post<WorkerResponse>(
      `${workerUrl}/ingest`,
      { url },
      { timeout: 120_000 }
    )

    const { data: project, error } = await supabase
      .from('projects')
      .update({
        import_status: 'success',
        yt_video_id: data.video_id,
        yt_title: data.title,
        yt_duration_sec: data.duration_sec,
        yt_thumbnail_url: data.thumbnail_url,
        yt_source_path: data.preview_path,
        import_error: null,
      })
      .eq('id', project_id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(project)
  } catch (err: unknown) {
    let message = 'Import failed'
    if (isAxiosError(err)) {
      const detail = (err.response?.data as { detail?: string } | undefined)?.detail
      message = detail ?? err.message
    } else if (err instanceof Error) {
      message = err.message
    }

    await supabase
      .from('projects')
      .update({ import_status: 'failed', import_error: message })
      .eq('id', project_id)

    return NextResponse.json({ error: message }, { status: 502 })
  }
}
