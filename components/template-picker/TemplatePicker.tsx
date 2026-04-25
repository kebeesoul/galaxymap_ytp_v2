'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Json, Tables } from '@/lib/supabase/types'

type Template = Tables<'templates'>

interface Props {
  clipId: string
  initialTemplateId: string | null
  templates: Template[]
}

const LAYOUT_META: Record<string, { icon: string; label: string; desc: string }> = {
  LAYOUT_A: { icon: '⊟', label: '자막 + 댓글', desc: '상단 자막 / 하단 댓글 카드' },
  LAYOUT_B: { icon: '≡', label: '자막만', desc: '자막 텍스트만 표시' },
  LAYOUT_C: { icon: '💬', label: '댓글만', desc: '댓글 카드만 표시' },
}

function getLayout(config: Json): string {
  if (
    config !== null &&
    typeof config === 'object' &&
    !Array.isArray(config) &&
    typeof config.layout === 'string'
  ) {
    return config.layout
  }
  return ''
}

export default function TemplatePicker({ clipId, initialTemplateId, templates }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(initialTemplateId)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const supabase = useMemo(() => createClient(), [])

  async function handleSelect(templateId: string) {
    if (selectedId === templateId) return
    setSaving(true)
    setSaveError(null)
    const prev = selectedId
    setSelectedId(templateId)
    const { error } = await supabase.from('clips').update({ template_id: templateId }).eq('id', clipId)
    if (error) {
      setSaveError(error.message)
      setSelectedId(prev)
    }
    setSaving(false)
  }

  return (
    <div className="rounded-xl bg-[#1d1d1f] px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgba(255,255,255,0.4)]">
          템플릿
        </h3>
        {saving && (
          <span className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white" />
        )}
        {saveError && (
          <span className="text-[12px] text-red-400">{saveError}</span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {templates.map(tmpl => {
          const layout = getLayout(tmpl.config_json)
          const meta = LAYOUT_META[layout]
          const isSelected = selectedId === tmpl.id
          return (
            <button
              key={tmpl.id}
              onClick={() => handleSelect(tmpl.id)}
              className={`rounded-xl border px-4 py-5 text-left transition-all ${
                isSelected
                  ? 'border-[#0071e3] bg-[#0071e3]/10'
                  : 'border-transparent bg-[#272729] hover:bg-[#2a2a2d]'
              }`}
            >
              <div className="mb-2 text-[22px] leading-none">{meta?.icon ?? '□'}</div>
              <p className="text-[13px] font-semibold text-white">{meta?.label ?? tmpl.name}</p>
              <p className="mt-0.5 text-[11px] text-[rgba(255,255,255,0.4)]">
                {meta?.desc ?? ''}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
