import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { getR2Config } from '@/lib/r2'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('R2 configuration', () => {
  it('requires complete server-side credentials', () => {
    delete process.env.R2_ENDPOINT
    delete process.env.R2_ACCESS_KEY_ID
    delete process.env.R2_SECRET_ACCESS_KEY
    delete process.env.R2_BUCKET

    expect(() => getR2Config()).toThrow()
  })

  it('accepts a complete Cloudflare R2 configuration', () => {
    process.env.R2_ENDPOINT = 'https://account.r2.cloudflarestorage.com'
    process.env.R2_ACCESS_KEY_ID = 'access-key'
    process.env.R2_SECRET_ACCESS_KEY = 'secret-key'
    process.env.R2_BUCKET = 'source-bucket'

    expect(getR2Config()).toEqual({
      R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      R2_ACCESS_KEY_ID: 'access-key',
      R2_SECRET_ACCESS_KEY: 'secret-key',
      R2_BUCKET: 'source-bucket',
    })
  })

  it('uses the R2 region and one-hour source presign contract', () => {
    const source = readFileSync(path.join(process.cwd(), 'lib/r2.ts'), 'utf8')

    expect(source).toContain("region: 'auto'")
    expect(source).toContain('{ expiresIn: 3600 }')
  })
})
