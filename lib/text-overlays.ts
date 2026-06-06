import { z } from 'zod'
import {
  DEFAULT_FONT_KEY,
  FONT_KEYS,
  type FontKey,
} from './fonts'

export const TEXT_OVERLAY_ZONES = ['top', 'bottom'] as const
export const TEXT_OVERLAY_ALIGNS = ['left', 'center', 'right'] as const
export const TEXT_OVERLAY_EFFECTS = ['none', 'shadow', 'outline'] as const

export type TextOverlayZone = (typeof TEXT_OVERLAY_ZONES)[number]
export type TextOverlayAlign = (typeof TEXT_OVERLAY_ALIGNS)[number]
export type TextOverlayEffect = (typeof TEXT_OVERLAY_EFFECTS)[number]

export interface TextOverlay {
  id: string
  clip_id: string
  zone: TextOverlayZone
  content: string
  x: number
  y: number
  rotation: number
  font_key: FontKey
  size: number
  color: string
  align: TextOverlayAlign
  effect: TextOverlayEffect
  z_index: number
  start_sec: number | null
  end_sec: number | null
}

export const textOverlaySchema = z.object({
  id: z.string(),
  clip_id: z.string(),
  zone: z.enum(TEXT_OVERLAY_ZONES),
  content: z.string(),
  x: z.coerce.number().min(0).max(1),
  y: z.coerce.number().min(0).max(1),
  rotation: z.coerce.number(),
  font_key: z.enum(FONT_KEYS as [FontKey, ...FontKey[]]),
  size: z.coerce.number().min(0.02).max(0.12),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  align: z.enum(TEXT_OVERLAY_ALIGNS),
  effect: z.enum(TEXT_OVERLAY_EFFECTS),
  z_index: z.coerce.number().int(),
  start_sec: z.coerce.number().nullable(),
  end_sec: z.coerce.number().nullable(),
})

export const DEFAULT_TEXT_OVERLAY = {
  zone: 'top',
  content: 'Text',
  x: 0.5,
  y: 0.5,
  rotation: 0,
  font_key: DEFAULT_FONT_KEY,
  size: 0.045,
  color: '#ffffff',
  align: 'center',
  effect: 'none',
  z_index: 0,
  start_sec: null,
  end_sec: null,
} satisfies Omit<TextOverlay, 'id' | 'clip_id'>

export function clampTextOverlayPosition(value: number): number {
  return Math.min(1, Math.max(0, value))
}
