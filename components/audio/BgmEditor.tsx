'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/plugins/regions'
import { createClient } from '@/lib/supabase/client'

interface BgmState {
  bgm_url: string | null
  bgm_volume: number    // 0~1
  original_volume: number  // 0~1
  bgm_start_sec: number
}

interface Props {
  clipId: string
  clipDuration: number
  initialBgmUrl: string | null
  initialBgmVolume: number       // 0~1 from DB
  initialOriginalVolume: number  // 0~1 from DB
  initialBgmStartSec?: number
  onSave?: (state: BgmState) => void
  onVolumeChange?: (state: { bgm_volume: number; original_volume: number }) => void
}

export default function BgmEditor({
  clipId,
  clipDuration,
  initialBgmUrl,
  initialBgmVolume,
  initialOriginalVolume,
  initialBgmStartSec = 0,
  onSave,
  onVolumeChange,
}: Props) {
  const [bgmUrl, setBgmUrl] = useState(initialBgmUrl ?? '')
  // Display as 0-100 integers; DB stores 0-1
  const [bgmVol, setBgmVol] = useState(Math.round(initialBgmVolume * 100))
  const [origVol, setOrigVol] = useState(Math.round(initialOriginalVolume * 100))
  const [bgmStartSec, setBgmStartSec] = useState(initialBgmStartSec)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const waveContainerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const supabase = useMemo(() => createClient(), [])

  // Build/rebuild WaveSurfer whenever the BGM URL changes
  useEffect(() => {
    if (!bgmUrl || !waveContainerRef.current) {
      wsRef.current?.destroy()
      wsRef.current = null
      return
    }

    wsRef.current?.destroy()

    const regionsPlugin = RegionsPlugin.create()
    const ws = WaveSurfer.create({
      container: waveContainerRef.current,
      waveColor: 'rgba(255,255,255,0.22)',
      progressColor: 'rgba(0,113,227,0.55)',
      height: 52,
      interact: false,
      plugins: [regionsPlugin],
    })

    ws.load(bgmUrl)

    ws.on('ready', () => {
      const start = Math.min(bgmStartSec, Math.max(0, ws.getDuration() - clipDuration))
      regionsPlugin.addRegion({
        start,
        end: start + clipDuration,
        drag: true,
        resize: false,
        color: 'rgba(0,113,227,0.22)',
      })
    })

    regionsPlugin.on('region-updated', (region) => {
      const clamped = Math.max(0, region.start)
      setBgmStartSec(clamped)
    })

    wsRef.current = ws
    return () => {
      ws.destroy()
      wsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgmUrl])

  async function handleUpload(file: File) {
    setUploading(true)
    setUploadError(null)
    try {
      const form = new FormData()
      form.append('clip_id', clipId)
      form.append('file', file)
      const res = await fetch('/api/upload-bgm', { method: 'POST', body: form })
      const data = (await res.json()) as { url?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? '업로드 실패')
      setBgmUrl(data.url ?? '')
      setBgmStartSec(0)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '업로드 실패')
    } finally {
      setUploading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    const payload = {
      bgm_url: bgmUrl.trim() || null,
      bgm_volume: bgmVol / 100,
      original_volume: origVol / 100,
      bgm_start_sec: bgmStartSec,
    }
    const { error } = await supabase.from('clips').update(payload).eq('id', clipId)
    if (error) {
      setSaveError(error.message)
    } else {
      onSave?.(payload)
    }
    setSaving(false)
  }

  return (
    <details className="group rounded-xl bg-[#1d1d1f]" open>
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-[12px] text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.6)]">
        <span className="font-semibold uppercase tracking-[0.08em]">BGM</span>
        <span className="transition-transform duration-200 group-open:rotate-180">▾</span>
      </summary>

      <div className="px-5 pb-4">
        {/* Save button */}
        <div className="mb-3 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-[#0071e3] px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-[#0077ed] disabled:opacity-30"
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>

        {/* URL input + file upload */}
        <div className="mb-4 flex gap-2">
          <input
            value={bgmUrl}
            onChange={e => setBgmUrl(e.target.value)}
            placeholder="BGM URL (https://…) 또는 파일 업로드"
            className="min-w-0 flex-1 rounded-lg bg-[#272729] px-3 py-2 text-[13px] text-white outline-none placeholder:text-[rgba(255,255,255,0.2)] focus:ring-1 focus:ring-[#0071e3]"
          />
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) void handleUpload(file)
              e.target.value = ''
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="shrink-0 rounded-lg bg-[#272729] px-3 py-2 text-[13px] text-white transition-colors hover:bg-[#2a2a2d] disabled:opacity-40"
          >
            {uploading ? (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white" />
            ) : (
              '파일 업로드'
            )}
          </button>
        </div>

        {uploadError && <p className="mb-3 text-[12px] text-red-400">{uploadError}</p>}

        {/* BGM waveform + region selector */}
        {bgmUrl && (
          <div className="mb-4">
            <div
              ref={waveContainerRef}
              className="overflow-hidden rounded-lg bg-[#111]"
            />
            <p className="mt-1 text-right font-mono text-[11px] text-[rgba(255,255,255,0.4)]">
              시작: {bgmStartSec.toFixed(1)}s
            </p>
          </div>
        )}

        {/* Volume sliders */}
        <div className="space-y-3">
          <VolumeSlider
            label="원본 볼륨"
            value={origVol}
            onChange={v => {
              setOrigVol(v)
              onVolumeChange?.({ bgm_volume: bgmVol / 100, original_volume: v / 100 })
            }}
          />
          <VolumeSlider
            label="BGM 볼륨"
            value={bgmVol}
            onChange={v => {
              setBgmVol(v)
              onVolumeChange?.({ bgm_volume: v / 100, original_volume: origVol / 100 })
            }}
          />
        </div>

        {saveError && <p className="mt-3 text-[12px] text-red-400">{saveError}</p>}
      </div>
    </details>
  )
}

function VolumeSlider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-[12px] text-[rgba(255,255,255,0.5)]">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 accent-[#0071e3]"
      />
      <span className="w-10 text-right font-mono text-[12px] text-[rgba(255,255,255,0.6)]">
        {value}%
      </span>
    </div>
  )
}
