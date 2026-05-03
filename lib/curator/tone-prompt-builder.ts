interface TonePresetData {
  label: string
  description: string
  reference_text: string | null
}

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
- artist, song_title은 절대 변경하지 말 것
- 베이스 메모에 있는 사실(연도, 장르, 인물, 수록 앨범 등)만 사용할 것
- 베이스 메모에 없는 새로운 사실을 추가하지 말 것 — 확인되지 않은 수상 이력, 차트 순위, 협업자 등 일체 금지
- 톤(문체·호흡·어조)만 바꿀 것, 내용 추가·삭제 금지`
}
