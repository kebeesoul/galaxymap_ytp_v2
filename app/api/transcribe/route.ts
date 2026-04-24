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

  // 4. transcribe_status = 'pending'
  await supabase
    .from('clips')
    .update({ transcribe_status: 'pending' })
    .eq('id', clip_id)

  try {
    // 5. Replicate 호출 (60s timeout)
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })

    const replicatePromise = replicate.run('vaibhavs10/incredibly-fast-whisper', {
      input: {
        audio: signed.signedUrl,
        language: 'korean',
        word_timestamps: true,
        task: 'transcribe',
      },
    })

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Replicate timeout (180s)')), 180_000)
    )

    const output = (await Promise.race([replicatePromise, timeoutPromise])) as ReplicateOutput

    // 6. 결과 파싱 (클립 구간 내 segments만)
    const rows = parseSegments(output, clip_id, Number(clip.start_sec), Number(clip.end_sec))

    if (rows.length === 0) {
      throw new Error('Replicate returned no segments')
    }

    // 7. 기존 segments 삭제 후 재삽입
    await supabase.from('lyrics_segments').delete().eq('clip_id', clip_id)

    const { data: segments, error: insertError } = await supabase
      .from('lyrics_segments')
      .insert(rows)
      .select()

    if (insertError) throw new Error(insertError.message)

    // 8. transcribe_status = 'success'
    await supabase
      .from('clips')
      .update({ transcribe_status: 'success' })
      .eq('id', clip_id)

    return NextResponse.json({ segments })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Transcription failed'

    await supabase
      .from('clips')
      .update({ transcribe_status: 'failed' })
      .eq('id', clip_id)

    return NextResponse.json({ error: message }, { status: 502 })
  }
}
