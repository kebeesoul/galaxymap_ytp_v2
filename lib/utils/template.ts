import type { Json } from '@/lib/supabase/types'

/** Extracts the `layout` string from a template's config_json. Returns '' if absent. */
export function extractLayout(config: Json): string {
  if (
    config !== null &&
    typeof config === 'object' &&
    !Array.isArray(config) &&
    typeof config.layout === 'string'
  ) {
    return config.layout
  }
  return ''
}
