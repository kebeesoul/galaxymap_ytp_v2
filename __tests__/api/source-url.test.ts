import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetUser = vi.fn()
const mockProjectSingle = vi.fn()
const mockCreateLocalSourcePlaybackUrl = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: mockProjectSingle,
        }),
      }),
    }),
  }),
}))

vi.mock('@/lib/source-storage', () => ({
  createLocalSourcePlaybackUrl: mockCreateLocalSourcePlaybackUrl,
}))

const USER_ID = '11111111-1111-4111-8111-111111111111'
const PROJECT_ID = '22222222-2222-4222-8222-222222222222'

describe('GET /api/source-url', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    })
    mockCreateLocalSourcePlaybackUrl.mockReturnValue(`/api/source-file?project_id=${PROJECT_ID}`)
  })

  it('returns a local server playback URL for an owned UID-prefixed key', async () => {
    const key = `${USER_ID}/sources/preview/video.mp4`
    mockProjectSingle.mockResolvedValue({
      data: { owner_uid: USER_ID, yt_source_path: key },
      error: null,
    })

    const { GET } = await import('@/app/api/source-url/route')
    const response = await GET(
      new Request(`http://localhost/api/source-url?project_id=${PROJECT_ID}`),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      url: `/api/source-file?project_id=${PROJECT_ID}`,
    })
    expect(mockCreateLocalSourcePlaybackUrl).toHaveBeenCalledWith(PROJECT_ID)
  })

  it('rejects a key whose UID prefix does not match the authenticated user', async () => {
    mockProjectSingle.mockResolvedValue({
      data: {
        owner_uid: USER_ID,
        yt_source_path: '33333333-3333-4333-8333-333333333333/sources/preview/video.mp4',
      },
      error: null,
    })

    const { GET } = await import('@/app/api/source-url/route')
    const response = await GET(
      new Request(`http://localhost/api/source-url?project_id=${PROJECT_ID}`),
    )

    expect(response.status).toBe(403)
    expect(mockCreateLocalSourcePlaybackUrl).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated requests', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })

    const { GET } = await import('@/app/api/source-url/route')
    const response = await GET(
      new Request(`http://localhost/api/source-url?project_id=${PROJECT_ID}`),
    )

    expect(response.status).toBe(401)
    expect(mockProjectSingle).not.toHaveBeenCalled()
  })

  it('validates project_id before querying Supabase', async () => {
    const { GET } = await import('@/app/api/source-url/route')
    const response = await GET(
      new Request('http://localhost/api/source-url?project_id=not-a-uuid'),
    )

    expect(response.status).toBe(400)
    expect(mockGetUser).not.toHaveBeenCalled()
  })
})
