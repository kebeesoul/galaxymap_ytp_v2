import { describe, expect, it } from 'vitest'
import { recommendationBatchSchema } from '@/lib/curator/recommendations'

const recommendations = [
  {
    artist: 'Artist A',
    song_title: 'Song A',
    release_year: 2026,
    genre: 'Pop',
    reason: '대중성이 높은 최신곡',
    role: 'popular',
    popularity_estimate: 9,
    topic: 'energy',
    era: '2020s',
  },
  {
    artist: 'Artist B',
    song_title: 'Song B',
    release_year: 2018,
    genre: 'R&B',
    reason: '안정적으로 활용할 수 있는 카탈로그',
    role: 'reliable',
    popularity_estimate: 7,
    topic: 'mood',
    era: '2010s',
  },
  {
    artist: 'Artist C',
    song_title: 'Song C',
    release_year: 2004,
    genre: 'Rock',
    reason: '예상 밖의 편집 대비를 만드는 곡',
    role: 'wildcard',
    popularity_estimate: 5,
    topic: 'contrast',
    era: '2000s',
  },
] as const

describe('recommendationBatchSchema', () => {
  it('accepts one recommendation for every required role', () => {
    expect(recommendationBatchSchema.parse({ recommendations })).toBeTruthy()
  })

  it('rejects duplicate roles', () => {
    const duplicateRoles = recommendations.map((item) => ({ ...item }))
    duplicateRoles[2].role = 'popular'
    expect(() => recommendationBatchSchema.parse({ recommendations: duplicateRoles })).toThrow()
  })
})
