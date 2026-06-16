import { describe, it, expect, vi, beforeEach } from 'vitest'

// Supabase chain builder — supports both project source lookup and queue update.
function makeChain({
  sourceUrl,
  updateRows,
}: {
  sourceUrl?: string | null
  updateRows: unknown[]
}) {
  const chain: Record<string, unknown> = {}
  let afterUpdate = false

  // Ownership lookup always returns an owned project; source_url may be null.
  const lookupResult = () => Promise.resolve({
    data: { source_url: sourceUrl ?? null },
    error: null,
  })

  chain.eq = () => chain
  chain.not = () => chain
  chain.or = () => chain
  chain.single = lookupResult
  chain.select = () => {
    if (afterUpdate) return Promise.resolve({ data: updateRows, error: null })
    return chain
  }
  chain.update = () => { afterUpdate = true; return chain }
  chain.insert = () => chain
  chain.delete = () => chain
  chain.in = () => chain
  chain.order = () => chain
  chain.from = () => chain
  chain.auth = {
    getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }),
  }
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
    mockCreateClient.mockReturnValue(makeChain({ updateRows: [] }))
    const { POST } = await import('@/app/api/import/route')
    const res = await POST(makeRequest({ url: 'https://example.com' }))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/required/)
  })

  it('422 when url is missing and project has no source URL', async () => {
    mockCreateClient.mockReturnValue(makeChain({ sourceUrl: null, updateRows: [] }))
    const { POST } = await import('@/app/api/import/route')
    const res = await POST(makeRequest({ project_id: 'proj-1' }))
    expect(res.status).toBe(422)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('project has no source URL')
  })

  it('202 when url is missing but project source URL can be queued', async () => {
    mockCreateClient.mockReturnValue(makeChain({
      sourceUrl: 'https://youtube.com/watch?v=abcdefghijk',
      updateRows: [{ id: 'proj-1' }],
    }))
    const { POST } = await import('@/app/api/import/route')
    const res = await POST(makeRequest({ project_id: 'proj-1' }))
    expect(res.status).toBe(202)
    const body = await res.json() as { queued: boolean }
    expect(body.queued).toBe(true)
  })

  it('409 when project is already processing — regression for Bug 4', async () => {
    // .not('import_status','eq','processing').select() returns empty rows
    // → means the UPDATE was blocked → project was processing
    mockCreateClient.mockReturnValue(makeChain({ updateRows: [] }))
    const { POST } = await import('@/app/api/import/route')
    const res = await POST(makeRequest({ project_id: 'proj-1', url: 'https://example.com' }))
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('already processing')
  })

  it('202 when project can be queued', async () => {
    // UPDATE succeeds → data has one row
    mockCreateClient.mockReturnValue(makeChain({ updateRows: [{ id: 'proj-1' }] }))
    const { POST } = await import('@/app/api/import/route')
    const res = await POST(makeRequest({ project_id: 'proj-1', url: 'https://example.com' }))
    expect(res.status).toBe(202)
    const body = await res.json() as { queued: boolean }
    expect(body.queued).toBe(true)
  })
})
