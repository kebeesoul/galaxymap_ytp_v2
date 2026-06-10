import { z } from 'zod'

export const RecommendationSchema = z.object({
  artist: z.string().min(1),
  song_title: z.string().min(1),
  release_year: z.number().int().min(1900).max(2030).optional(),
  genre: z.string().optional(),
  reason: z.string().min(1),
  role: z.enum(['popular', 'reliable', 'wildcard']),
  popularity_estimate: z.number().int().min(1).max(10),
})

export const RecommendResponseSchema = z.object({
  recommendations: z
    .array(RecommendationSchema)
    .length(3)
    .refine(
      (items) => new Set(items.map((item) => item.role)).size === 3,
      'popular, reliable, and wildcard roles are each required',
    ),
})

export const ReplacementSchema = z.object({
  replacements: z.array(RecommendationSchema).length(2),
})

export const MemoSchema = z.object({
  text: z.string().min(1),
})

export type Recommendation = z.infer<typeof RecommendationSchema>
export type RecommendResponse = z.infer<typeof RecommendResponseSchema>
export type Replacement = z.infer<typeof ReplacementSchema>
export type Memo = z.infer<typeof MemoSchema>
