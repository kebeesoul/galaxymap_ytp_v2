'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { formatMmss } from '@/lib/utils/time'
import type { ExportRow } from './page'

const supabase = createClient()

interface ProjectGroup {
  project_id: string
  artist: string
  song_title: string
  thumbnail_url: string | null
  clips: ExportRow[]
}

export default function ExportList({ rows }: { rows: ExportRow[] }) {
  const [downloading, setDownloading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const groups = useMemo<ProjectGroup[]>(() => {
    const map = new Map<string, ProjectGroup>()
    for (const r of rows) {
      const g = map.get(r.project_id)
      if (g) {
        g.clips.push(r)
      } else {
        map.set(r.project_id, {
          project_id: r.project_id,
          artist: r.artist,
          song_title: r.song_title,
          thumbnail_url: r.thumbnail_url,
          clips: [r],
        })
      }
    }
    return Array.from(map.values())
  }, [rows])

  async function handleDownload(row: ExportRow) {
    setDownloading(row.clip_id)
    setError(null)
    try {
      const { data, error: signErr } = await supabase.storage
        .from('renders')
        .createSignedUrl(row.render_path, 300)
      if (signErr || !data?.signedUrl) {
        throw new Error(signErr?.message ?? 'failed to get download url')
      }
      const filename = `${row.artist} - ${row.song_title}${row.clip_label ? ` (${row.clip_label})` : ''}.mp4`
        .replace(/[/\\?%*:|"<>]/g, '_')
      const a = document.createElement('a')
      a.href = data.signedUrl
      a.download = filename
      a.click()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'download failed')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <>
      <div className="mb-12 flex items-center justify-between">
        <h1
          className="text-[40px] font-semibold leading-[1.10] text-[#1d1d1f]"
          style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", Helvetica, Arial, sans-serif' }}
        >
          Export
        </h1>
        <Link href="/projects" className="text-[14px] text-[#0066cc] hover:underline">
          ← Projects
        </Link>
      </div>

      {error && (
        <p className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-[14px] text-red-600">{error}</p>
      )}

      {groups.length === 0 ? (
        <div className="rounded-2xl bg-white py-24 text-center shadow-[rgba(0,0,0,0.08)_0px_2px_12px]">
          <p className="text-[17px] text-[rgba(0,0,0,0.48)]">렌더 완료된 클립이 아직 없습니다.</p>
          <p className="mt-2 text-[14px] text-[rgba(0,0,0,0.4)]">
            에디터에서 ‘렌더 시작’ 버튼을 누르면 로컬 워커가 인코딩 후 여기에 표시됩니다.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <div
              key={g.project_id}
              className="rounded-2xl bg-white shadow-[rgba(0,0,0,0.08)_0px_2px_12px]"
            >
              <div className="flex items-center gap-6 px-6 py-5 border-b border-[rgba(0,0,0,0.06)]">
                {g.thumbnail_url ? (
                  <img
                    src={g.thumbnail_url}
                    alt={g.song_title}
                    className="h-16 w-28 rounded-lg object-cover"
                  />
                ) : (
                  <div className="h-16 w-28 shrink-0 rounded-lg bg-[#f5f5f7]" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[21px] font-semibold leading-[1.19] tracking-[0.231px] text-[#1d1d1f]">
                    {g.song_title}
                  </p>
                  <p className="mt-0.5 text-[14px] text-[rgba(0,0,0,0.6)]">{g.artist}</p>
                </div>
                <span className="shrink-0 rounded-full bg-[#f5f5f7] px-3 py-1 text-[12px] text-[rgba(0,0,0,0.6)]">
                  {g.clips.length} clip{g.clips.length === 1 ? '' : 's'}
                </span>
              </div>

              <ul>
                {g.clips.map((c) => (
                  <li
                    key={c.clip_id}
                    className="flex items-center gap-4 px-6 py-4 border-b border-[rgba(0,0,0,0.04)] last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] text-[#1d1d1f]">
                        {c.clip_label || '(라벨 없음)'}
                      </p>
                      <p className="mt-0.5 font-mono text-[12px] text-[rgba(0,0,0,0.5)]">
                        {formatMmss(c.start_sec)} – {formatMmss(c.end_sec)}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDownload(c)}
                      disabled={downloading === c.clip_id}
                      className="rounded-lg bg-[#0071e3] px-4 py-2 text-[14px] text-white transition-colors hover:bg-[#0077ed] disabled:opacity-40"
                    >
                      {downloading === c.clip_id ? '다운로드 중…' : '다운로드'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
