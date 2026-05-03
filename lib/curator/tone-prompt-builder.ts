interface TonePresetData {
  label: string
  description: string
  reference_text: string | null
}

/**
 * Auto-generate system prompt for tone transformation
 * based on tone_presets row data. Spec v4 Section 11.
 */
export function buildToneSystemPrompt(preset: TonePresetData): string {
  const reference = preset.reference_text?.trim() || '[참고 샘플 미작성]'

  return `다음은 '${preset.label}' 톤의 참고 샘플이다.
이 샘플의 문장 구조, 어조, 호흡, 단어 선택을 학습한 뒤,
사용자가 입력한 베이스 메모를 동일한 톤으로 변환하라.

참고 샘플:
"""
${reference}
"""

톤 특성: ${preset.description}

변환 규칙:
- artist, song_title, source_url은 절대 변경하지 말 것
- 사실 정보(연도, 장르 등)도 변경하지 말 것
- 톤만 변환할 것
- 응답은 JSON 형식: { "text": "변환된 메모" }`
}
