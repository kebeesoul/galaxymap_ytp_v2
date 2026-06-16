import { GoogleGenAI } from '@google/genai'
import { z } from 'zod'

const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY

if (!apiKey) {
  // Allow build to succeed without key. Runtime error if called.
  console.warn('[llm] GEMINI_API_KEY not set — Curator features will fail at runtime')
}

const client = apiKey ? new GoogleGenAI({ apiKey }) : null

// Gemini 2.5 Flash Lite — fast & cheap, sufficient for short JSON tasks
// (recommendations + memos). Mandated by project_spec.md.
const MODEL = 'gemini-2.5-flash-lite'

export async function generateJson<T>(
  prompt: string,
  schema: z.ZodType<T>,
  temperature: number = 0.7,
): Promise<T> {
  if (!client) {
    throw new Error('Gemini client not initialized — GEMINI_API_KEY missing')
  }

  // Force structured JSON output. `responseJsonSchema` accepts standard JSON
  // Schema (draft-7 compatible per @google/genai 2.8.0 typings, genai.d.ts
  // GenerateContentConfig.responseJsonSchema) and pairs with the required
  // application/json mimetype.
  const responseJsonSchema = z.toJSONSchema(schema, { target: 'draft-7' })

  const response = await client.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema,
      temperature,
    },
  })

  const text = response.text
  if (!text) {
    throw new Error('[llm] Gemini response missing text')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('[llm] Gemini response was not valid JSON')
  }

  // Preserve the zod guarantee regardless of model behavior.
  return schema.parse(parsed)
}
