'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')

    const form = event.currentTarget
    const email = (form.elements.namedItem('email') as HTMLInputElement).value.trim()
    const password = (form.elements.namedItem('password') as HTMLInputElement).value
    const supabase = createClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (signInError) {
      setError(signInError.message)
      setLoading(false)
      return
    }

    router.push('/curation')
    router.refresh()
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f5f7] px-6 py-16">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 text-center">
          <p className="text-[12px] text-[rgba(0,0,0,0.48)]">galaxymap_ytp_v2</p>
          <h1
            className="mt-2 text-[40px] font-semibold leading-[1.10] text-[#1d1d1f]"
            style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", Helvetica, Arial, sans-serif' }}
          >
            Login
          </h1>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-lg bg-white p-8 shadow-[rgba(0,0,0,0.08)_0px_2px_12px]"
        >
          <div className="space-y-5">
            <Field label="Email" name="email" type="email" autoComplete="email" />
            <Field label="Password" name="password" type="password" autoComplete="current-password" />
          </div>

          {error && (
            <p className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-[14px] text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-7 w-full rounded-lg bg-[#0071e3] py-3 text-[17px] text-white transition-colors hover:bg-[#0077ed] disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Login'}
          </button>
        </form>
      </div>
    </main>
  )
}

function Field({
  label,
  name,
  type,
  autoComplete,
}: {
  label: string
  name: string
  type: string
  autoComplete: string
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-2 block text-[14px] font-semibold tracking-[-0.224px] text-[#1d1d1f]">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required
        autoComplete={autoComplete}
        className="w-full rounded-lg bg-[#f5f5f7] px-4 py-3 text-[17px] text-[#1d1d1f] outline-none ring-2 ring-transparent placeholder:text-[rgba(0,0,0,0.28)] focus:ring-[#0071e3]"
      />
    </div>
  )
}
