import { GoogleGenerativeAI } from '@google/generative-ai'
import type { z } from 'zod'

const apiKey = process.env.GEMINI_API_KEY

if (!apiKey) {
  // Allow build to succeed without key. Runtime error if called.
  console.warn('[llm] GEMINI_API_KEY not set — Curator features will fail at runtime')
}

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null

export const geminiLite = genAI?.getGenerativeModel({
  model: 'gemini-2.5-flash-lite',
  generationConfig: {
    responseMimeType: 'application/json',
  },
})

// Rate-limit: free tier cap is ~20 req/day; keep under 3 req/min (≥21 s gap)
const MIN_INTERVAL_MS = 21_000
let lastRequestAt = 0

async function rateLimitedWait() {
  const now = Date.now()
  const elapsed = now - lastRequestAt
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_INTERVAL_MS - elapsed))
  }
  lastRequestAt = Date.now()
}

export async function generateJson<T>(
  prompt: string,
  schema: z.ZodType<T>,
  temperature: number = 0.7,
): Promise<T> {
  if (!geminiLite) {
    throw new Error('Gemini client not initialized — GEMINI_API_KEY missing')
  }

  await rateLimitedWait()

  const result = await geminiLite.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature, responseMimeType: 'application/json' },
  })
  const text = result.response.text()

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // Model occasionally wraps JSON in markdown fences — extract the object/array
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
    if (match) {
      try {
        parsed = JSON.parse(match[0])
      } catch {
        throw new Error(`[llm] Invalid JSON response: ${text.slice(0, 300)}`)
      }
    } else {
      throw new Error(`[llm] Invalid JSON response: ${text.slice(0, 300)}`)
    }
  }

  return schema.parse(parsed)
}
