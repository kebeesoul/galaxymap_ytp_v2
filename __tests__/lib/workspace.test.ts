import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  assertInsideWorkspace,
  createWorkspacePaths,
  resolveWorkspaceRoot,
  safeWorkspaceSegment,
} from '@/lib/workspace'

describe('workspace paths', () => {
  it('defaults to a repo-local workspace directory', () => {
    expect(resolveWorkspaceRoot({}, '/repo')).toBe(path.resolve('/repo/workspace'))
  })

  it('uses STORAGE_ROOT when configured', () => {
    expect(resolveWorkspaceRoot({ STORAGE_ROOT: './custom-workspace' }, '/repo')).toBe(
      path.resolve('/repo/custom-workspace'),
    )
  })

  it('keeps ingest, render temp, and export files under the workspace root', () => {
    const paths = createWorkspacePaths('/repo/workspace')

    expect(paths.ingestSourcePath('user-1', 'video-1')).toBe(
      path.resolve('/repo/workspace/ingest/user-1/sources/preview/video-1.mp4'),
    )
    expect(paths.renderJobOutputFile('clip-1')).toBe(
      path.resolve('/repo/workspace/renders/tmp/clip-1/output.mp4'),
    )
    expect(paths.exportFile('project-1', 'final.mp4')).toBe(
      path.resolve('/repo/workspace/exports/project-1/final.mp4'),
    )
  })

  it('rejects unsafe path segments and paths outside workspace', () => {
    expect(() => safeWorkspaceSegment('../escape')).toThrow('invalid workspace path segment')
    expect(() => assertInsideWorkspace('/repo/other/file.mp4', '/repo/workspace')).toThrow(
      'path outside workspace',
    )
  })
})
