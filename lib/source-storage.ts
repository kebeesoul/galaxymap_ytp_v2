import { createReadStream, promises as fs } from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { workspacePaths, safeWorkspaceSegment } from './workspace'

const SOURCE_KEY_PARTS = 4

export function sourceKeyUid(key: string): string {
  return parseLocalSourceKey(key).ownerUid
}

export function parseLocalSourceKey(key: string): { ownerUid: string; videoId: string; filename: string } {
  const parts = key.split('/')
  if (parts.length !== SOURCE_KEY_PARTS || parts[1] !== 'sources' || parts[2] !== 'preview') {
    throw new Error('invalid local source key')
  }

  const ownerUid = safeWorkspaceSegment(parts[0])
  const filename = safeWorkspaceSegment(parts[3])
  if (!filename.endsWith('.mp4')) {
    throw new Error('invalid local source filename')
  }

  return {
    ownerUid,
    videoId: filename.slice(0, -4),
    filename,
  }
}

export function localSourcePath(key: string): string {
  const { ownerUid, filename } = parseLocalSourceKey(key)
  return path.join(workspacePaths.ingestRoot(), ownerUid, 'sources', 'preview', filename)
}

export async function copyLocalSourceObject(key: string, destination: string): Promise<void> {
  const source = localSourcePath(key)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.copyFile(source, destination)
}

export async function removeLocalSourceObject(key: string): Promise<void> {
  await fs.rm(localSourcePath(key), { force: true })
}

export async function statLocalSourceObject(key: string): Promise<{ path: string; size: number }> {
  const source = localSourcePath(key)
  const stat = await fs.stat(source)
  if (!stat.isFile()) {
    throw new Error('local source is not a file')
  }
  return { path: source, size: stat.size }
}

export function createLocalSourcePlaybackUrl(projectId: string): string {
  return `/api/source-file?project_id=${encodeURIComponent(projectId)}`
}

export function createLocalSourceReadStream(
  key: string,
  range?: { start: number; end: number },
): NodeJS.ReadableStream {
  return createReadStream(localSourcePath(key), range)
}

export function toWebReadable(stream: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream as Readable) as ReadableStream<Uint8Array>
}
