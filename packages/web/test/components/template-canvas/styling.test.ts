import { describe, test, expect } from 'bun:test'
import {
  nodeStyleFor,
  edgeStyleFor,
} from '../../../src/components/template-canvas/styling'
import type { TemplateNode } from '@legion/core'

describe('nodeStyleFor', () => {
  test('returns distinct border color per node type', () => {
    const r = nodeStyleFor({
      type: 'role',
      id: 'x',
      role: 'director',
      provider: 'p',
      lifetime: 'per-task',
    } satisfies TemplateNode)
    const t = nodeStyleFor({ type: 'trigger', id: 'x', kind: 'manual' } satisfies TemplateNode)
    const b = nodeStyleFor({ type: 'blackboard', id: 'x', schema: {} } satisfies TemplateNode)
    const h = nodeStyleFor({ type: 'human-gate', id: 'x', label: 'L' } satisfies TemplateNode)
    const s = nodeStyleFor({ type: 'sink', id: 'x', kind: 'github-pr' } satisfies TemplateNode)
    const borders = [r.border, t.border, b.border, h.border, s.border]
    expect(new Set(borders).size).toBe(5)
  })

  test('role node style includes role name in label', () => {
    const s = nodeStyleFor({
      type: 'role',
      id: 'r1',
      role: 'implementer',
      provider: 'claude-code',
      lifetime: 'per-task',
    } satisfies TemplateNode)
    expect(s.label).toContain('implementer')
  })
})

describe('edgeStyleFor', () => {
  test('different edge types get different colors', () => {
    const a = edgeStyleFor('triggers')
    const b = edgeStyleFor('delegates')
    const c = edgeStyleFor('publishes')
    expect(new Set([a.stroke, b.stroke, c.stroke]).size).toBe(3)
  })

  test('triggers edge is animated for visibility', () => {
    expect(edgeStyleFor('triggers').animated).toBe(true)
  })
})
