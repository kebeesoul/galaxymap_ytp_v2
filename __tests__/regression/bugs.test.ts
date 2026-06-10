/**
 * Source-code guard tests.
 * These assert that specific bug-fixing patterns remain intact in the source.
 * Each test documents the exact symptom of the original bug so future readers
 * understand WHY the assertion exists.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const root = path.resolve(__dirname, '../..')

function read(rel: string) {
  return readFileSync(path.join(root, rel), 'utf-8')
}

describe('Bug 1 regression: lyrics_segments ordering', () => {
  /**
   * lyrics_segments table has no "order" column in the DB.
   * Using .order('order') caused PostgREST to return a 400 error, making
   * segs=null → segments never loaded → SubtitleEditor never shown after page reload.
   */
  const src = read('components/video-editor/ClipEditor.tsx')

  it('does NOT use .order("order") on lyrics_segments (non-existent DB column)', () => {
    // This query previously caused a silent 400 from PostgREST
    expect(src).not.toMatch(/lyrics_segments[^]*?\.order\(['"]order['"]/)
  })

  it('uses .order("start_sec") which exists in the DB', () => {
    expect(src).toContain(".order('start_sec'")
  })
})

describe('Bug 2 regression: handleSaveProjectLyrics error handling', () => {
  /**
   * Previously, savedLyricsRef.current and setLyricsEditOpen(false) ran unconditionally
   * even when supabase.update() failed. The user saw a success state but lyrics were
   * never persisted — silent data loss on page reload.
   */
  const src = read('components/video-editor/ClipEditor.tsx')

  it('checks error before updating savedLyricsRef', () => {
    // The error gate must appear before savedLyricsRef assignment
    const errorGateIdx = src.indexOf('if (!error)')
    const savedLyricsIdx = src.indexOf('savedLyricsRef.current = songLyrics')
    expect(errorGateIdx).toBeGreaterThan(-1)
    expect(savedLyricsIdx).toBeGreaterThan(-1)
    // The gate must come first (savedLyricsRef is inside the if block)
    expect(errorGateIdx).toBeLessThan(savedLyricsIdx)
  })

  it('does not call setLyricsEditOpen(false) before the error check', () => {
    // Find handleSaveProjectLyrics function body
    const fnStart = src.indexOf('async function handleSaveProjectLyrics()')
    const fnEnd = src.indexOf('\n  }', fnStart) + 4
    const fn = src.slice(fnStart, fnEnd)

    const errorCheckIdx = fn.indexOf('if (!error)')
    const closePanelIdx = fn.indexOf('setLyricsEditOpen(false)')
    expect(errorCheckIdx).toBeGreaterThan(-1)
    expect(closePanelIdx).toBeGreaterThan(-1)
    // setLyricsEditOpen(false) must be AFTER the error check
    expect(closePanelIdx).toBeGreaterThan(errorCheckIdx)
  })
})

describe('Bug 3 regression: handleBatchDelete loop cleanup', () => {
  /**
   * handleBatchDelete deleted clips from state but left loopingClipRef / loopingClipId
   * intact. If you batch-deleted the looping clip, the video kept seeking to the
   * deleted clip range forever.
   */
  const src = read('components/video-editor/ClipEditor.tsx')

  it('resets loopingClipRef inside handleBatchDelete', () => {
    const fnStart = src.indexOf('async function handleBatchDelete()')
    const fnEnd = src.indexOf('\n  }\n\n  async function handleBatchApplyTemplate', fnStart)
    const fn = src.slice(fnStart, fnEnd)
    expect(fn).toContain('loopingClipRef.current = null')
    expect(fn).toContain('setLoopingClipId(null)')
  })
})

describe('Bug 4 regression: import/route processing guard', () => {
  /**
   * import/route.ts had no guard against overwriting import_status='processing'.
   * Unlike render/route.ts which already had this guard, import allowed double-triggering.
   * Uses .or() to also allow queuing when status is null (new projects).
   */
  const src = read('app/api/import/route.ts')

  it('uses .or() guard to prevent overwriting processing status', () => {
    expect(src).toContain(".or('import_status.is.null,import_status.neq.processing')")
  })

  it('returns 409 when project is already processing', () => {
    expect(src).toContain('status: 409')
  })

  it('checks for updated rows before returning 202', () => {
    expect(src).toContain('updated?.length')
  })
})

describe('Bug 5 regression: duplicate dashboard navigation', () => {
  const layout = read('app/layout.tsx')
  const historyPage = read('app/history/page.tsx')
  const editorPage = read('app/editor/[id]/page.tsx')
  const editorClient = read('app/editor/[id]/EditorClient.tsx')

  it('renders AppNav only from the root layout', () => {
    expect(layout).toContain('<AppNav />')
    expect(historyPage).not.toContain('DashboardNav')
    expect(editorPage).not.toContain('DashboardNav')
  })

  it('keeps editor ingest retry and queued states intact', () => {
    expect(editorClient).toContain("label=\"재시도\"")
    expect(editorClient).toContain("'Queued…'")
    expect(editorClient).toContain("'Downloading…'")
  })
})

describe('Editor effect lifecycle regressions', () => {
  const clipEditor = read('components/video-editor/ClipEditor.tsx')
  const waveformEditor = read('components/video-editor/WaveformEditor.tsx')

  it('cleans up the polling map captured when the effect starts', () => {
    expect(clipEditor).toContain('const pollingIntervals = pollingIntervalsRef.current')
    expect(clipEditor).toContain('Object.values(pollingIntervals)')
    expect(clipEditor).not.toContain('Object.values(pollingIntervalsRef.current)')
  })

  it('rebinds the selected region when the video element changes', () => {
    expect(waveformEditor).toContain('}, [startSec, endSec, mediaEl])')
  })
})

describe('Gate 2 Lane B regression: ingest reliability feedback', () => {
  const layout = read('app/layout.tsx')
  const banner = read('components/navigation/WorkerOfflineBanner.tsx')
  const projectList = read('app/projects/ProjectList.tsx')
  const historyPanel = read('app/history/HistoryPanel.tsx')

  it('mounts one global worker health banner', () => {
    expect(layout).toContain('<WorkerOfflineBanner />')
    expect(banner).toContain(".from('worker_health')")
    expect(banner).toContain(".eq('worker_id', 'ingest')")
  })

  it('keeps failed import error and retry actions visible', () => {
    expect(projectList).toContain('importError={retryErrors[project.id] ?? project.import_error}')
    expect(projectList).toContain("retrying === project.id ? '재시도 중…' : '재시도'")
    expect(historyPanel).toContain("p.import_status === 'failed' && p.import_error")
    expect(historyPanel).toContain('handleRetryProject(p)')
  })

  it('uses deterministic KST dates to avoid hydration mismatch', () => {
    expect(historyPanel).not.toContain('toLocaleDateString')
    expect(historyPanel).toContain('getUTCHours')
  })
})
