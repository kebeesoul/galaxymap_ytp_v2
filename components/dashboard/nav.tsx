'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function DashboardNav() {
  const pathname = usePathname()

  return (
    <nav className="sticky top-0 z-50 flex h-14 items-center border-b border-[rgba(255,255,255,0.08)] bg-[#1d1d1f] px-6">
      <span className="mr-8 text-[13px] font-semibold tracking-tight text-white">
        galaxymap_ytp_v2
      </span>
      <div className="flex items-center gap-5">
        <Link
          href="/projects"
          className={`text-[13px] transition-colors ${
            pathname.startsWith('/projects') || pathname.startsWith('/editor')
              ? 'text-white'
              : 'text-[rgba(255,255,255,0.45)] hover:text-white'
          }`}
        >
          Curator
        </Link>
        <Link
          href="/history"
          className={`text-[13px] transition-colors ${
            pathname === '/history'
              ? 'text-white'
              : 'text-[rgba(255,255,255,0.45)] hover:text-white'
          }`}
        >
          History
        </Link>
      </div>
    </nav>
  )
}
