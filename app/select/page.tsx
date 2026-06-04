'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { TablesInsert } from '@/lib/supabase/types'

export default function SelectPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')

    const form = event.currentTarget
    const sourceUrl = (form.elements.namedItem('source_url') as HTMLInputElement).value.trim()
    const artist = (form.elements.namedItem('artist') as HTMLInputElement).value.trim()
    const songTitle = (form.elements.namedItem('song_title') as HTMLInputElement).value.trim()
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
      artist,
      song_title: songTitle,
      source_url: sourceUrl,
      import_status: 'pending',
      ip_owner: false,
    }

    const { data: project, error: insertError } = await supabase
      .from('projects')
      .insert(payload)
      .select('id')
      .single()

    if (insertError || !project) {
      setError(insertError?.message ?? 'Failed to create project')
      setLoading(false)
      return
    }

    router.push(`/editor/${project.id}`)
    router.refresh()
  }

  return (
    <main className="min-h-screen bg-[#f5f5f7] px-6 py-16">
      <div className="mx-auto max-w-[680px]">
        <div className="mb-10">
          <p className="text-[12px] text-[rgba(0,0,0,0.48)]">Select</p>
          <h1
            className="mt-2 text-[40px] font-semibold leading-[1.10] text-[#1d1d1f]"
            style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", Helvetica, Arial, sans-serif' }}
          >
            Add YouTube Source
          </h1>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-lg bg-white p-8 shadow-[rgba(0,0,0,0.08)_0px_2px_12px]"
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
            <p className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-[14px] text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-8 w-full rounded-lg bg-[#0071e3] py-3 text-[17px] text-white transition-colors hover:bg-[#0077ed] disabled:opacity-50"
          >
            {loading ? 'Queueing…' : 'Create Project'}
          </button>
        </form>
      </div>
    </main>
  )
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
        className="w-full rounded-lg bg-[#f5f5f7] px-4 py-3 text-[17px] text-[#1d1d1f] outline-none ring-2 ring-transparent placeholder:text-[rgba(0,0,0,0.28)] focus:ring-[#0071e3]"
      />
    </div>
  )
}
