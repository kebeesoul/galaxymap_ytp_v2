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

export async function generateJson<T>(
  prompt: string,
  schema: z.ZodType<T>,
  temperature: number = 0.7,
): Promise<T> {
  if (!geminiLite) {
    throw new Error('Gemini client not initialized — GEMINI_API_KEY missing')
  }

  const result = await geminiLite.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature },
  })
  const text = result.response.text()

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`[llm] Invalid JSON response: ${text.slice(0, 200)}`)
  }

  return schema.parse(parsed)
}
