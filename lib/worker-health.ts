export const WORKER_OFFLINE_AFTER_MS = 2 * 60 * 1000

export function isWorkerOffline(
  lastBeatAt: string | null,
  nowMs = Date.now(),
  staleAfterMs = WORKER_OFFLINE_AFTER_MS,
): boolean {
  if (!lastBeatAt) return true
  const lastBeatMs = Date.parse(lastBeatAt)
  if (!Number.isFinite(lastBeatMs)) return true
  return nowMs - lastBeatMs > staleAfterMs
}
