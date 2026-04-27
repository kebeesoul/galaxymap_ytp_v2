import { describe, it, expect, vi, beforeEach } from 'vitest'

// Supabase chain builder — returns configurable leaf value
function makeChain(leafValue: unknown) {
  const chain: Record<string, unknown> = {}
  const terminal = () => Promise.resolve(leafValue)
  chain.eq = () => chain
  chain.not = () => chain
  chain.or = () => chain
  chain.single = terminal
  chain.select = terminal
  chain.update = () => chain
  chain.insert = () => chain
  chain.delete = () => chain
  chain.in = () => chain
  chain.order = () => chain
  chain.from = () => chain
  return chain
}

const mockCreateClient = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}))

// Fake NextRequest — route only calls request.json()
function makeRequest(body: object) {
  return { json: async () => body } as Parameters<(typeof import('@/app/api/import/route'))['POST']>[0]
}

describe('POST /api/import — Bug 4 regression: processing guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('400 when project_id is missing', async () => {
    mockCreateClient.mockReturnValue(makeChain({ data: null, error: null }))
    const { POST } = await import('@/app/api/import/route')
    const res = await POST(makeRequest({ url: 'https://example.com' }))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/required/)
  })

  it('400 when url is missing', async () => {
    mockCreateClient.mockReturnValue(makeChain({ data: null, error: null }))
    const { POST } = await import('@/app/api/import/route')
    const res = await POST(makeRequest({ project_id: 'proj-1' }))
    expect(res.status).toBe(400)
  })

  it('409 when project is already processing — regression for Bug 4', async () => {
    // .not('import_status','eq','processing').select() returns empty rows
    // → means the UPDATE was blocked → project was processing
    mockCreateClient.mockReturnValue(makeChain({ data: [], error: null }))
    const { POST } = await import('@/app/api/import/route')
    const res = await POST(makeRequest({ project_id: 'proj-1', url: 'https://example.com' }))
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('already processing')
  })

  it('202 when project can be queued', async () => {
    // UPDATE succeeds → data has one row
    mockCreateClient.mockReturnValue(makeChain({ data: [{ id: 'proj-1' }], error: null }))
    const { POST } = await import('@/app/api/import/route')
    const res = await POST(makeRequest({ project_id: 'proj-1', url: 'https://example.com' }))
    expect(res.status).toBe(202)
    const body = await res.json() as { queued: boolean }
    expect(body.queued).toBe(true)
  })
})
