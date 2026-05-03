/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@remotion/player'],
  experimental: {
    // Router Cache stale time for dynamic routes (force-dynamic pages).
    // Default is 30s which causes deleted items to reappear on back-navigation.
    staleTimes: { dynamic: 0 },
  },
}

export default nextConfig
