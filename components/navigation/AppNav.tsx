'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import LogoutButton from '@/components/auth/LogoutButton'

const navItems = [
  { label: 'Curation', href: '/curation' },
  { label: 'Select', href: '/select' },
  { label: 'Editor', href: '/editor' },
  { label: 'History', href: '/history' },
]

export default function AppNav() {
  const pathname = usePathname()
  if (pathname === '/login') return null

  return (
    <nav className="sticky top-0 z-30 h-12 border-b border-white/[0.08] bg-black/80 px-6 backdrop-blur-xl">
      <div className="mx-auto flex h-full max-w-[980px] items-center justify-between">
        <Link href="/curation" className="text-[12px] text-white transition-opacity hover:opacity-70">
          galaxymap_ytp
        </Link>
        <div className="flex items-center gap-5">
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`text-[12px] transition-colors ${
                  active ? 'text-white' : 'text-[rgba(255,255,255,0.58)] hover:text-white'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
          <LogoutButton className="bg-[#272729] px-3 py-1.5 text-[12px] text-white hover:bg-[#2a2a2d]" />
        </div>
      </div>
    </nav>
  )
}
