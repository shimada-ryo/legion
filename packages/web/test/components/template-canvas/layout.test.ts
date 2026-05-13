import { describe, test, expect } from 'bun:test'
import { layoutTemplate } from '../../../src/components/template-canvas/layout'
import type { WorkflowTemplate } from '@legion/core'

const T: WorkflowTemplate = {
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
    {
      type: 'role',
      id: 'rev',
      role: 'reviewer',
      provider: 'claude-code',
      lifetime: 'per-task',
    },
  ],
  edges: [
    { from: 'trig', to: 'dir', type: 'triggers' },
    { from: 'dir', to: 'impl', type: 'delegates' },
    { from: 'impl', to: 'rev', type: 'reviews' },
  ],
}

describe('layoutTemplate', () => {
  test('places trigger at left (column 0)', () => {
    const map = layoutTemplate(T)
    expect(map['trig']?.x).toBe(0)
  })

  test('director at column 1, implementer at column 2, reviewer at column 3', () => {
    const map = layoutTemplate(T)
    expect(map['dir']?.x).toBeGreaterThan(map['trig']!.x)
    expect(map['impl']?.x).toBeGreaterThan(map['dir']!.x)
    expect(map['rev']?.x).toBeGreaterThan(map['impl']!.x)
  })

  test('orphan nodes (no edges) get position (0, large-y)', () => {
    const t: WorkflowTemplate = {
      id: 'o',
      name: 'O',
      nodes: [
        {
          type: 'role',
          id: 'lonely',
          role: 'x',
          provider: 'p',
          lifetime: 'per-task',
        },
      ],
      edges: [],
    }
    const map = layoutTemplate(t)
    expect(map['lonely']).toBeDefined()
  })
})
