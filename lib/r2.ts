const R2_DISABLED_MESSAGE =
  'R2 source storage is temporarily disabled. Use local workspace source storage instead.'

export function getR2Config(): never {
  throw new Error(R2_DISABLED_MESSAGE)
}

export function createR2Client(): never {
  throw new Error(R2_DISABLED_MESSAGE)
}

export async function createSourceDownloadUrl(_key: string): Promise<never> {
  throw new Error(R2_DISABLED_MESSAGE)
}

export async function downloadSourceObject(_key: string, _destination: string): Promise<never> {
  throw new Error(R2_DISABLED_MESSAGE)
}
