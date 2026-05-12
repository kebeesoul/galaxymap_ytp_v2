/** Returns the ingest worker base URL, checking both env var names. */
export function getIngestWorkerUrl(): string | undefined {
  return process.env.INGEST_WORKER_URL ?? process.env.PYTHON_WORKER_URL
}

/** Same as getIngestWorkerUrl but falls back to localhost for local dev. */
export function getIngestWorkerUrlWithFallback(): string {
  const configured = getIngestWorkerUrl()
  if (configured) return configured
  if (process.env.NODE_ENV === 'production') {
    throw new Error('INGEST_WORKER_URL or PYTHON_WORKER_URL must be configured in production')
  }
  return 'http://localhost:8001'
}
