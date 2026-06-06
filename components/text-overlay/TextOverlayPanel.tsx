'use client'

import {
  FONT_KEYS,
  FONT_REGISTRY,
  getFontFamily,
} from '@/lib/fonts'
import {
  TEXT_OVERLAY_ALIGNS,
  TEXT_OVERLAY_EFFECTS,
  TEXT_OVERLAY_ZONES,
  type TextOverlay,
} from '@/lib/text-overlays'

const COLORS = ['#ffffff', '#000000', '#2997ff', '#ff375f', '#ffd60a', '#30d158']

interface Props {
  overlays: TextOverlay[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd: () => void
  onDelete: (id: string) => void
  onChange: (overlay: TextOverlay) => void
}

export default function TextOverlayPanel({
  overlays,
  selectedId,
  onSelect,
  onAdd,
  onDelete,
  onChange,
}: Props) {
  const selected = overlays.find((overlay) => overlay.id === selectedId) ?? null

  return (
    <details className="group rounded-xl bg-[#1d1d1f] md:col-start-2" open>
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-[12px] text-white/40 hover:text-white/60">
        <span className="font-semibold uppercase">자유 텍스트 ({overlays.length})</span>
        <span className="transition-transform duration-200 group-open:rotate-180">▾</span>
      </summary>
      <div className="space-y-4 px-5 pb-4">
        <div className="flex flex-wrap gap-2">
          {overlays.map((overlay, index) => (
            <button
              key={overlay.id}
              type="button"
              onClick={() => onSelect(overlay.id)}
              className={`rounded-md px-3 py-1.5 text-[12px] ${
                selectedId === overlay.id
                  ? 'bg-[#0071e3] text-white'
                  : 'bg-[#272729] text-white/60'
              }`}
            >
              {overlay.content || `Text ${index + 1}`}
            </button>
          ))}
          <button
            type="button"
            onClick={onAdd}
            className="rounded-md bg-[#272729] px-3 py-1.5 text-[12px] text-[#2997ff]"
          >
            + Text
          </button>
        </div>

        {selected && (
          <>
            <textarea
              value={selected.content}
              onChange={(event) => onChange({ ...selected, content: event.target.value })}
              rows={2}
              className="w-full resize-none rounded-lg bg-[#272729] px-3 py-2 text-[14px] text-white outline-none ring-2 ring-transparent focus:ring-[#0071e3]"
            />

            <SegmentedControl
              values={TEXT_OVERLAY_ZONES}
              value={selected.zone}
              labels={{ top: '상단', bottom: '하단' }}
              onChange={(zone) => onChange({ ...selected, zone })}
            />

            <div>
              <p className="mb-1.5 text-[11px] text-white/30">폰트</p>
              <div className="grid grid-cols-3 gap-1.5">
                {FONT_KEYS.map((fontKey) => (
                  <button
                    key={fontKey}
                    type="button"
                    onClick={() => onChange({ ...selected, font_key: fontKey })}
                    style={{
                      fontFamily: getFontFamily(fontKey),
                      fontWeight: FONT_REGISTRY[fontKey].weight,
                    }}
                    className={`rounded-md py-2 text-[12px] ${
                      selected.font_key === fontKey
                        ? 'bg-[#0071e3] text-white'
                        : 'bg-[#272729] text-white/60'
                    }`}
                  >
                    {FONT_REGISTRY[fontKey].label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] text-white/30">
                크기 <span className="text-white">{Math.round(selected.size * 100)}%</span>
              </p>
              <input
                type="range"
                min={0.02}
                max={0.12}
                step={0.005}
                value={selected.size}
                onChange={(event) => onChange({ ...selected, size: Number(event.target.value) })}
                className="w-full accent-[#0071e3]"
              />
            </div>

            <div>
              <p className="mb-1.5 text-[11px] text-white/30">색상</p>
              <div className="flex gap-2">
                {COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={color}
                    onClick={() => onChange({ ...selected, color })}
                    className={`h-7 w-7 rounded-full border-2 ${
                      selected.color === color ? 'border-[#2997ff]' : 'border-white/20'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
                <input
                  type="color"
                  value={selected.color}
                  onChange={(event) => onChange({ ...selected, color: event.target.value })}
                  className="h-7 w-9 cursor-pointer bg-transparent"
                />
              </div>
            </div>

            <SegmentedControl
              values={TEXT_OVERLAY_ALIGNS}
              value={selected.align}
              labels={{ left: '좌', center: '중앙', right: '우' }}
              onChange={(align) => onChange({ ...selected, align })}
            />

            <SegmentedControl
              values={TEXT_OVERLAY_EFFECTS}
              value={selected.effect}
              labels={{ none: '없음', shadow: '그림자', outline: '외곽선' }}
              onChange={(effect) => onChange({ ...selected, effect })}
            />

            <button
              type="button"
              onClick={() => onDelete(selected.id)}
              className="text-[12px] text-red-400 hover:text-red-300"
            >
              Delete
            </button>
          </>
        )}
      </div>
    </details>
  )
}

function SegmentedControl<T extends string>({
  values,
  value,
  labels,
  onChange,
}: {
  values: readonly T[]
  value: T
  labels: Record<T, string>
  onChange: (value: T) => void
}) {
  return (
    <div className="flex gap-1">
      {values.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onChange(item)}
          className={`flex-1 rounded-md py-1.5 text-[12px] ${
            value === item ? 'bg-[#0071e3] text-white' : 'bg-[#272729] text-white/50'
          }`}
        >
          {labels[item]}
        </button>
      ))}
    </div>
  )
}
