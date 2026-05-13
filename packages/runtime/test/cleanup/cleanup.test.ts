import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeTempRepo, type TempRepo } from '../helpers/temp-repo'
import { LocalWorktreeProvider } from '@legion/runtime/workspace/local-worktree-provider'
import { resolveCommitSha } from '@legion/runtime/workspace/git'
import { classifyForCleanup, runCleanup } from '@legion/runtime/cleanup/cleanup'

let repo: TempRepo
let baseDir: string

beforeEach(async () => {
  repo = await makeTempRepo()
  baseDir = await mkdtemp(join(tmpdir(), 'legion-cln-'))
})

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true })
  await repo.cleanup()
})

describe('classifyForCleanup', () => {
  test('a detached worktree is safe to remove (no branch involvement)', async () => {
    const provider = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const sha = await resolveCommitSha(repo.path, 'HEAD')
    const desc = await provider.create({
      workflowInstanceId: '01j9x5z8yk0000000000000000',
      agentInstanceId: 'inst-rev',
      role: 'reviewer',
      seq: 1,
      baseCommitSha: sha,
    })
    const c = await classifyForCleanup(repo.path, desc)
    expect(c.kind).toBe('safe')
  })

  test('a branched worktree with no commits ahead is safe', async () => {
    const provider = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const sha = await resolveCommitSha(repo.path, 'HEAD')
    const desc = await provider.create({
      workflowInstanceId: '01j9x5z8yk0000000000000000',
      agentInstanceId: 'inst-impl',
      role: 'implementer',
      seq: 1,
      baseCommitSha: sha,
    })
    const c = await classifyForCleanup(repo.path, desc)
    expect(c.kind).toBe('safe')
  })

  test('a branched worktree with unmerged commits requires confirmation', async () => {
    const provider = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const sha = await resolveCommitSha(repo.path, 'HEAD')
    const desc = await provider.create({
      workflowInstanceId: '01j9x5z8yk0000000000000000',
      agentInstanceId: 'inst-impl',
      role: 'implementer',
      seq: 1,
      baseCommitSha: sha,
    })
    const { $ } = await import('bun')
    await $`git config user.email t@t.local`.cwd(desc.path).quiet()
    await $`git config user.name t`.cwd(desc.path).quiet()
    await Bun.write(join(desc.path, 'change.txt'), 'modified\n')
    await $`git add change.txt`.cwd(desc.path).quiet()
    await $`git commit -m work`.cwd(desc.path).quiet()
    const c = await classifyForCleanup(repo.path, desc)
    expect(c.kind).toBe('confirm-required')
    if (c.kind === 'confirm-required') {
      expect(c.reason).toMatch(/unmerged|commits/i)
    }
  })
})

describe('runCleanup', () => {
  test('removes safe worktrees and skips confirm-required ones in safe-only mode', async () => {
    const provider = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const sha = await resolveCommitSha(repo.path, 'HEAD')
    await provider.create({
      workflowInstanceId: '01j9x5z8yk0000000000000000',
      agentInstanceId: 'safe',
      role: 'reviewer',
      seq: 1,
      baseCommitSha: sha,
    })
    const result = await runCleanup({
      provider,
      repoPath: repo.path,
      mode: 'safe-only',
    })
    expect(result.removed.length).toBe(1)
    expect(result.skipped.length).toBe(0)
  })
})
