import { GoogleGenAI } from '@google/genai'
import { z } from 'zod'

const GeminiEnvSchema = z.object({
  GEMINI_API_KEY: z.string().min(1),
})

export const GEMINI_MODEL = 'gemini-2.5-flash-lite'

function createClient(): GoogleGenAI {
  const { GEMINI_API_KEY } = GeminiEnvSchema.parse(process.env)
  return new GoogleGenAI({ apiKey: GEMINI_API_KEY })
}

function toResponseJsonSchema<T>(schema: z.ZodType<T>): object {
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7' })
  const { $schema: _schemaVersion, ...responseJsonSchema } = jsonSchema
  return responseJsonSchema
}

export async function generateJson<T>(
  prompt: string,
  schema: z.ZodType<T>,
  temperature: number = 0.7,
): Promise<T> {
  const response = await createClient().models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      temperature,
      responseMimeType: 'application/json',
      responseJsonSchema: toResponseJsonSchema(schema),
    },
  })

  if (!response.text) {
    throw new Error('[llm] Gemini response did not contain text')
  }

  return schema.parse(JSON.parse(response.text))
}
