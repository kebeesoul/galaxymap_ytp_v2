import { promises as fs } from 'fs'
import path from 'path'

export const DEFAULT_WORKSPACE_DIR = 'workspace'

export interface WorkspacePaths {
  root: string
  ingestRoot: () => string
  ingestSourcePath: (ownerUid: string, videoId: string) => string
  rendersRoot: () => string
  renderTmpRoot: () => string
  renderJobDir: (clipId: string) => string
  renderJobSourceFile: (clipId: string, filename: string) => string
  renderJobOutputFile: (clipId: string) => string
  exportRoot: () => string
  exportProjectDir: (projectId: string) => string
  exportFile: (projectId: string, filename: string) => string
  cacheRoot: () => string
}

export function resolveWorkspaceRoot(
  env: { readonly [key: string]: string | undefined } = process.env,
  cwd: string = process.cwd(),
): string {
  return path.resolve(cwd, env.STORAGE_ROOT ?? DEFAULT_WORKSPACE_DIR)
}

export function safeWorkspaceSegment(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error('invalid workspace path segment')
  }
  const normalized = trimmed.replace(/[:*?"<>|]/g, '_')
  return normalized
}

export function assertInsideWorkspace(targetPath: string, root = workspacePaths.root): void {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(targetPath)
  const relative = path.relative(resolvedRoot, resolvedTarget)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`path outside workspace: ${resolvedTarget}`)
  }
}

export function createWorkspacePaths(root = resolveWorkspaceRoot()): WorkspacePaths {
  const resolvedRoot = path.resolve(root)
  const joinInside = (...parts: string[]) => {
    const target = path.join(resolvedRoot, ...parts)
    assertInsideWorkspace(target, resolvedRoot)
    return target
  }

  return {
    root: resolvedRoot,
    ingestRoot: () => joinInside('ingest'),
    ingestSourcePath: (ownerUid, videoId) =>
      joinInside(
        'ingest',
        safeWorkspaceSegment(ownerUid),
        'sources',
        'preview',
        `${safeWorkspaceSegment(videoId)}.mp4`,
      ),
    rendersRoot: () => joinInside('renders'),
    renderTmpRoot: () => joinInside('renders', 'tmp'),
    renderJobDir: (clipId) => joinInside('renders', 'tmp', safeWorkspaceSegment(clipId)),
    renderJobSourceFile: (clipId, filename) =>
      joinInside('renders', 'tmp', safeWorkspaceSegment(clipId), 'source', safeWorkspaceSegment(filename)),
    renderJobOutputFile: (clipId) =>
      joinInside('renders', 'tmp', safeWorkspaceSegment(clipId), 'output.mp4'),
    exportRoot: () => joinInside('exports'),
    exportProjectDir: (projectId) => joinInside('exports', safeWorkspaceSegment(projectId)),
    exportFile: (projectId, filename) =>
      joinInside('exports', safeWorkspaceSegment(projectId), safeWorkspaceSegment(filename)),
    cacheRoot: () => joinInside('cache'),
  }
}

export const workspacePaths = createWorkspacePaths()

export async function ensureWorkspaceLayout(paths: WorkspacePaths = workspacePaths): Promise<void> {
  await Promise.all([
    paths.ingestRoot(),
    paths.rendersRoot(),
    paths.renderTmpRoot(),
    paths.exportRoot(),
    paths.cacheRoot(),
  ].map((dir) => fs.mkdir(dir, { recursive: true })))
}
