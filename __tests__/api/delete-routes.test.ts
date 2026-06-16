import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCreateClient = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}))

function makeProjectDeleteClient() {
  const removed: Record<string, string[][]> = { sources: [], renders: [] }

  const client = {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }),
    },
    from(table: string) {
      if (table === 'projects') {
        const projectSingle = {
          single: () => Promise.resolve({
            data: { id: 'project-1', yt_source_path: 'preview/video.mp4' },
            error: null,
          }),
        }
        // eq is chainable: .eq('id').eq('owner_uid').single()
        const projectEq: { eq: () => typeof projectEq; single: typeof projectSingle.single } = {
          eq: () => projectEq,
          single: projectSingle.single,
        }
        const deleteEq = {
          eq: () => deleteEq,
          then: <T>(resolve: (v: { error: null }) => T) => Promise.resolve(resolve({ error: null })),
        }
        return {
          select: () => projectEq,
          delete: () => deleteEq,
        }
      }
      if (table === 'clips') {
        return {
          select: () => ({
            eq: () => Promise.resolve({
              data: [{
                id: 'clip-1',
                bgm_url: 'https://example.supabase.co/storage/v1/object/sign/sources/bgm/clip-1.wav?token=abc',
                render_path: 'project-1/render01.mp4',
              }],
              error: null,
            }),
          }),
        }
      }
      if (table === 'track_recommendations') {
        return {
          update: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
    storage: {
      from(bucket: string) {
        return {
          remove: (paths: string[]) => {
            removed[bucket].push(paths)
            return Promise.resolve({ error: null })
          },
        }
      },
    },
  }

  return { client, removed }
}

function makeClipDeleteClientWithDbFailure() {
  const remove = vi.fn()
  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }),
    },
    from(table: string) {
      if (table !== 'clips') throw new Error(`unexpected table ${table}`)
      const selectEq: { eq: () => typeof selectEq; single: () => Promise<unknown> } = {
        eq: () => selectEq,
        single: () => Promise.resolve({
          data: { id: 'clip-1', bgm_url: 'https://example.supabase.co/storage/v1/object/sign/sources/bgm/clip-1.wav?token=abc', render_path: 'project-1/render01.mp4' },
          error: null,
        }),
      }
      return {
        select: () => selectEq,
        delete: () => ({
          eq: () => Promise.resolve({ error: { message: 'delete failed' } }),
        }),
      }
    },
    storage: {
      from: () => ({ remove }),
    },
    remove,
  }
}

describe('delete routes — storage cleanup regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('project delete cleans actual BGM object paths and render paths after DB delete', async () => {
    const { client, removed } = makeProjectDeleteClient()
    mockCreateClient.mockReturnValue(client)
    const { DELETE } = await import('@/app/api/projects/[id]/route')

    const res = await DELETE({} as Parameters<typeof DELETE>[0], { params: { id: 'project-1' } })

    expect(res.status).toBe(200)
    expect(removed.sources).toEqual([['preview/video.mp4', 'bgm/clip-1.wav']])
    expect(removed.renders).toEqual([['project-1/render01.mp4']])
  })

  it('clip delete does not touch storage when the DB delete fails', async () => {
    const client = makeClipDeleteClientWithDbFailure()
    mockCreateClient.mockReturnValue(client)
    const { DELETE } = await import('@/app/api/clips/[id]/route')

    const res = await DELETE({} as Parameters<typeof DELETE>[0], { params: { id: 'clip-1' } })

    expect(res.status).toBe(500)
    expect(client.remove).not.toHaveBeenCalled()
  })
})
