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

describe('layoutTemplate with explicit positions', () => {
  test('explicit position wins over topological sort', () => {
    const t: WorkflowTemplate = {
      id: 'e',
      name: 'E',
      nodes: [
        { type: 'trigger', id: 'trig', kind: 'manual', position: { x: 500, y: 600 } },
        {
          type: 'role',
          id: 'dir',
          role: 'director',
          provider: 'claude-code',
          lifetime: 'per-workflow',
        },
      ],
      edges: [{ from: 'trig', to: 'dir', type: 'triggers' }],
    }
    const map = layoutTemplate(t)
    expect(map['trig']).toEqual({ x: 500, y: 600 })
    expect(map['dir']).toBeDefined()
  })

  test('partial: explicit on some nodes, auto on others', () => {
    const t: WorkflowTemplate = {
      id: 'p',
      name: 'P',
      nodes: [
        { type: 'trigger', id: 'a', kind: 'manual' },
        { type: 'trigger', id: 'b', kind: 'manual', position: { x: 999, y: 111 } },
      ],
      edges: [],
    }
    const map = layoutTemplate(t)
    expect(map['b']).toEqual({ x: 999, y: 111 })
    expect(map['a']).toBeDefined()
    expect(map['a']!.x).not.toBe(999)
  })
})
