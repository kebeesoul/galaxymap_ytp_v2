import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stateful chain: tracks whether update() was called to distinguish
// .select().eq().single() (clip lookup) from .update().eq().not().select() (terminal)
function makeChain(clipExists: boolean, updateRows: unknown[]) {
  const clipResult = clipExists
    ? { data: { id: 'clip-1' }, error: null }
    : { data: null, error: { message: 'not found' } }

  let afterUpdate = false
  const chain: Record<string, (...args: unknown[]) => unknown> = {}

  chain.from   = () => chain
  chain.insert = () => chain
  chain.delete = () => chain
  chain.eq     = () => chain
  chain.not    = () => chain
  chain.in     = () => chain
  chain.order  = () => chain
  chain.single = () => Promise.resolve(clipResult)
  chain.update = () => { afterUpdate = true; return chain }
  chain.select = () => {
    if (afterUpdate) {
      // Terminal call after update() — return update result
      return Promise.resolve({ data: updateRows, error: null })
    }
    // Non-terminal — continue chain so .eq().single() can follow
    return chain
  }

  return chain
}

const mockCreateClient = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}))

function makeRequest(body: object) {
  return { json: async () => body } as Parameters<(typeof import('@/app/api/render/route'))['POST']>[0]
}

describe('POST /api/render — processing guard regression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('400 when clip_id is missing', async () => {
    mockCreateClient.mockReturnValue(makeChain(true, []))
    const { POST } = await import('@/app/api/render/route')
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it('404 when clip does not exist', async () => {
    mockCreateClient.mockReturnValue(makeChain(false, []))
    const { POST } = await import('@/app/api/render/route')
    const res = await POST(makeRequest({ clip_id: 'nonexistent' }))
    expect(res.status).toBe(404)
  })

  it('409 when clip is already processing — regression guard', async () => {
    // UPDATE blocked (processing) → .select() returns empty rows
    mockCreateClient.mockReturnValue(makeChain(true, []))
    const { POST } = await import('@/app/api/render/route')
    const res = await POST(makeRequest({ clip_id: 'clip-1' }))
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('already processing')
  })

  it('202 when clip is queued successfully', async () => {
    // UPDATE succeeds → one updated row returned
    mockCreateClient.mockReturnValue(makeChain(true, [{ id: 'clip-1' }]))
    const { POST } = await import('@/app/api/render/route')
    const res = await POST(makeRequest({ clip_id: 'clip-1' }))
    expect(res.status).toBe(202)
    const body = await res.json() as { queued: boolean }
    expect(body.queued).toBe(true)
  })
})
