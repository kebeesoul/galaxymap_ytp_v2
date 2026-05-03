'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  TOPIC_OPTIONS, ERA_OPTIONS, GENRE_OPTIONS, isModulationValid,
  type TopicKey, type EraKey, type GenreKey,
} from '@/lib/curator/modulation'

interface TonePreset { key: string; label: string; description: string }

interface RecommendSlot {
  id: string
  rank: number
  artist: string
  song_title: string
  release_year: number | null
  genre: string | null
  reason: string | null
  role: string
  popularity_estimate: number | null
  yt_video_id: string | null
}

interface RecommendResponse {
  batch_id: string
  recommendations: RecommendSlot[]
  partial: boolean
}

interface PickResponse { project_id: string }
interface AddManualResponse { project_id: string }
interface GenerateBaseResponse { text: string }
interface TransformToneResponse { text: string }

const ROLE_LABELS: Record<string, string> = {
  popular: '대중성',
  reliable: '안정성',
  wildcard: '의외성',
}
const ROLE_COLORS: Record<string, string> = {
  popular: 'bg-[#0071e3]/20 text-[#2997ff]',
  reliable: 'bg-green-900/30 text-green-400',
  wildcard: 'bg-orange-900/30 text-orange-400',
}

function Stars({ value }: { value: number | null }) {
  const filled = Math.round((value ?? 0) / 2)
  return (
    <span className="font-mono text-[11px] text-yellow-400">
      {'★'.repeat(Math.min(filled, 5))}{'☆'.repeat(Math.max(0, 5 - filled))}
    </span>
  )
}

