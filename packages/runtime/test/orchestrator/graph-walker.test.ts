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
    expect(out).toEqual([{ roleNodeId: 'implementer', roleName: 'implementer', edgeType: 'delegates' }])
  })

  test('returns reviews-edge targets from implementer (TEMPLATE has reviews edge)', () => {
    const out = resolveDelegateTargets(TEMPLATE, 'implementer')
    expect(out).toEqual([{ roleNodeId: 'reviewer', roleName: 'reviewer', edgeType: 'reviews' }])
  })

  test('returns empty when no delegates or reviews edge exists for the given role', () => {
    expect(resolveDelegateTargets(TEMPLATE, 'reviewer')).toEqual([])
  })

  test('ignores non-delegates/non-reviews edges', () => {
    const t: WorkflowTemplate = {
      ...TEMPLATE,
      edges: [{ from: 'director', to: 'implementer', type: 'triggers' }],
    }
    expect(resolveDelegateTargets(t, 'director')).toEqual([])
  })
})

describe('resolveDelegateTargets (Phase 3: reviews edge)', () => {
  test('returns edgeType=delegates for direct delegates edges (Phase 2 compat)', () => {
    const tmpl: WorkflowTemplate = {
      id: 't', name: 't', description: '',
      nodes: [
        { id: 'director', type: 'role', role: 'director', provider: 'claude-code', lifetime: 'per-workflow' },
        { id: 'implementer', type: 'role', role: 'implementer', provider: 'claude-code', lifetime: 'per-task' },
      ] as any,
      edges: [{ from: 'director', to: 'implementer', type: 'delegates' }],
    }
    const targets = resolveDelegateTargets(tmpl, 'director')
    expect(targets).toEqual([{ roleNodeId: 'implementer', roleName: 'implementer', edgeType: 'delegates' }])
  })

  test('returns edgeType=reviews for reviews edges', () => {
    const tmpl: WorkflowTemplate = {
      id: 't', name: 't', description: '',
      nodes: [
        { id: 'implementer', type: 'role', role: 'implementer', provider: 'claude-code', lifetime: 'per-task' },
        { id: 'reviewer', type: 'role', role: 'reviewer', provider: 'codex', lifetime: 'per-task' },
      ] as any,
      edges: [{ from: 'implementer', to: 'reviewer', type: 'reviews' }],
    }
    const targets = resolveDelegateTargets(tmpl, 'implementer')
    expect(targets).toEqual([{ roleNodeId: 'reviewer', roleName: 'reviewer', edgeType: 'reviews' }])
  })

  test('returns both delegates and reviews targets when both are defined', () => {
    const tmpl: WorkflowTemplate = {
      id: 't', name: 't', description: '',
      nodes: [
        { id: 'a', type: 'role', role: 'a', provider: 'claude-code', lifetime: 'per-task' },
        { id: 'b', type: 'role', role: 'b', provider: 'claude-code', lifetime: 'per-task' },
        { id: 'c', type: 'role', role: 'c', provider: 'codex', lifetime: 'per-task' },
      ] as any,
      edges: [
        { from: 'a', to: 'b', type: 'delegates' },
        { from: 'a', to: 'c', type: 'reviews' },
      ],
    }
    const targets = resolveDelegateTargets(tmpl, 'a')
    expect(targets).toHaveLength(2)
    expect(targets).toContainEqual({ roleNodeId: 'b', roleName: 'b', edgeType: 'delegates' })
    expect(targets).toContainEqual({ roleNodeId: 'c', roleName: 'c', edgeType: 'reviews' })
  })
})
