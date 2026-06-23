import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  createLocalSourceReadStream,
  statLocalSourceObject,
  toWebReadable,
} from '@/lib/source-storage'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  project_id: z.string().uuid(),
})

function parseRange(rangeHeader: string | null, size: number): { start: number; end: number } | null {
  if (!rangeHeader) return null
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/)
  if (!match) return null

  const [, startRaw, endRaw] = match
  if (!startRaw && !endRaw) return null

  if (!startRaw) {
    const suffixLength = Number.parseInt(endRaw, 10)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null
    return {
      start: Math.max(size - suffixLength, 0),
      end: size - 1,
    }
  }

  const start = Number.parseInt(startRaw, 10)
  const end = endRaw ? Number.parseInt(endRaw, 10) : size - 1
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return null
  }

  return {
    start,
    end: Math.min(end, size - 1),
  }
}

export async function GET(request: Request) {
  const parsed = QuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid project_id' }, { status: 400 })
  }

  const supabase = createClient()
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('owner_uid, yt_source_path')
    .eq('id', parsed.data.project_id)
    .single()

  if (projectError || !project?.yt_source_path) {
    return NextResponse.json({ error: 'Project source is not available' }, { status: 404 })
  }

  const ownedPrefix = `${authData.user.id}/`
  if (project.owner_uid !== authData.user.id || !project.yt_source_path.startsWith(ownedPrefix)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const source = await statLocalSourceObject(project.yt_source_path)
    const range = parseRange(request.headers.get('range'), source.size)

    if (range) {
      const length = range.end - range.start + 1
      return new Response(
        toWebReadable(createLocalSourceReadStream(project.yt_source_path, range)),
        {
          status: 206,
          headers: {
            'Accept-Ranges': 'bytes',
            'Content-Length': String(length),
            'Content-Range': `bytes ${range.start}-${range.end}/${source.size}`,
            'Content-Type': 'video/mp4',
          },
        },
      )
    }

    return new Response(
      toWebReadable(createLocalSourceReadStream(project.yt_source_path)),
      {
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': String(source.size),
          'Content-Type': 'video/mp4',
        },
      },
    )
  } catch (error) {
    console.error('[source-file] local source unavailable', error)
    return NextResponse.json({ error: 'Source file is unavailable' }, { status: 404 })
  }
}
