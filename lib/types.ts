import type { Tables } from '@/lib/supabase/types'

export type Project = Tables<'projects'>
export type Clip = Tables<'clips'>
export type LyricsSegment = Tables<'lyrics_segments'>
export type Comment = Tables<'comments'>
export type Template = Tables<'templates'>
