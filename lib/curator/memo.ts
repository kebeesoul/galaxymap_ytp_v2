import { generateJson } from '@/lib/llm/gemini'
import { MemoSchema } from '@/lib/llm/types'
import { buildToneSystemPrompt } from './tone-prompt-builder'

interface GenerateBaseInput {
  artist: string
  song_title: string
  release_year?: number
  genre?: string
}

export async function generateBaseMemo(input: GenerateBaseInput): Promise<string> {
  const prompt = `다음 곡에 대한 큐레이션 메모를 5~7문장으로 작성하라.

곡 정보:
- artist: ${input.artist}
- song_title: ${input.song_title}
- release_year: ${input.release_year ?? '미상'}
- genre: ${input.genre ?? '미상'}

작성 규칙:
- 위 곡 정보에서 직접 도출할 수 있는 사실만 서술할 것
- 차트 순위, 수상 이력, 구체적인 앨범명, 협업자 등 확인되지 않은 사실 추가 금지
- 불확실한 내용은 "알려진", "대표적인" 등 완화 표현 사용
- 사실 중심, 미사여구 금지, 객관적 톤`

  const result = await generateJson(prompt, MemoSchema, 0.5)
  return result.text
}

interface TransformToneInput {
  base_text: string
  artist: string
  song_title: string
  preset: {
    label: string
    description: string
    reference_text: string | null
  }
}

export async function transformTone(input: TransformToneInput): Promise<string> {
  const systemPrompt = buildToneSystemPrompt(input.preset)
  const fullPrompt = `${systemPrompt}

베이스 메모:
"""
${input.base_text}
"""

곡 정보 (변경 금지):
- artist: ${input.artist}
- song_title: ${input.song_title}`

  const result = await generateJson(fullPrompt, MemoSchema, 0.7)
  return result.text
}
