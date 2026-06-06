import type { Tables } from '@/lib/supabase/types'

export type Project = Tables<'projects'>
export type Clip = Tables<'clips'>
export type LyricsSegment = Tables<'lyrics_segments'>
export type Comment = Tables<'comments'>
export type Template = Tables<'templates'>
export type TextOverlayRow = Tables<'text_overlays'>

export type ImportStatus = 'pending' | 'processing' | 'success' | 'failed'
export type RenderStatus = 'pending' | 'processing' | 'success' | 'failed'
export type TranscribeStatus = 'pending' | 'success' | 'failed'
