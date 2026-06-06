import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(() => ({ role: 'service' })),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: mockCreateClient,
}))

describe('createServiceRoleClient', () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const originalServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRole
    vi.clearAllMocks()
  })

  it('requires the service-role key and never falls back to the anon key', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'

    const { createServiceRoleClient } = await import('@/lib/supabase/service-role')

    expect(() => createServiceRoleClient()).toThrow('SUPABASE_SERVICE_ROLE_KEY')
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it('creates a stateless client with the service-role key', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

    const { createServiceRoleClient } = await import('@/lib/supabase/service-role')
    createServiceRoleClient()

    expect(mockCreateClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'service-role-key',
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    )
  })
})
