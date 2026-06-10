import { z } from 'zod'

export const RENDER_PRESETS = ['fast', 'balanced', 'quality'] as const

export const importRequestSchema = z.object({
  project_id: z.string().min(1),
  url: z.string().optional(),
})

export const renderRequestSchema = z.object({
  clip_id: z.string().min(1),
  preset: z
    .enum(RENDER_PRESETS)
    .or(z.string().transform(() => 'balanced' as const))
    .default('balanced'),
})
