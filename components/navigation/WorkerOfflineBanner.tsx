'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { isWorkerOffline } from '@/lib/worker-health'

const HEALTH_POLL_INTERVAL_MS = 30_000

export default function WorkerOfflineBanner() {
  const pathname = usePathname()
  const supabase = useMemo(() => createClient(), [])
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    if (pathname === '/login') return

    let active = true

    async function refreshHealth() {
      const { data, error } = await supabase
        .from('worker_health')
        .select('last_beat_at')
        .eq('worker_id', 'ingest')
        .maybeSingle()

      if (!active) return
      if (error) {
        setOffline(false)
        return
      }
      setOffline(isWorkerOffline(data?.last_beat_at ?? null))
    }

    void refreshHealth()
    const timer = window.setInterval(refreshHealth, HEALTH_POLL_INTERVAL_MS)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [pathname, supabase])

  if (pathname === '/login' || !offline) return null

  return (
    <div role="status" className="bg-red-950 px-6 py-2 text-center text-[12px] text-red-200">
      Ingest worker offline — 새 영상 다운로드가 지연될 수 있습니다.
    </div>
  )
}
