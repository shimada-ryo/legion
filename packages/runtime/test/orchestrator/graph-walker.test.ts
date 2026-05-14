import { describe, test, expect } from 'bun:test'
import {
  resolveTriggerTargets,
  resolveDelegateTargets,
} from '@legion/runtime/orchestrator/graph-walker'
import type { WorkflowTemplate } from '@legion/core'

const TEMPLATE: WorkflowTemplate = {
  id: 'feature-implementation',
  name: 'Feature Implementation',
  nodes: [
    { type: 'trigger', id: 'trigger', kind: 'manual' },
    { type: 'role', id: 'director', role: 'director', provider: 'claude-code', lifetime: 'per-workflow' },
    { type: 'role', id: 'implementer', role: 'implementer', provider: 'claude-code', lifetime: 'per-task' },
    { type: 'role', id: 'reviewer', role: 'reviewer', provider: 'codex', lifetime: 'per-task' },
  ],
  edges: [
    { from: 'trigger', to: 'director', type: 'triggers' },
    { from: 'director', to: 'implementer', type: 'delegates' },
    { from: 'implementer', to: 'reviewer', type: 'reviews' },
  ],
}

describe('resolveTriggerTargets', () => {
  test('returns the role nodes connected from trigger nodes via triggers edges', () => {
    const out = resolveTriggerTargets(TEMPLATE)
    expect(out.map((n) => n.id)).toEqual(['director'])
  })

  test('returns empty when no trigger edges exist', () => {
    const t: WorkflowTemplate = {
      ...TEMPLATE,
      edges: [],
    }
    expect(resolveTriggerTargets(t)).toEqual([])
  })

  test('ignores non-role targets of trigger edges (defensive)', () => {
    const t: WorkflowTemplate = {
      id: 'x',
      name: 'X',
      nodes: [
        { type: 'trigger', id: 'trig', kind: 'manual' },
        { type: 'sink', id: 'sink-node', kind: 'github-pr' },
      ],
      edges: [{ from: 'trig', to: 'sink-node', type: 'triggers' }],
    }
    expect(resolveTriggerTargets(t)).toEqual([])
  })
})

describe('resolveDelegateTargets', () => {
  test('returns role nodes connected by a delegates edge from the given role', () => {
    const out = resolveDelegateTargets(TEMPLATE, 'director')
    expect(out).toEqual([{ roleNodeId: 'implementer', roleName: 'implementer' }])
  })

  test('returns empty when no delegates edge exists for the given role', () => {
    expect(resolveDelegateTargets(TEMPLATE, 'implementer')).toEqual([])
  })

  test('ignores non-delegates edges', () => {
    const t: WorkflowTemplate = {
      ...TEMPLATE,
      edges: [{ from: 'director', to: 'implementer', type: 'triggers' }],
    }
    expect(resolveDelegateTargets(t, 'director')).toEqual([])
  })
})
