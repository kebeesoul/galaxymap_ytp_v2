'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { TablesInsert } from '@/lib/supabase/types'

type LegacyProjectInsert = Omit<TablesInsert<'projects'>, 'owner_uid'>

export default function NewProjectPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const form = e.currentTarget
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      setError(userError?.message ?? 'Login required')
      setLoading(false)
      return
    }

    const payload: TablesInsert<'projects'> = {
      owner_uid: user.id,
      artist: (form.elements.namedItem('artist') as HTMLInputElement).value.trim(),
      song_title: (form.elements.namedItem('song_title') as HTMLInputElement).value.trim(),
      source_url: (form.elements.namedItem('source_url') as HTMLInputElement).value.trim(),
      import_status: 'pending',
      ip_owner: false,
    }

    let { data: project, error: err } = await supabase
      .from('projects')
      .insert(payload)
      .select()
      .single()

    if (err && isMissingOwnerUidError(err.message)) {
      const legacyPayload: LegacyProjectInsert = {
        artist: payload.artist,
        song_title: payload.song_title,
        source_url: payload.source_url,
        import_status: 'pending',
        ip_owner: false,
      }
      const legacyResult = await supabase
        .from('projects')
        .insert(legacyPayload as TablesInsert<'projects'>)
        .select()
        .single()
      project = legacyResult.data
      err = legacyResult.error
    }

    if (err || !project) {
      setError(err?.message ?? 'Failed to create project')
      setLoading(false)
      return
    }

    // Stash the new project so the dashboard can add it to local state
    // immediately on mount, regardless of server-render cache timing.
    sessionStorage.setItem('galaxymap_new_project', JSON.stringify(project))
    window.location.href = '/projects'
  }

  return (
    <main className="min-h-screen bg-[#f5f5f7] px-6 py-16">
      <div className="mx-auto max-w-[600px]">
        <div className="mb-10">
          <Link href="/projects" className="text-[14px] text-[#0066cc] hover:underline">
            ← Projects
          </Link>
          <h1
            className="mt-4 text-[40px] font-semibold leading-[1.10] text-[#1d1d1f]"
            style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", Helvetica, Arial, sans-serif' }}
          >
            New Project
          </h1>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl bg-white p-8 shadow-[rgba(0,0,0,0.08)_0px_2px_12px]"
        >
          <div className="space-y-6">
            <Field label="Artist" name="artist" required />
            <Field label="Song Title" name="song_title" required />
            <Field
              label="YouTube URL"
              name="source_url"
              type="url"
              required
              placeholder="https://youtube.com/watch?v=..."
            />
          </div>

          {error && (
            <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-[14px] text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-8 w-full rounded-lg bg-[#0071e3] py-3 text-[17px] text-white transition-colors hover:bg-[#0077ed] disabled:opacity-50"
          >
            {loading ? 'Creating…' : 'Create Project'}
          </button>
        </form>
      </div>
    </main>
  )
}

function isMissingOwnerUidError(message: string) {
  return message.includes("Could not find the 'owner_uid' column")
}

function Field({
  label,
  name,
  type = 'text',
  required,
  placeholder,
}: {
  label: string
  name: string
  type?: string
  required?: boolean
  placeholder?: string
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
        required={required}
        placeholder={placeholder}
        className="w-full rounded-xl bg-[#f5f5f7] px-4 py-3 text-[17px] text-[#1d1d1f] outline-none ring-2 ring-transparent placeholder:text-[rgba(0,0,0,0.28)] focus:ring-[#0071e3]"
      />
    </div>
  )
}
