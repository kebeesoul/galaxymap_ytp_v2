import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { createClient } from '@/lib/supabase/server'

interface TranscribeBody {
  clip_id: string
}

interface ReplicateWord {
  word: string
  start: number
  end: number
  score?: number
}

interface ReplicateSegment {
  text: string
  start: number
  end: number
  words?: ReplicateWord[]
}

interface ReplicateOutput {
  text?: string
  segments?: ReplicateSegment[]
}

interface LyricsRow {
  clip_id: string
  text: string
  start_sec: number
  end_sec: number
  order?: number
}

async function persistSegments(
  supabase: ReturnType<typeof createClient>,
  rows: LyricsRow[],
  clipId: string,
): Promise<NextResponse | null> {
  const { data: segments, error } = await supabase
    .from('lyrics_segments').insert(rows).select()
  if (error || !segments) return null
  await supabase.from('lyrics_segments').delete()
    .eq('clip_id', clipId).not('id', 'in', `(${segments.map(s => s.id).join(',')})`)
  await supabase.from('clips').update({ transcribe_status: 'success' }).eq('id', clipId)
  return NextResponse.json({ segments })
}

function parseSegments(
  output: ReplicateOutput,
  clipId: string,
  clipStart: number,
  clipEnd: number
): LyricsRow[] {
  const rows: LyricsRow[] = []

  for (const seg of output.segments ?? []) {
    if (seg.words && seg.words.length > 0) {
      for (const w of seg.words) {
        const text = w.word.trim()
        if (!text) continue
        if (w.start < clipStart || w.end > clipEnd) continue
        rows.push({ clip_id: clipId, text, start_sec: w.start, end_sec: w.end })
      }
    } else {
      const text = seg.text.trim()
      if (!text) continue
      if (seg.start < clipStart || seg.end > clipEnd) continue
      rows.push({ clip_id: clipId, text, start_sec: seg.start, end_sec: seg.end })
    }
  }

  return rows
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as TranscribeBody
  const { clip_id } = body

  if (!clip_id) {
    return NextResponse.json({ error: 'clip_id is required' }, { status: 400 })
  }

  const supabase = createClient()

  // 1. clips 조회
  const { data: clip, error: clipError } = await supabase
    .from('clips')
    .select('id, project_id, start_sec, end_sec')
    .eq('id', clip_id)
    .single()

  if (clipError || !clip) {
    return NextResponse.json({ error: 'clip not found' }, { status: 404 })
  }

  // 2. projects에서 yt_source_path 조회
  const { data: project, error: projError } = await supabase
    .from('projects')
    .select('yt_source_path')
    .eq('id', clip.project_id ?? '')
    .single()

  if (projError || !project?.yt_source_path) {
    return NextResponse.json({ error: 'preview video not found' }, { status: 404 })
  }

  // 3. Supabase Storage signed URL 생성
  const { data: signed } = await supabase.storage
    .from('sources')
    .createSignedUrl(project.yt_source_path, 3600)

  if (!signed?.signedUrl) {
    return NextResponse.json({ error: 'failed to generate signed URL' }, { status: 500 })
  }

  // 4. transcribe_status = 'pending' — skip if already a pending/success (idempotent guard)
  await supabase
    .from('clips')
    .update({ transcribe_status: 'pending' })
    .eq('id', clip_id)
    .not('transcribe_status', 'eq', 'pending')

  // C4: try local WhisperX worker first (no API cost, better accuracy)
  const whisperWorkerUrl = process.env.WHISPER_WORKER_URL
  if (whisperWorkerUrl) {
    try {
      const workerRes = await fetch(`${whisperWorkerUrl}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clip_id,
          source_url: signed.signedUrl,
          start_sec: Number(clip.start_sec),
          end_sec: Number(clip.end_sec),
          language: 'ko',
        }),
        signal: AbortSignal.timeout(300_000),
      })
      if (workerRes.ok) {
        const body = (await workerRes.json()) as {
          segments?: Array<{ text: string; start_sec: number; end_sec: number }>
        }
        const segs = body.segments ?? []
        if (segs.length > 0) {
          const rows: LyricsRow[] = segs.map((s, idx) => ({
            clip_id,
            text: s.text,
            start_sec: s.start_sec,
            end_sec: s.end_sec,
            order: idx,
          }))
          const result = await persistSegments(supabase, rows, clip_id)
          if (result) return result
        }
      }
    } catch {
      // WhisperX worker unavailable — fall through to ingest worker / Replicate
    }
  }

  // A6: try Python ingest worker — it trims audio to clip range before calling Replicate
  const workerUrl = process.env.INGEST_WORKER_URL ?? process.env.PYTHON_WORKER_URL
  if (workerUrl) {
    try {
      const workerRes = await fetch(`${workerUrl}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clip_id,
          source_url: signed.signedUrl,
          start_sec: Number(clip.start_sec),
          end_sec: Number(clip.end_sec),
          language: 'ko',
        }),
        signal: AbortSignal.timeout(180_000),
      })
      if (workerRes.ok) {
        const workerBody = (await workerRes.json()) as {
          segments?: Array<{ text: string; start_sec: number; end_sec: number }>
        }
        const workerSegs = workerBody.segments ?? []
        if (workerSegs.length > 0) {
          const rows: LyricsRow[] = workerSegs.map((s, idx) => ({
            clip_id,
            text: s.text,
            start_sec: s.start_sec,
            end_sec: s.end_sec,
            order: idx,
          }))
          const result = await persistSegments(supabase, rows, clip_id)
          if (result) return result
        }
      }
    } catch {
      // Worker unavailable or failed — fall through to Replicate
    }
  }

  try {
    // 5. Replicate 호출 (180s timeout) — sends full video URL (fallback when no worker)
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })

    const replicatePromise = replicate.run('openai/whisper', {
      input: {
        audio: signed.signedUrl,
        language: 'korean',
        word_timestamps: true,
        transcription: 'plain text',
        task: 'transcribe',
      },
    })

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Replicate timeout (180s)')), 180_000)
    )

    const output = (await Promise.race([replicatePromise, timeoutPromise])) as ReplicateOutput

    // 6. 결과 파싱 (클립 구간 내 segments만) — add order index
    const rows = parseSegments(output, clip_id, Number(clip.start_sec), Number(clip.end_sec))
      .map((r, idx) => ({ ...r, order: idx }))

    if (rows.length === 0) {
      throw new Error('Replicate returned no segments')
    }

    const result = await persistSegments(supabase, rows, clip_id)
    if (!result) throw new Error('Failed to persist segments')
    return result
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Transcription failed'

    await supabase
      .from('clips')
      .update({ transcribe_status: 'failed' })
      .eq('id', clip_id)

    return NextResponse.json({ error: message }, { status: 502 })
  }
}
