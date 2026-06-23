import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSignInWithPassword = vi.fn()
const mockCreateClient = vi.fn(() => ({
  auth: {
    signInWithPassword: mockSignInWithPassword,
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockCreateClient(),
}))

function makeRequest(body: unknown) {
  return { json: async () => body } as unknown as Parameters<
    (typeof import('@/app/api/auth/login/route'))['POST']
  >[0]
}

function makeInvalidJsonRequest() {
  return { json: async () => { throw new Error('bad json') } } as unknown as Parameters<
    (typeof import('@/app/api/auth/login/route'))['POST']
  >[0]
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('400 when JSON is invalid', async () => {
    const { POST } = await import('@/app/api/auth/login/route')
    const res = await POST(makeInvalidJsonRequest())

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Invalid JSON body' })
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it('400 when payload is invalid', async () => {
    const { POST } = await import('@/app/api/auth/login/route')
    const res = await POST(makeRequest({ email: 'bad-email', password: '' }))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'email and password are required' })
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it('returns Supabase auth errors without changing the message', async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: 'Invalid login credentials', status: 400 },
    })

    const { POST } = await import('@/app/api/auth/login/route')
    const res = await POST(makeRequest({ email: 'user@example.com', password: 'secret' }))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Invalid login credentials' })
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'secret',
    })
  })

  it('502 when Supabase Auth cannot be reached', async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: 'fetch failed', status: undefined },
    })

    const { POST } = await import('@/app/api/auth/login/route')
    const res = await POST(makeRequest({ email: 'user@example.com', password: 'secret' }))

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({
      error: 'Unable to reach Supabase Auth. Check Supabase URL/key and network access.',
    })
  })

  it('200 when login succeeds', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null })

    const { POST } = await import('@/app/api/auth/login/route')
    const res = await POST(makeRequest({ email: 'user@example.com', password: 'secret' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
  })
})
