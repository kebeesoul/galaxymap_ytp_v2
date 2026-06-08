import { describe, expect, it } from 'vitest'
import { isWorkerOffline, WORKER_OFFLINE_AFTER_MS } from '@/lib/worker-health'

describe('worker health', () => {
  const now = Date.parse('2026-06-08T12:00:00.000Z')

  it('treats a recent heartbeat as online', () => {
    expect(isWorkerOffline('2026-06-08T11:59:00.000Z', now)).toBe(false)
  })

  it('treats a heartbeat older than two minutes as offline', () => {
    expect(isWorkerOffline('2026-06-08T11:57:59.000Z', now)).toBe(true)
    expect(WORKER_OFFLINE_AFTER_MS).toBe(120_000)
  })

  it('treats a missing or invalid heartbeat as offline', () => {
    expect(isWorkerOffline(null, now)).toBe(true)
    expect(isWorkerOffline('invalid', now)).toBe(true)
  })
})
