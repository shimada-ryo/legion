import { describe, test, expect } from 'bun:test'
import {
  firstRoleNode,
  buildInitialPrompt,
} from '@legion/runtime/orchestrator/spawn-agent'
import type { WorkflowTemplate } from '@legion/core'

const TEMPLATE: WorkflowTemplate = {
  id: 'fi',
  name: 'Feature Implementation',
  nodes: [
    { type: 'trigger', id: 'trig', kind: 'manual' },
    {
      type: 'role',
      id: 'dir',
      role: 'director',
      provider: 'claude-code',
      lifetime: 'per-workflow',
    },
    {
      type: 'role',
      id: 'impl',
      role: 'implementer',
      provider: 'claude-code',
      lifetime: 'per-task',
    },
  ],
  edges: [
    { from: 'trig', to: 'dir', type: 'triggers' },
    { from: 'dir', to: 'impl', type: 'delegates' },
  ],
}

describe('firstRoleNode', () => {
  test('returns the first Role connected to a trigger', () => {
    const n = firstRoleNode(TEMPLATE)
    expect(n?.id).toBe('dir')
    expect(n?.role).toBe('director')
  })

  test('returns null if template has no Role nodes', () => {
    const empty: WorkflowTemplate = { id: 'x', name: 'x', nodes: [], edges: [] }
    expect(firstRoleNode(empty)).toBeNull()
  })

  test('falls back to first Role in document order if no trigger edge exists', () => {
    const noTrigger: WorkflowTemplate = {
      id: 'x',
      name: 'x',
      nodes: [
        {
          type: 'role',
          id: 'only',
          role: 'implementer',
          provider: 'claude-code',
          lifetime: 'per-task',
        },
      ],
      edges: [],
    }
    expect(firstRoleNode(noTrigger)?.id).toBe('only')
  })
})

describe('buildInitialPrompt', () => {
  test('embeds the user prompt and role context', () => {
    const role = TEMPLATE.nodes.find((n) => n.id === 'dir')
    if (!role || role.type !== 'role') throw new Error('test setup')
    const p = buildInitialPrompt(role, 'Add a /health endpoint.')
    expect(p).toContain('director')
    expect(p).toContain('Add a /health endpoint.')
  })
})
