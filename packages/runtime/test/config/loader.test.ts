import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadLegionConfig } from '@legion/runtime/config/loader'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'legion-cfg-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('loadLegionConfig', () => {
  test('returns empty config when .legion.yaml is absent', async () => {
    const cfg = await loadLegionConfig(dir)
    expect(cfg).toEqual({})
  })

  test('parses worktree.setup and worktree.copyFiles arrays', async () => {
    await writeFile(
      join(dir, '.legion.yaml'),
      'worktree:\n  setup:\n    - bun install\n  copyFiles:\n    - .env.local\n',
    )
    const cfg = await loadLegionConfig(dir)
    expect(cfg.worktree?.setup).toEqual(['bun install'])
    expect(cfg.worktree?.copyFiles).toEqual(['.env.local'])
  })

  test('throws on malformed yaml', async () => {
    await writeFile(join(dir, '.legion.yaml'), 'worktree:\n  setup: not-an-array\n')
    await expect(loadLegionConfig(dir)).rejects.toThrow(/setup/)
  })
})
