import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockOr = vi.fn()

function makeChain(
  clipExists: boolean,
  updateRows: unknown[],
  updateError: { message: string } | null = null,
) {
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
  chain.or     = (...args: unknown[]) => {
    mockOr(...args)
    return chain
  }
  chain.in     = () => chain
  chain.order  = () => chain
  chain.single = () => Promise.resolve(clipResult)
  chain.update = () => { afterUpdate = true; return chain }
  chain.select = () => {
    if (afterUpdate) {
      // Terminal call after update() — return update result
      return Promise.resolve({ data: updateRows, error: updateError })
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
    expect(mockOr).toHaveBeenCalledWith(
      'render_status.is.null,render_status.neq.processing',
    )
    const body = await res.json() as { error: string; render_status: string }
    expect(body.error).toBe('already processing')
    expect(body.render_status).toBe('processing')
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

  it('500 when the conditional update fails', async () => {
    mockCreateClient.mockReturnValue(
      makeChain(true, [], { message: 'database unavailable' }),
    )
    const { POST } = await import('@/app/api/render/route')
    const res = await POST(makeRequest({ clip_id: 'clip-1' }))
    expect(res.status).toBe(500)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('database unavailable')
  })
})
