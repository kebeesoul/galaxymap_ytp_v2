import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

const apiKey = process.env.ANTHROPIC_API_KEY

if (!apiKey) {
  // Allow build to succeed without key. Runtime error if called.
  console.warn('[llm] ANTHROPIC_API_KEY not set — Curator features will fail at runtime')
}

const client = apiKey ? new Anthropic({ apiKey }) : null

// Haiku 4.5 — fast & cheap, sufficient for short JSON tasks (recommendations + memos)
const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 2048

const TOOL_NAME = 'submit_response'

export async function generateJson<T>(
  prompt: string,
  schema: z.ZodType<T>,
  temperature: number = 0.7,
): Promise<T> {
  if (!client) {
    throw new Error('Anthropic client not initialized — ANTHROPIC_API_KEY missing')
  }

  // Force structured output via tool_use — eliminates the JSON-in-markdown
  // failure mode that plagued the Gemini integration.
  const inputSchema = z.toJSONSchema(schema, {
    target: 'draft-7',
  }) as Anthropic.Tool.InputSchema

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature,
    tools: [
      {
        name: TOOL_NAME,
        description: 'Submit the structured response',
        input_schema: inputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: prompt }],
  })

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  )
  if (!toolUse) {
    throw new Error('[llm] Anthropic response missing tool_use block')
  }

  return schema.parse(toolUse.input)
}
