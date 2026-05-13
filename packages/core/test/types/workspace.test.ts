import { describe, test, expect } from 'bun:test'
import type { WorkspaceRef } from '@legion/core'

describe('WorkspaceRef type', () => {
  test('owned variant accepts path and optional branch', () => {
    const ref: WorkspaceRef = {
      kind: 'owned',
      path: '/tmp/wt',
      branch: 'legion/wf01j9x/impl-1',
    }
    expect(ref.kind).toBe('owned')
  })

  test('owned variant allows omitting branch (detached)', () => {
    const ref: WorkspaceRef = { kind: 'owned', path: '/tmp/wt' }
    expect(ref.kind).toBe('owned')
  })

  test('shared variant has targetInstanceId and mode', () => {
    const ref: WorkspaceRef = {
      kind: 'shared',
      targetInstanceId: 'inst-1',
      mode: 'ro',
    }
    expect(ref.kind).toBe('shared')
  })
})
