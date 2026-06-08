import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { z } from 'zod'

const R2EnvSchema = z.object({
  R2_ENDPOINT: z.string().url(),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
})

export function getR2Config() {
  return R2EnvSchema.parse(process.env)
}

export function createR2Client() {
  const config = getR2Config()
  return new S3Client({
    region: 'auto',
    endpoint: config.R2_ENDPOINT,
    credentials: {
      accessKeyId: config.R2_ACCESS_KEY_ID,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY,
    },
  })
}

export async function createSourceDownloadUrl(key: string): Promise<string> {
  const config = getR2Config()
  return getSignedUrl(
    createR2Client(),
    new GetObjectCommand({ Bucket: config.R2_BUCKET, Key: key }),
    { expiresIn: 3600 },
  )
}

export async function downloadSourceObject(key: string, destination: string): Promise<void> {
  const config = getR2Config()
  const response = await createR2Client().send(
    new GetObjectCommand({ Bucket: config.R2_BUCKET, Key: key }),
  )
  if (!(response.Body instanceof Readable)) {
    throw new Error('R2 source response did not contain a readable body')
  }
  await pipeline(response.Body, createWriteStream(destination))
}
