import { generateJson } from '@/lib/llm/gemini'
import {
  RecommendResponseSchema,
  ReplacementSchema,
  type Recommendation,
} from '@/lib/llm/types'
import { buildModulationPromptLines, type TopicKey, type EraKey, type GenreKey } from './modulation'

interface RecommendInput {
  topic: TopicKey
  era: EraKey
  genre: GenreKey
}

const SYSTEM_BASE = `한국 대중음악 큐레이터로서 다음 조건의 곡을 추천한다.

3곡을 다음 역할로 분리해 추천:
1. POPULAR: 이 카테고리의 대표곡, 누구나 아는 명곡 (popularity 8~10)
2. RELIABLE: 음악 팬이 인정하는 평론적 명곡, 약간 마이너 (popularity 5~7)
3. WILDCARD: 같은 카테고리의 의외의 선택, 숨은 명곡 (popularity 2~5)

조건:
- YouTube에 라이브 클립 존재 가능성 높은 곡으로
- 동일 아티스트 중복 금지
- 각 곡 reason 작성 (역할에 맞는 추천 이유)

응답 형식 (JSON):
{
  "recommendations": [
    { "artist": "...", "song_title": "...", "release_year": 2007, "genre": "...", "reason": "...", "role": "popular", "popularity_estimate": 9 },
    ... 3 entries total
  ]
}`

export async function recommendTracks(input: RecommendInput): Promise<Recommendation[]> {
  const modulationLines = buildModulationPromptLines(input.topic, input.era, input.genre)
  const prompt = `${SYSTEM_BASE}\n\n${modulationLines}`

  const response = await generateJson(prompt, RecommendResponseSchema, 0.8)
  return response.recommendations
}

interface ReplacementInput {
  topic: TopicKey
  era: EraKey
  genre: GenreKey
  failedRole: 'popular' | 'reliable' | 'wildcard'
  excludeRecommendations: Array<{ artist: string; song_title: string }>
}

export async function recommendReplacements(input: ReplacementInput): Promise<Recommendation[]> {
  const modulationLines = buildModulationPromptLines(input.topic, input.era, input.genre)
  const excluded = input.excludeRecommendations
    .map((r) => `${r.artist} - ${r.song_title}`)
    .join(', ')

  const prompt = `이전 추천에서 검색 실패한 슬롯을 보강한다.

${modulationLines}

역할: ${input.failedRole}
이전 추천 (제외): ${excluded || '없음'}

같은 역할에 맞는 곡 2개 추천. 응답 형식:
{
  "replacements": [
    { "artist": "...", "song_title": "...", "release_year": ..., "genre": "...", "reason": "...", "role": "${input.failedRole}", "popularity_estimate": ... },
    ... 2 entries
  ]
}`

  const response = await generateJson(prompt, ReplacementSchema, 0.9)
  return response.replacements
}
