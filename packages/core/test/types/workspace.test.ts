import { describe, test } from 'bun:test'
import type { WorkspaceRef } from '@legion/core'

// These are type-level assertions. They have no runtime body — the tests pass
// iff the test file type-checks, and fail iff a future change weakens the
// WorkspaceRef contract. Run `bun run --filter @legion/core typecheck` to verify.

describe('WorkspaceRef contract', () => {
  test('owned variant accepts path and optional branch', () => {
    const a = { kind: 'owned', path: '/tmp/wt', branch: 'b' } satisfies WorkspaceRef
    const b = { kind: 'owned', path: '/tmp/wt' } satisfies WorkspaceRef
    void a; void b
  })

  test('shared variant accepts targetInstanceId and mode', () => {
    const a = { kind: 'shared', targetInstanceId: 'inst-1', mode: 'ro' } satisfies WorkspaceRef
    const b = { kind: 'shared', targetInstanceId: 'inst-1', mode: 'rw' } satisfies WorkspaceRef
    void a; void b
  })

  test('owned requires path (negative case)', () => {
    // @ts-expect-error path is required on owned
    const _bad: WorkspaceRef = { kind: 'owned' }
    void _bad
  })

  test('owned rejects extra fields when narrowed (negative case)', () => {
    // @ts-expect-error shared has no path field — the type system must catch this
    const _bad: WorkspaceRef = { kind: 'shared', targetInstanceId: 'i', mode: 'ro', path: '/x' }
    void _bad
  })

  test('shared mode is limited to ro | rw (negative case)', () => {
    // @ts-expect-error invalid mode literal
    const _bad: WorkspaceRef = { kind: 'shared', targetInstanceId: 'i', mode: 'rwx' }
    void _bad
  })
})
