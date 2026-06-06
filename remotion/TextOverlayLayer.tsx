import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { getFontFamily, getFontWeight } from '../lib/fonts'
import { BAR_HEIGHT_PERCENT } from '../lib/video-bars'
import type { TextOverlay } from '../lib/text-overlays'

interface Props {
  enabled?: boolean
  overlays?: TextOverlay[]
}

export default function TextOverlayLayer({ enabled = true, overlays = [] }: Props) {
  const frame = useCurrentFrame()
  const { fps, height } = useVideoConfig()
  const currentSec = frame / fps
  const barHeight = BAR_HEIGHT_PERCENT / 100

  if (!enabled) return null

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {overlays
        .filter((overlay) => isVisibleAt(overlay, currentSec))
        .sort((a, b) => a.z_index - b.z_index)
        .map((overlay) => {
          const zoneTop = overlay.zone === 'top' ? 0 : 1 - barHeight
          const top = (zoneTop + overlay.y * barHeight) * 100
          return (
            <div
              key={overlay.id}
              style={{
                position: 'absolute',
                left: `${overlay.x * 100}%`,
                top: `${top}%`,
                maxWidth: '92%',
                color: overlay.color,
                fontFamily: getFontFamily(overlay.font_key),
                fontWeight: getFontWeight(overlay.font_key),
                fontSize: overlay.size * height,
                lineHeight: 1.1,
                textAlign: overlay.align,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                textShadow: getTextShadow(overlay.effect),
                WebkitTextStroke: overlay.effect === 'outline'
                  ? `${Math.max(1, height * 0.0015)}px #000000`
                  : undefined,
                transform: `translate(-50%, -50%) rotate(${overlay.rotation}deg)`,
                transformOrigin: 'center',
                zIndex: overlay.z_index,
              }}
            >
              {overlay.content}
            </div>
          )
        })}
    </AbsoluteFill>
  )
}

function isVisibleAt(overlay: TextOverlay, currentSec: number): boolean {
  if (overlay.start_sec !== null && currentSec < overlay.start_sec) return false
  if (overlay.end_sec !== null && currentSec > overlay.end_sec) return false
  return true
}

function getTextShadow(effect: TextOverlay['effect']): string | undefined {
  if (effect === 'shadow') return '0 0.04em 0.12em rgba(0, 0, 0, 0.85)'
  if (effect === 'outline') {
    return '-0.02em -0.02em 0 #000, 0.02em -0.02em 0 #000, -0.02em 0.02em 0 #000, 0.02em 0.02em 0 #000'
  }
  return undefined
}
