import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockProjectSingle = vi.fn()
const mockCreateSignedUrl = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: mockProjectSingle,
        }),
      }),
    }),
  }),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: mockCreateSignedUrl,
      }),
    },
  }),
}))

describe('GET /api/projects/[id]/source-url', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  })

  it('returns a signed playback URL after project access is verified', async () => {
    mockProjectSingle.mockResolvedValue({
      data: { yt_source_path: 'user/sources/preview/video.mp4' },
      error: null,
    })
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://media.example/video.mp4' },
      error: null,
    })

    const { GET } = await import('@/app/api/projects/[id]/source-url/route')
    const response = await GET(new Request('http://localhost'), { params: { id: 'project-1' } })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      url: 'https://media.example/video.mp4',
    })
    expect(mockCreateSignedUrl).toHaveBeenCalledWith(
      'user/sources/preview/video.mp4',
      3600,
    )
  })

  it('does not sign a source for an inaccessible project', async () => {
    mockProjectSingle.mockResolvedValue({ data: null, error: { message: 'not found' } })

    const { GET } = await import('@/app/api/projects/[id]/source-url/route')
    const response = await GET(new Request('http://localhost'), { params: { id: 'project-1' } })

    expect(response.status).toBe(404)
    expect(mockCreateSignedUrl).not.toHaveBeenCalled()
  })
})
