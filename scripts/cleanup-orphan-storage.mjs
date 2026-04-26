#!/usr/bin/env node
/**
 * One-shot orphan-storage cleanup.
 *
 *   node scripts/cleanup-orphan-storage.mjs            # dry-run (default)
 *   node scripts/cleanup-orphan-storage.mjs --apply    # actually delete
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY from
 * .env.local at the repo root. Lists every file in the `sources` and
 * `renders` buckets, cross-checks against projects.yt_source_path,
 * clips.bgm_url, and clips.render_path in the DB, and removes anything
 * that is no longer referenced.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV_PATH = path.join(REPO_ROOT, '.env.local')

if (existsSync(ENV_PATH)) {
  for (const line of readFileSync(ENV_PATH, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing Supabase credentials. Make sure .env.local has')
  console.error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  process.exit(1)
}

const apply = process.argv.includes('--apply')
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function listAllFiles(bucket, prefix = '') {
  const out = []
  async function walk(p) {
    const { data, error } = await supabase.storage.from(bucket).list(p, { limit: 1000 })
    if (error) {
      console.error(`  list error (${bucket}/${p}): ${error.message}`)
      return
    }
    for (const item of data ?? []) {
      const full = p ? `${p}/${item.name}` : item.name
      // Folders have id === null in Supabase storage list
      if (item.id === null) await walk(full)
      else out.push(full)
    }
  }
  await walk(prefix)
  return out
}

async function removeInChunks(bucket, paths) {
  const CHUNK = 100
  let removed = 0
  for (let i = 0; i < paths.length; i += CHUNK) {
    const batch = paths.slice(i, i + CHUNK)
    const { error } = await supabase.storage.from(bucket).remove(batch)
    if (error) {
      console.error(`  remove error (${bucket}): ${error.message}`)
    } else {
      removed += batch.length
    }
  }
  return removed
}

async function main() {
  console.log(apply ? 'Mode: APPLY — files will be deleted' : 'Mode: dry-run (pass --apply to actually delete)')
  console.log('')

  const [{ data: projects, error: pErr }, { data: clips, error: cErr }] = await Promise.all([
    supabase.from('projects').select('id, yt_source_path'),
    supabase.from('clips').select('id, bgm_url, render_path'),
  ])
  if (pErr || cErr) {
    console.error('DB query failed:', pErr?.message ?? cErr?.message)
    process.exit(1)
  }

  const sourcesReferenced = new Set()
  for (const p of projects ?? []) {
    if (p.yt_source_path) sourcesReferenced.add(p.yt_source_path)
  }
  for (const c of clips ?? []) {
    if (c.bgm_url) sourcesReferenced.add(`bgm/${c.id}.mp3`)
  }

  const rendersReferenced = new Set()
  for (const c of clips ?? []) {
    if (c.render_path) rendersReferenced.add(c.render_path)
  }

  const sourcesActual = await listAllFiles('sources')
  const rendersActual = await listAllFiles('renders')

  console.log(`sources bucket: ${sourcesActual.length} files (${sourcesReferenced.size} referenced in DB)`)
  console.log(`renders bucket: ${rendersActual.length} files (${rendersReferenced.size} referenced in DB)`)
  console.log('')

  const sourcesOrphans = sourcesActual.filter(p => !sourcesReferenced.has(p))
  const rendersOrphans = rendersActual.filter(p => !rendersReferenced.has(p))

  if (sourcesOrphans.length === 0 && rendersOrphans.length === 0) {
    console.log('No orphans found — storage is clean.')
    return
  }

  console.log(`Orphan files (${sourcesOrphans.length + rendersOrphans.length} total):`)
  for (const p of sourcesOrphans) console.log(`  sources/${p}`)
  for (const p of rendersOrphans) console.log(`  renders/${p}`)
  console.log('')

  if (!apply) {
    console.log('Re-run with --apply to delete the files listed above.')
    return
  }

  const removedSources = await removeInChunks('sources', sourcesOrphans)
  const removedRenders = await removeInChunks('renders', rendersOrphans)
  console.log(`Removed: sources=${removedSources}, renders=${removedRenders}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
