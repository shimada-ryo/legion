import { describe, test } from 'bun:test'
import type { LegionConfig } from '@legion/core'

// These are type-level assertions. They have no runtime body — the tests pass
// iff the test file type-checks, and fail iff a future change weakens the
// LegionConfig contract. Run `bun run --filter @legion/core typecheck` to verify.

describe('LegionConfig contract', () => {
  test('empty config is valid', () => {
    const cfg = {} satisfies LegionConfig
    void cfg
  })

  test('config with worktree.setup array compiles', () => {
    const cfg = { worktree: { setup: ['npm install'] } } satisfies LegionConfig
    void cfg
  })

  test('config with worktree.copyFiles array compiles', () => {
    const cfg = { worktree: { copyFiles: ['.env'] } } satisfies LegionConfig
    void cfg
  })

  test('config with worktree.ports as empty record compiles (reserved)', () => {
    const cfg = { worktree: { ports: {} } } satisfies LegionConfig
    void cfg
  })

  test('config with worktree.setup + copyFiles + ports together compiles', () => {
    const cfg = {
      worktree: {
        setup: ['npm install', 'npm run build'],
        copyFiles: ['.env', '.env.local'],
        ports: { web: 3000 },
      },
    } satisfies LegionConfig
    void cfg
  })

  test('worktree.setup with non-string element rejected (negative case)', () => {
    // @ts-expect-error setup must be string[]
    const _bad: LegionConfig = { worktree: { setup: [42] } }
    void _bad
  })

  test('worktree.copyFiles with non-string element rejected (negative case)', () => {
    // @ts-expect-error copyFiles must be string[]
    const _bad: LegionConfig = { worktree: { copyFiles: [true] } }
    void _bad
  })

  test('worktree as a primitive is rejected (negative case)', () => {
    // @ts-expect-error worktree must be an object, not a primitive
    const _bad: LegionConfig = { worktree: 'no' }
    void _bad
  })
})
