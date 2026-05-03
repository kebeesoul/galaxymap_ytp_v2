import { generateJson } from '@/lib/llm/anthropic'
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
- 사실 중심 (검증 불가능한 클레임 금지)
- 미사여구 금지
- 객관적 톤
- 응답 JSON 형식: { "text": "메모 내용" }`

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
