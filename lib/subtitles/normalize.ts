export interface TimedText {
  text: string
  start_sec: number
  end_sec: number
}

export function extendFinalSegmentToClipEnd<T extends TimedText>(
  segments: T[],
  clipEndSec: number,
): T[] {
  if (segments.length === 0) return segments

  const lastIndex = segments.length - 1
  return segments.map((segment, index) => {
    if (index !== lastIndex) return segment
    return {
      ...segment,
      end_sec: Math.max(segment.end_sec, clipEndSec, segment.start_sec + 0.1),
    }
  })
}
