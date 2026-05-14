import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { $ } from 'bun'
import { makeTempRepo, type TempRepo } from '../helpers/temp-repo'
import { LocalWorktreeProvider } from '@legion/runtime/workspace/local-worktree-provider'
import { resolveCommitSha } from '@legion/runtime/workspace/git'

let repo: TempRepo
let baseDir: string

beforeEach(async () => {
  repo = await makeTempRepo()
  baseDir = await mkdtemp(join(tmpdir(), 'legion-wt-'))
})

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true })
  await repo.cleanup()
})

describe('LocalWorktreeProvider.create', () => {
  test('creates a branched worktree for Implementer role', async () => {
    const provider = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const sha = await resolveCommitSha(repo.path, 'HEAD')
    const desc = await provider.create({
      workflowInstanceId: '01j9x5z8yk0000000000000000',
      agentInstanceId: 'inst-impl-a',
      role: 'implementer',
      seq: 1,
      baseCommitSha: sha,
    })
    expect(desc.ref).toEqual({
      kind: 'owned',
      path: desc.path,
      branch: 'legion/01j9x5z8/impl-1',
    })
    // README.md from temp-repo should be present in the worktree
    const exists = await Bun.file(join(desc.path, 'README.md')).exists()
    expect(exists).toBe(true)
  })

  test('creates a detached worktree for Director role', async () => {
    const provider = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const sha = await resolveCommitSha(repo.path, 'HEAD')
    const desc = await provider.create({
      workflowInstanceId: '01j9x5z8yk0000000000000000',
      agentInstanceId: 'inst-dir',
      role: 'director',
      seq: 1,
      baseCommitSha: sha,
    })
    expect(desc.ref.kind).toBe('owned')
    // detached: no branch
    expect((desc.ref as { branch?: string }).branch).toBeUndefined()
  })

  test('creates a detached worktree for Reviewer role', async () => {
    const provider = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const sha = await resolveCommitSha(repo.path, 'HEAD')
    const desc = await provider.create({
      workflowInstanceId: '01j9x5z8yk0000000000000000',
      agentInstanceId: 'inst-rev',
      role: 'reviewer',
      seq: 1,
      baseCommitSha: sha,
    })
    expect(desc.ref.kind).toBe('owned')
    expect((desc.ref as { branch?: string }).branch).toBeUndefined()
  })
})

describe('LocalWorktreeProvider.destroy', () => {
  test('removes a previously created worktree', async () => {
    const provider = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const sha = await resolveCommitSha(repo.path, 'HEAD')
    const desc = await provider.create({
      workflowInstanceId: '01j9x5z8yk0000000000000000',
      agentInstanceId: 'inst-x',
      role: 'implementer',
      seq: 1,
      baseCommitSha: sha,
    })
    await provider.destroy(desc)
    const remaining = await provider.list('01j9x5z8yk0000000000000000')
    expect(remaining.map((w) => w.path)).not.toContain(desc.path)
  })

  test('is idempotent: calling destroy twice does not throw', async () => {
    const provider = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const sha = await resolveCommitSha(repo.path, 'HEAD')
    const desc = await provider.create({
      workflowInstanceId: '01j9x5z8yk0000000000000000',
      agentInstanceId: 'inst-y',
      role: 'implementer',
      seq: 1,
      baseCommitSha: sha,
    })
    await provider.destroy(desc)
    await provider.destroy(desc) // second call: no-op
  })
})

describe('LocalWorktreeProvider.list', () => {
  test('lists only worktrees under the given workflow instance', async () => {
    const provider = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const sha = await resolveCommitSha(repo.path, 'HEAD')
    await provider.create({
      workflowInstanceId: '01j9x5z8yk0000000000000000',
      agentInstanceId: 'inst-a',
      role: 'implementer',
      seq: 1,
      baseCommitSha: sha,
    })
    await provider.create({
      workflowInstanceId: '01j9other999000000000000000',
      agentInstanceId: 'inst-b',
      role: 'implementer',
      seq: 1,
      baseCommitSha: sha,
    })
    const list = await provider.list('01j9x5z8yk0000000000000000')
    expect(list.length).toBe(1)
  })
})

describe('LocalWorktreeProvider.create — reviewTargetBranch (Phase 3)', () => {
  test('creates reviewer worktree detached at reviewTargetBranch when provided', async () => {
    // Create a feature branch with an extra commit beyond main
    await $`git checkout -b feature/x`.cwd(repo.path).quiet()
    await Bun.write(`${repo.path}/edit.txt`, 'change')
    await $`git add -A`.cwd(repo.path).quiet()
    await $`git -c user.email=test@legion.local -c user.name="legion test" commit -m "feature change"`.cwd(repo.path).quiet()
    const featureTip = (await $`git rev-parse feature/x`.cwd(repo.path).text()).trim()
    await $`git checkout main`.cwd(repo.path).quiet()
    const mainSha = (await $`git rev-parse HEAD`.cwd(repo.path).text()).trim()

    const provider = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const desc = await provider.create({
      workflowInstanceId: '01j9x5z8yk0000000000000000',
      agentInstanceId: 'inst-rev-branch',
      role: 'reviewer',
      seq: 1,
      baseCommitSha: mainSha,
      reviewTargetBranch: 'feature/x',
    })

    // worktree HEAD must equal feature/x tip (not baseCommitSha=main)
    const head = (await $`git rev-parse HEAD`.cwd(desc.path).text()).trim()
    expect(head).toBe(featureTip)
    expect(head).not.toBe(mainSha)

    await provider.destroy(desc)
  })

  test('falls back to baseCommitSha for reviewer when reviewTargetBranch is undefined', async () => {
    const baseSha = await resolveCommitSha(repo.path, 'HEAD')
    const provider = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })

    const desc = await provider.create({
      workflowInstanceId: '01j9x5z8yk0000000000000000',
      agentInstanceId: 'inst-rev-fallback',
      role: 'reviewer',
      seq: 1,
      baseCommitSha: baseSha,
      // reviewTargetBranch is undefined
    })

    const head = (await $`git rev-parse HEAD`.cwd(desc.path).text()).trim()
    expect(head).toBe(baseSha)

    await provider.destroy(desc)
  })
})
