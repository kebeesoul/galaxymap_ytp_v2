import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RecommendResponseSchema } from '@/lib/llm/types'

const mockGenerateContent = vi.fn()

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContent: mockGenerateContent,
    }
  },
}))

describe('Gemini structured output', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
  })

  it('uses Gemini 2.5 Flash Lite and preserves the three curator roles', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        recommendations: [
          {
            artist: 'Artist A',
            song_title: 'Song A',
            reason: 'Popular choice',
            role: 'popular',
            popularity_estimate: 9,
          },
          {
            artist: 'Artist B',
            song_title: 'Song B',
            reason: 'Reliable choice',
            role: 'reliable',
            popularity_estimate: 7,
          },
          {
            artist: 'Artist C',
            song_title: 'Song C',
            reason: 'Wildcard choice',
            role: 'wildcard',
            popularity_estimate: 4,
          },
        ],
      }),
    })

    const { GEMINI_MODEL, generateJson } = await import('@/lib/llm/gemini')
    const result = await generateJson('recommend tracks', RecommendResponseSchema, 0.9)

    expect(GEMINI_MODEL).toBe('gemini-2.5-flash-lite')
    expect(result.recommendations.map((item) => item.role)).toEqual([
      'popular',
      'reliable',
      'wildcard',
    ])
    expect(mockGenerateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-2.5-flash-lite',
      config: expect.objectContaining({
        temperature: 0.9,
        responseMimeType: 'application/json',
        responseJsonSchema: expect.any(Object),
      }),
    }))
  })

  it('rejects a Gemini response that violates the runtime schema', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ recommendations: [] }),
    })

    const { generateJson } = await import('@/lib/llm/gemini')

    await expect(
      generateJson('recommend tracks', RecommendResponseSchema),
    ).rejects.toThrow()
  })

  it('rejects a three-item response with duplicate curator roles', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        recommendations: [
          {
            artist: 'Artist A',
            song_title: 'Song A',
            reason: 'First choice',
            role: 'popular',
            popularity_estimate: 9,
          },
          {
            artist: 'Artist B',
            song_title: 'Song B',
            reason: 'Second choice',
            role: 'popular',
            popularity_estimate: 8,
          },
          {
            artist: 'Artist C',
            song_title: 'Song C',
            reason: 'Third choice',
            role: 'wildcard',
            popularity_estimate: 4,
          },
        ],
      }),
    })

    const { generateJson } = await import('@/lib/llm/gemini')

    await expect(
      generateJson('recommend tracks', RecommendResponseSchema),
    ).rejects.toThrow(/popular, reliable, and wildcard/)
  })
})
