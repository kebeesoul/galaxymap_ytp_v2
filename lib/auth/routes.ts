export const PROTECTED_ROUTE_PREFIXES = [
  '/curation',
  '/select',
  '/editor',
  '/history',
] as const

export function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}
