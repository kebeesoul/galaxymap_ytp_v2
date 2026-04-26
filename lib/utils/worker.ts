/** Returns the ingest worker base URL, checking both env var names. */
export function getIngestWorkerUrl(): string | undefined {
  return process.env.INGEST_WORKER_URL ?? process.env.PYTHON_WORKER_URL
}

/** Same as getIngestWorkerUrl but falls back to localhost for local dev. */
export function getIngestWorkerUrlWithFallback(): string {
  return getIngestWorkerUrl() ?? 'http://localhost:8001'
}
