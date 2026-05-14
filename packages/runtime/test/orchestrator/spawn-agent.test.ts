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
    const p = buildInitialPrompt({ role: 'director', userPrompt: 'Add a /health endpoint.' })
    expect(p.toLowerCase()).toContain('director')
    expect(p).toContain('Add a /health endpoint.')
  })

  test('prepends the director system prompt', () => {
    const p = buildInitialPrompt({ role: 'director', userPrompt: 'do X' })
    expect(p).toContain('You are the Director agent')
    expect(p).toContain('Task: do X')
  })

  test('prepends the implementer system prompt', () => {
    const p = buildInitialPrompt({ role: 'implementer', userPrompt: 'do Y' })
    expect(p).toContain('You are an Implementer agent')
  })

  test('falls back to a generic line for unknown roles', () => {
    expect(buildInitialPrompt({ role: 'xyz', userPrompt: 'do Z' })).toContain('"xyz"')
  })
})
