import { z } from 'zod'

export const recommendationSchema = z.object({
  artist: z.string().trim().min(1),
  song_title: z.string().trim().min(1),
  release_year: z.number().int().min(1950).max(new Date().getFullYear()),
  genre: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(300),
  role: z.enum(['popular', 'reliable', 'wildcard']),
  popularity_estimate: z.number().int().min(1).max(10),
  topic: z.string().trim().min(1),
  era: z.string().trim().min(1),
})

export const recommendationBatchSchema = z.object({
  recommendations: z
    .array(recommendationSchema)
    .length(3)
    .refine(
      (items) => new Set(items.map((item) => item.role)).size === 3,
      'popular, reliable, and wildcard roles are each required',
    ),
})

export type GeneratedRecommendation = z.infer<typeof recommendationSchema>