export default function CuratorBoard({ tonePresets }: { tonePresets: TonePreset[] }) {
  // Modulation
  const [topic, setTopic] = useState<TopicKey>('all')
  const [era, setEra] = useState<EraKey>('all')
  const [genre, setGenre] = useState<GenreKey>('all')

  // Recommendations
  const [loading, setLoading] = useState(false)
  const [recs, setRecs] = useState<RecommendSlot[]>([])
  const [partial, setPartial] = useState(false)
  const [recError, setRecError] = useState<string | null>(null)

  // Selected project
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] = useState<{ artist: string; song_title: string } | null>(null)

  // Memo editor
  const [memoText, setMemoText] = useState('')
  const [activeTone, setActiveTone] = useState<string | null>(null)
  const [memoGenerating, setMemoGenerating] = useState(false)
  const [memoError, setMemoError] = useState<string | null>(null)
  const [toneLoading, setToneLoading] = useState<string | null>(null)
  const [savedMemo, setSavedMemo] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  // Manual input
  const [manualArtist, setManualArtist] = useState('')
  const [manualTitle, setManualTitle] = useState('')
  const [manualUrl, setManualUrl] = useState('')
  const [manualLoading, setManualLoading] = useState(false)
  const [manualError, setManualError] = useState<string | null>(null)

  const supabase = useMemo(() => createClient(), [])
  const modulationValid = isModulationValid(topic, era, genre)

  async function triggerGenerateBase(projectId: string) {
    setMemoGenerating(true)
    setMemoError(null)
    try {
      const res = await fetch('/api/curator/generate-base', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId }),
      })
      const data = (await res.json()) as GenerateBaseResponse & { error?: string }
      if (!res.ok) throw new Error(data.error ?? '메모 생성 실패')
      setMemoText(data.text)
    } catch (err) {
      setMemoError(err instanceof Error ? err.message : '메모 생성 실패')
    } finally {
      setMemoGenerating(false)
    }
  }

  function activateProject(projectId: string, artist: string, song_title: string) {
    setSelectedProjectId(projectId)
    setSelectedProject({ artist, song_title })
    setMemoText('')
    setActiveTone(null)
    setSavedMemo(null)
    void triggerGenerateBase(projectId)
  }

  async function handleReload() {
    if (!modulationValid) return
    setLoading(true)
    setRecError(null)
    setRecs([])
    try {
      const res = await fetch('/api/curator/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          era,
          genre,
          exclude: recs.map(r => ({ artist: r.artist, song_title: r.song_title })),
        }),
      })
      const data = (await res.json()) as RecommendResponse & { error?: string }
      if (!res.ok) throw new Error(data.error ?? '추천 실패')
      setRecs(data.recommendations)
      setPartial(data.partial)
    } catch (err) {
      setRecError(err instanceof Error ? err.message : '추천 실패')
    } finally {
      setLoading(false)
    }
  }

  async function handlePick(rec: RecommendSlot) {
    try {
      const res = await fetch('/api/curator/pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendation_id: rec.id }),
      })
      const data = (await res.json()) as PickResponse & { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Pick 실패')
      activateProject(data.project_id, rec.artist, rec.song_title)
    } catch (err) {
      setRecError(err instanceof Error ? err.message : 'Pick 실패')
    }
  }

  async function handleAddManual() {
    if (!manualArtist || !manualTitle || !manualUrl) return
    setManualLoading(true)
    setManualError(null)
    try {
      const res = await fetch('/api/curator/add-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist: manualArtist, song_title: manualTitle, source_url: manualUrl }),
      })
      const data = (await res.json()) as AddManualResponse & { error?: string }
      if (!res.ok) throw new Error(data.error ?? '추가 실패')
      activateProject(data.project_id, manualArtist, manualTitle)
      setManualArtist('')
      setManualTitle('')
      setManualUrl('')
    } catch (err) {
      setManualError(err instanceof Error ? err.message : '추가 실패')
    } finally {
      setManualLoading(false)
    }
  }

  async function handleTransformTone(tone: string) {
    if (!selectedProjectId || !memoText) return
    setToneLoading(tone)
    try {
      const res = await fetch('/api/curator/transform-tone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: selectedProjectId, base_text: memoText, tone }),
      })
      const data = (await res.json()) as TransformToneResponse & { error?: string }
      if (!res.ok) throw new Error(data.error ?? '톤 변환 실패')
      setMemoText(data.text)
      setActiveTone(tone)
      setSavedMemo(null)
    } catch (err) {
      setMemoError(err instanceof Error ? err.message : '톤 변환 실패')
    } finally {
      setToneLoading(null)
    }
  }

  async function handleSave() {
    if (!selectedProjectId) return
    setSaving(true)
    const { error } = await supabase
      .from('projects')
      .update({ description_styled: memoText, description_tone: activeTone })
      .eq('id', selectedProjectId)
    if (error) {
      setMemoError(error.message)
    } else {
      setSavedMemo(memoText)
    }
    setSaving(false)
  }

  async function handleCopy() {
    if (!savedMemo) return
    await navigator.clipboard.writeText(savedMemo)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const selectClass = 'w-full rounded-lg bg-[#272729] px-3 py-2 text-[13px] text-white outline-none focus:ring-1 focus:ring-[#0071e3]'

  return (
    <div className="grid grid-cols-12 gap-6">
      {/* LEFT: Recommendations + Manual */}
      <div className="col-span-5 space-y-5">
        {/* Modulation */}
        <div className="rounded-xl bg-[#1d1d1f] px-5 py-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgba(255,255,255,0.4)]">
            필터
          </p>
          <div className="space-y-2">
            <select value={topic} onChange={e => setTopic(e.target.value as TopicKey)} className={selectClass}>
              {Object.entries(TOPIC_OPTIONS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select value={era} onChange={e => setEra(e.target.value as EraKey)} className={selectClass}>
              {Object.entries(ERA_OPTIONS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select value={genre} onChange={e => setGenre(e.target.value as GenreKey)} className={selectClass}>
              {Object.entries(GENRE_OPTIONS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              onClick={handleReload}
              disabled={!modulationValid || loading}
              title={!modulationValid ? '최소 하나의 필터를 선택하세요' : undefined}
              className="flex items-center gap-1.5 rounded-lg bg-[#0071e3] px-4 py-2 text-[13px] text-white transition-colors hover:bg-[#0077ed] disabled:cursor-not-allowed disabled:opacity-30"
            >
              {loading ? (
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border border-white/30 border-t-white" />
              ) : (
                <span>↻</span>
              )}
              Reload
            </button>
          </div>
          {recError && <p className="mt-2 text-[12px] text-red-400">{recError}</p>}
        </div>

        {/* Recommendation cards */}
        {(recs.length > 0 || partial) && (
          <div className="space-y-2">
            {partial && recs.length < 3 && (
              <p className="text-[11px] text-yellow-400/70">
                일부 슬롯 검색 실패 — {recs.length}개만 표시
              </p>
            )}
            {recs.map(rec => (
              <div key={rec.id} className="rounded-xl bg-[#1d1d1f] px-4 py-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="mb-1 flex items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${ROLE_COLORS[rec.role] ?? ROLE_COLORS.reliable}`}>
                        {ROLE_LABELS[rec.role] ?? rec.role}
                      </span>
                      <Stars value={rec.popularity_estimate} />
                    </div>
                    <p className="text-[13px] font-medium text-white">
                      {rec.artist} – {rec.song_title}
                    </p>
                    <p className="text-[11px] text-[rgba(255,255,255,0.35)]">
                      {[rec.release_year, rec.genre].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <button
                    onClick={() => handlePick(rec)}
                    className="shrink-0 rounded-lg bg-[#0071e3] px-3 py-1.5 text-[12px] text-white hover:bg-[#0077ed]"
                  >
                    Use →
                  </button>
                </div>
                {rec.reason && (
                  <p className="line-clamp-2 text-[11px] leading-relaxed text-[rgba(255,255,255,0.4)]">
                    {rec.reason}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Manual input */}
        <div className="rounded-xl bg-[#1d1d1f] px-5 py-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgba(255,255,255,0.4)]">
            직접 입력
          </p>
          <div className="space-y-2">
            <input
              value={manualArtist}
              onChange={e => setManualArtist(e.target.value)}
              placeholder="아티스트"
              className="w-full rounded-lg bg-[#272729] px-3 py-2 text-[13px] text-white outline-none placeholder:text-[rgba(255,255,255,0.2)] focus:ring-1 focus:ring-[#0071e3]"
            />
            <input
              value={manualTitle}
              onChange={e => setManualTitle(e.target.value)}
              placeholder="곡 제목"
              className="w-full rounded-lg bg-[#272729] px-3 py-2 text-[13px] text-white outline-none placeholder:text-[rgba(255,255,255,0.2)] focus:ring-1 focus:ring-[#0071e3]"
            />
            <input
              value={manualUrl}
              onChange={e => setManualUrl(e.target.value)}
              placeholder="YouTube URL"
              className="w-full rounded-lg bg-[#272729] px-3 py-2 text-[13px] text-white outline-none placeholder:text-[rgba(255,255,255,0.2)] focus:ring-1 focus:ring-[#0071e3]"
            />
          </div>
          {manualError && <p className="mt-2 text-[12px] text-red-400">{manualError}</p>}
          <div className="mt-3 flex justify-end">
            <button
              onClick={handleAddManual}
              disabled={manualLoading || !manualArtist || !manualTitle || !manualUrl}
              className="rounded-lg bg-[#272729] px-4 py-2 text-[13px] text-white transition-colors hover:bg-[#2a2a2d] disabled:opacity-30"
            >
              {manualLoading ? '추가 중…' : 'Add & Edit →'}
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT: Memo editor */}
      <div className="col-span-7">
        <div className={`rounded-xl bg-[#1d1d1f] px-6 py-5 ${!selectedProjectId ? 'opacity-50' : ''}`}>
          {!selectedProjectId ? (
            <div className="flex h-64 items-center justify-center text-[14px] text-[rgba(255,255,255,0.3)]">
              왼쪽에서 트랙을 선택하세요
            </div>
          ) : (
            <div className="space-y-4">
              {/* Project info */}
              <div>
                <p className="text-[11px] text-[rgba(255,255,255,0.35)]">선택된 트랙</p>
                <p className="text-[15px] font-semibold text-white">
                  {selectedProject?.artist} – {selectedProject?.song_title}
                </p>
              </div>

              {/* Memo textarea */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-[11px] text-[rgba(255,255,255,0.4)]">메모</p>
                  <button
                    onClick={() => selectedProjectId && triggerGenerateBase(selectedProjectId)}
                    disabled={memoGenerating}
                    className="text-[11px] text-[#2997ff] hover:text-[#0071e3] disabled:opacity-40"
                  >
                    {memoGenerating ? '생성 중…' : '↻ 재생성'}
                  </button>
                </div>
                {memoGenerating && !memoText ? (
                  <div className="flex h-36 items-center justify-center rounded-lg bg-[#272729] text-[12px] text-[rgba(255,255,255,0.3)]">
                    메모 생성 중…
                  </div>
                ) : (
                  <textarea
                    value={memoText}
                    onChange={e => setMemoText(e.target.value)}
                    rows={8}
                    className="w-full resize-none rounded-lg bg-[#272729] px-4 py-3 text-[13px] leading-relaxed text-white outline-none placeholder:text-[rgba(255,255,255,0.2)] focus:ring-1 focus:ring-[#0071e3]"
                    placeholder="베이스 메모가 여기 표시됩니다"
                  />
                )}
                {memoError && <p className="mt-1 text-[11px] text-red-400">{memoError}</p>}
              </div>

              {/* Tone buttons */}
              <div>
                <p className="mb-2 text-[11px] text-[rgba(255,255,255,0.4)]">톤 변환</p>
                <div className="flex flex-wrap gap-2">
                  {tonePresets.map(preset => (
                    <button
                      key={preset.key}
                      onClick={() => handleTransformTone(preset.key)}
                      disabled={!!toneLoading || memoGenerating || !memoText}
                      className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-30 ${
                        activeTone === preset.key
                          ? 'bg-[#0071e3] text-white'
                          : 'bg-[#272729] text-[rgba(255,255,255,0.7)] hover:bg-[#2a2a2d]'
                      }`}
                    >
                      {toneLoading === preset.key ? '변환 중…' : preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Save */}
              <div className="flex justify-end">
                <button
                  onClick={handleSave}
                  disabled={saving || !memoText}
                  className="rounded-lg bg-[#0071e3] px-4 py-2 text-[13px] text-white transition-colors hover:bg-[#0077ed] disabled:opacity-30"
                >
                  {saving ? '저장 중…' : '저장'}
                </button>
              </div>

              {/* Saved preview */}
              {savedMemo && (
                <div className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#272729] px-4 py-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-green-400">저장된 메모</p>
                    <button
                      onClick={handleCopy}
                      className="text-[11px] text-[rgba(255,255,255,0.5)] hover:text-white"
                    >
                      {copied ? '복사됨 ✓' : '복사'}
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-[rgba(255,255,255,0.7)]">
                    {savedMemo}
                  </p>
                </div>
              )}

              {savedMemo && selectedProjectId && (
                <div>
                  <Link
                    href={`/editor/${selectedProjectId}`}
                    className="inline-block rounded-lg bg-[#272729] px-4 py-2 text-[13px] text-white transition-colors hover:bg-[#2a2a2d]"
                  >
                    에디터에서 열기 →
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
