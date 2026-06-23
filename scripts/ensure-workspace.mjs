import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(process.env.STORAGE_ROOT ?? path.join(process.cwd(), 'workspace'))
const dirs = [
  'ingest',
  'renders',
  'renders/tmp',
  'exports',
  'cache',
]

await Promise.all(dirs.map((dir) => mkdir(path.join(root, dir), { recursive: true })))
console.log(`[workspace] ready ${root}`)
