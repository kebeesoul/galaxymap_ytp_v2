'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { TablesInsert } from '@/lib/supabase/types'

type LegacyProjectInsert = Omit<TablesInsert<'projects'>, 'owner_uid'>

export default function SelectPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [artist, setArtist] = useState('')
  const [songTitle, setSongTitle] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setArtist(params.get('artist') ?? '')
    setSongTitle(params.get('song_title') ?? '')
    setSourceUrl(params.get('source_url') ?? '')
  }, [])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')

    const form = event.currentTarget
    const currentSourceUrl = (form.elements.namedItem('source_url') as HTMLInputElement).value.trim()
    const currentArtist = (form.elements.namedItem('artist') as HTMLInputElement).value.trim()
    const currentSongTitle = (form.elements.namedItem('song_title') as HTMLInputElement).value.trim()
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
      artist: currentArtist,
      song_title: currentSongTitle,
      source_url: currentSourceUrl,
      import_status: 'pending',
      ip_owner: false,
    }

    let { data: project, error: insertError } = await supabase
      .from('projects')
      .insert(payload)
      .select('id')
      .single()

    if (insertError && isMissingOwnerUidError(insertError.message)) {
      const legacyPayload: LegacyProjectInsert = {
        artist: currentArtist,
        song_title: currentSongTitle,
        source_url: currentSourceUrl,
        import_status: 'pending',
        ip_owner: false,
      }
      const legacyResult = await supabase
        .from('projects')
        .insert(legacyPayload as TablesInsert<'projects'>)
        .select('id')
        .single()
      project = legacyResult.data
      insertError = legacyResult.error
    }

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
            <Field label="Artist" name="artist" value={artist} onChange={setArtist} required />
            <Field label="Song Title" name="song_title" value={songTitle} onChange={setSongTitle} required />
            <Field
              label="YouTube URL"
              name="source_url"
              type="url"
              value={sourceUrl}
              onChange={setSourceUrl}
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
  value,
  onChange,
  type = 'text',
  required,
  placeholder,
}: {
  label: string
  name: string
  value: string
  onChange: (value: string) => void
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
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        placeholder={placeholder}
        className="w-full rounded-lg bg-[#f5f5f7] px-4 py-3 text-[17px] text-[#1d1d1f] outline-none ring-2 ring-transparent placeholder:text-[rgba(0,0,0,0.28)] focus:ring-[#0071e3]"
      />
    </div>
  )
}

function isMissingOwnerUidError(message: string) {
  return message.includes("Could not find the 'owner_uid' column")
}
