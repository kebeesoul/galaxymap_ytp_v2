'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LogoutButton({
  className = '',
}: {
  className?: string
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleLogout() {
    setLoading(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className={`rounded-lg px-4 py-2 text-[14px] transition-colors disabled:opacity-40 ${className}`}
    >
      {loading ? 'Logging out…' : 'Logout'}
    </button>
  )
}
