// Phase 4 — render queue worker
// Triggers local Mac Studio render; do NOT deploy to Vercel/Edge
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { promisify } from 'util'
import { createClient } from '@/lib/supabase/server'
import type { RenderInput } from '@/remotion/types'

const execFileAsync = promisify(execFile)

export interface RenderClipParams {
  clipId: string
  input: RenderInput
}

const COMPOSITION_MAP: Record<RenderInput['layout'], string> = {
  LAYOUT_A: 'LayoutA',
  LAYOUT_B: 'LayoutB',
  LAYOUT_C: 'LayoutC',
}

export async function renderClip({
  clipId,
  input,
}: RenderClipParams): Promise<{ renderPath: string }> {
  const compositionId = COMPOSITION_MAP[input.layout]
  const propsPath = path.join(os.tmpdir(), `remotion-props-${clipId}.json`)
  const outputPath = path.join(os.tmpdir(), `render-${clipId}.mp4`)
  const remotionBin = path.join(process.cwd(), 'node_modules', '.bin', 'remotion')

  await fs.writeFile(propsPath, JSON.stringify(input), 'utf-8')

  try {
    await execFileAsync(
      remotionBin,
      [
        'render',
        'remotion/Root.tsx',
        compositionId,
        `--props=${propsPath}`,
        `--output=${outputPath}`,
        '--log=error',
        '--overwrite',
      ],
      {
        cwd: process.cwd(),
        timeout: 300_000,
      }
    )

    const mp4Buffer = await fs.readFile(outputPath)
    const storagePath = `renders/${clipId}.mp4`

    const supabase = createClient()
    const { error: uploadError } = await supabase.storage
      .from('renders')
      .upload(storagePath, mp4Buffer, { contentType: 'video/mp4', upsert: true })

    if (uploadError) throw new Error(uploadError.message)

    return { renderPath: storagePath }
  } finally {
    await Promise.allSettled([fs.unlink(propsPath), fs.unlink(outputPath)])
  }
}
