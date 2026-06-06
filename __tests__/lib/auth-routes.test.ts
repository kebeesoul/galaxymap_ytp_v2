import { describe, expect, it } from 'vitest'
import {
  isProtectedRoute,
  PROTECTED_ROUTE_PREFIXES,
} from '@/lib/auth/routes'

describe('auth route protection', () => {
  it.each(PROTECTED_ROUTE_PREFIXES)('protects %s and nested routes', (prefix) => {
    expect(isProtectedRoute(prefix)).toBe(true)
    expect(isProtectedRoute(`${prefix}/project-id`)).toBe(true)
  })

  it.each([
    '/',
    '/login',
    '/api/import',
    '/favicon.ico',
    '/_next/static/chunk.js',
    '/curation-preview',
  ])('allows public path %s', (pathname) => {
    expect(isProtectedRoute(pathname)).toBe(false)
  })
})
