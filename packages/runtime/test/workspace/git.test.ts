import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeTempRepo, type TempRepo } from '../helpers/temp-repo'
import {
  resolveCommitSha,
  worktreeAdd,
  worktreeRemove,
  worktreeList,
  branchExists,
  branchDelete,
} from '@legion/runtime/workspace/git'

let repo: TempRepo

beforeEach(async () => {
  repo = await makeTempRepo()
})

afterEach(async () => {
  await repo.cleanup()
})

describe('resolveCommitSha', () => {
  test('resolves HEAD to a 40-char SHA', async () => {
    const sha = await resolveCommitSha(repo.path, 'HEAD')
    expect(sha).toMatch(/^[a-f0-9]{40}$/)
  })

  test('resolves main branch to same SHA as HEAD', async () => {
    const a = await resolveCommitSha(repo.path, 'HEAD')
    const b = await resolveCommitSha(repo.path, 'main')
    expect(a).toBe(b)
  })
})

describe('worktreeAdd / worktreeRemove / worktreeList', () => {
  test('adds and removes a detached worktree', async () => {
    // Use a dedicated mkdtemp directory so each test run gets a unique path and
    // avoids collisions when the shared Temp\ sibling path already exists
    // (Windows does not delete directories that git has registered as worktrees
    // until they are pruned). The plan explicitly permits this fallback.
    const wtBase = await mkdtemp(join(tmpdir(), 'legion-wt-'))
    const wtPath = join(wtBase, 'wt-detached')
    try {
      const sha = await resolveCommitSha(repo.path, 'HEAD')
      await worktreeAdd(repo.path, { path: wtPath, commit: sha, detach: true })
      const list = await worktreeList(repo.path)
      expect(list.some((w) => w.path === wtPath)).toBe(true)
      await worktreeRemove(repo.path, wtPath)
      const after = await worktreeList(repo.path)
      expect(after.some((w) => w.path === wtPath)).toBe(false)
    } finally {
      await rm(wtBase, { recursive: true, force: true })
    }
  })

  test('adds a branched worktree on a new branch', async () => {
    const wtBase = await mkdtemp(join(tmpdir(), 'legion-wt-'))
    const wtPath = join(wtBase, 'wt-branched')
    try {
      const sha = await resolveCommitSha(repo.path, 'HEAD')
      await worktreeAdd(repo.path, {
        path: wtPath,
        commit: sha,
        branch: 'legion/test01/impl-1',
      })
      expect(await branchExists(repo.path, 'legion/test01/impl-1')).toBe(true)
      await worktreeRemove(repo.path, wtPath)
      await branchDelete(repo.path, 'legion/test01/impl-1')
      expect(await branchExists(repo.path, 'legion/test01/impl-1')).toBe(false)
    } finally {
      await rm(wtBase, { recursive: true, force: true })
    }
  })
})
