'use client'

import { useEffect, useRef, useState } from 'react'
import Moveable from 'react-moveable'
import { BAR_HEIGHT_PERCENT } from '@/lib/video-bars'
import {
  clampTextOverlayPosition,
  type TextOverlay,
} from '@/lib/text-overlays'

interface Props {
  containerRef: React.RefObject<HTMLDivElement>
  overlays: TextOverlay[]
  selectedId: string | null
  onSelect: (id: string) => void
  onDraft: (overlay: TextOverlay) => void
  onCommit: (overlay: TextOverlay) => void
}

export default function TextOverlayControls({
  containerRef,
  overlays,
  selectedId,
  onSelect,
  onDraft,
  onCommit,
}: Props) {
  const targetRefs = useRef(new Map<string, HTMLDivElement>())
  const interactionStartRef = useRef<TextOverlay | null>(null)
  const latestRef = useRef<TextOverlay | null>(null)
  const [selectedTarget, setSelectedTarget] = useState<HTMLDivElement | null>(null)
  const selected = overlays.find((overlay) => overlay.id === selectedId) ?? null

  useEffect(() => {
    setSelectedTarget(selectedId ? targetRefs.current.get(selectedId) ?? null : null)
  }, [selectedId, overlays])

  function update(next: TextOverlay) {
    latestRef.current = next
    onDraft(next)
  }

  function commit() {
    if (latestRef.current) onCommit(latestRef.current)
    interactionStartRef.current = null
    latestRef.current = null
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {overlays.map((overlay) => {
        const top = overlay.zone === 'top'
          ? overlay.y * BAR_HEIGHT_PERCENT
          : 100 - BAR_HEIGHT_PERCENT + overlay.y * BAR_HEIGHT_PERCENT
        const width = Math.min(80, Math.max(16, overlay.content.length * overlay.size * 55))
        return (
          <div
            key={overlay.id}
            ref={(element) => {
              if (element) targetRefs.current.set(overlay.id, element)
              else targetRefs.current.delete(overlay.id)
            }}
            role="button"
            tabIndex={0}
            aria-label={overlay.content || 'Text overlay'}
            onClick={(event) => {
              event.stopPropagation()
              onSelect(overlay.id)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onSelect(overlay.id)
            }}
            className={`pointer-events-auto absolute cursor-move border ${
              selectedId === overlay.id
                ? 'border-[#2997ff] bg-[#2997ff]/10'
                : 'border-transparent hover:border-white/40'
            }`}
            style={{
              left: `${overlay.x * 100}%`,
              top: `${top}%`,
              width: `${width}%`,
              height: `${Math.max(3, overlay.size * 100)}%`,
              transform: `translate(-50%, -50%) rotate(${overlay.rotation}deg)`,
              transformOrigin: 'center',
            }}
          />
        )
      })}

      {selected && selectedTarget && (
        <Moveable
          target={selectedTarget}
          container={containerRef.current}
          draggable
          resizable
          rotatable
          keepRatio
          origin={false}
          throttleDrag={0}
          throttleResize={0}
          throttleRotate={0}
          onDragStart={() => {
            interactionStartRef.current = selected
          }}
          onDrag={({ dist }) => {
            const container = containerRef.current
            const start = interactionStartRef.current
            if (!container || !start) return
            const rect = container.getBoundingClientRect()
            const barHeight = rect.height * BAR_HEIGHT_PERCENT / 100
            update({
              ...start,
              x: clampTextOverlayPosition(start.x + dist[0] / rect.width),
              y: clampTextOverlayPosition(start.y + dist[1] / barHeight),
            })
          }}
          onDragEnd={commit}
          onResizeStart={() => {
            interactionStartRef.current = selected
          }}
          onResize={({ height }) => {
            const container = containerRef.current
            const start = interactionStartRef.current
            if (!container || !start) return
            const containerHeight = container.getBoundingClientRect().height
            update({
              ...start,
              size: Math.min(0.12, Math.max(0.02, height / containerHeight)),
            })
          }}
          onResizeEnd={commit}
          onRotateStart={({ set }) => {
            interactionStartRef.current = selected
            set(selected.rotation)
          }}
          onRotate={({ rotation }) => {
            const start = interactionStartRef.current
            if (!start) return
            update({ ...start, rotation })
          }}
          onRotateEnd={commit}
        />
      )}
    </div>
  )
}
