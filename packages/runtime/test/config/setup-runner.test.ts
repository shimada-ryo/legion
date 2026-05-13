import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runWorktreeSetup } from '@legion/runtime/config/setup-runner'

let mainRepo: string
let worktree: string

beforeEach(async () => {
  mainRepo = await mkdtemp(join(tmpdir(), 'legion-setup-main-'))
  worktree = await mkdtemp(join(tmpdir(), 'legion-setup-wt-'))
})

afterEach(async () => {
  await rm(mainRepo, { recursive: true, force: true })
  await rm(worktree, { recursive: true, force: true })
})

describe('runWorktreeSetup', () => {
  test('copies files listed in copyFiles from main repo to worktree', async () => {
    await writeFile(join(mainRepo, '.env.local'), 'KEY=value\n')
    await runWorktreeSetup({
      mainRepoPath: mainRepo,
      worktreePath: worktree,
      config: { worktree: { copyFiles: ['.env.local'] } },
    })
    const copied = await readFile(join(worktree, '.env.local'), 'utf-8')
    expect(copied).toBe('KEY=value\n')
  })

  test('runs each setup command in worktree cwd', async () => {
    // Use a cross-platform command: write a file via Bun shell echo redirect.
    // Bun shell on Windows uses its own POSIX-like parser, so redirects work.
    await runWorktreeSetup({
      mainRepoPath: mainRepo,
      worktreePath: worktree,
      config: { worktree: { setup: ['echo hello > marker.txt'] } },
    })
    const marker = await readFile(join(worktree, 'marker.txt'), 'utf-8')
    expect(marker.trim()).toBe('hello')
  })

  test('throws when a setup command exits non-zero', async () => {
    await expect(
      runWorktreeSetup({
        mainRepoPath: mainRepo,
        worktreePath: worktree,
        config: { worktree: { setup: ['exit 1'] } },
      }),
    ).rejects.toThrow()
  })

  test('is a no-op when worktree section is empty', async () => {
    await runWorktreeSetup({
      mainRepoPath: mainRepo,
      worktreePath: worktree,
      config: {},
    })
    // No assertion needed — completing without error is the success criterion.
  })

  test('missing copyFiles source raises a clear error', async () => {
    await expect(
      runWorktreeSetup({
        mainRepoPath: mainRepo,
        worktreePath: worktree,
        config: { worktree: { copyFiles: ['.env.missing'] } },
      }),
    ).rejects.toThrow(/\.env\.missing/)
  })
})
