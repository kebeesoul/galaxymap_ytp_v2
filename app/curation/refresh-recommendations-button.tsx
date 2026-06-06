'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function RefreshRecommendationsButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function refreshRecommendations() {
    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/curator/recommend', { method: 'POST' })
      const body = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(body.error ?? '추천 생성에 실패했습니다.')
      router.refresh()
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : '추천 생성에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      {error && <p className="text-right text-[12px] text-red-600">{error}</p>}
      <button
        type="button"
        onClick={refreshRecommendations}
        disabled={loading}
        className="shrink-0 text-[14px] text-[#0066cc] transition-colors hover:text-[#0071e3] hover:underline disabled:cursor-wait disabled:opacity-50"
      >
        {loading ? '추천 중…' : '새로고침'}
      </button>
    </div>
  )
}
