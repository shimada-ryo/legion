import { describe, test } from 'bun:test'
import type {
  WorkspaceProvider,
  WorkspaceCreateInput,
  WorkspaceDescriptor,
} from '@legion/runtime/workspace/provider'

describe('WorkspaceProvider contract', () => {
  test('a minimal provider satisfies the interface', () => {
    const _p = {
      create: async (_i: WorkspaceCreateInput): Promise<WorkspaceDescriptor> => ({
        ref: { kind: 'owned', path: '/x' },
        path: '/x',
      }),
      destroy: async (_d: WorkspaceDescriptor) => {},
      list: async (_w?: string): Promise<WorkspaceDescriptor[]> => [],
    } satisfies WorkspaceProvider
    void _p
  })

  test('WorkspaceCreateInput requires all 5 fields (negative case)', () => {
    // @ts-expect-error seq is required
    const _bad: WorkspaceCreateInput = {
      workflowInstanceId: 'wf',
      agentInstanceId: 'inst',
      role: 'implementer',
      baseCommitSha: 'a'.repeat(40),
    }
    void _bad
  })

  test('WorkspaceDescriptor.ref must be a WorkspaceRef (negative case)', () => {
    // @ts-expect-error ref must be a WorkspaceRef, not a string
    const _bad: WorkspaceDescriptor = { ref: 'invalid', path: '/x' }
    void _bad
  })
})
