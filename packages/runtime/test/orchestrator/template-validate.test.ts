import { describe, it, expect } from 'bun:test'
import { validateTemplate } from '../../src/orchestrator/template-validate'
import type { WorkflowTemplate } from '@legion/core'

const REGISTERED = new Set(['claude-code', 'codex'])

const baseNodes = [
  { id: 'trigger', type: 'trigger', kind: 'manual' },
  { id: 'director', type: 'role', role: 'director', provider: 'claude-code', lifetime: 'per-workflow' },
  { id: 'implementer', type: 'role', role: 'implementer', provider: 'claude-code', lifetime: 'per-task' },
  { id: 'reviewer', type: 'role', role: 'reviewer', provider: 'codex', lifetime: 'per-task' },
] as const

describe('validateTemplate', () => {
  it('accepts a valid Phase 3 template', () => {
    const tmpl: WorkflowTemplate = {
      id: 't',
      name: 't',
      description: '',
      nodes: [...baseNodes],
      edges: [
        { from: 'trigger', to: 'director', type: 'triggers' },
        { from: 'director', to: 'implementer', type: 'delegates' },
        { from: 'implementer', to: 'reviewer', type: 'reviews' },
      ],
    }
    const result = validateTemplate(tmpl, REGISTERED)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('rejects role node without provider field', () => {
    const tmpl: WorkflowTemplate = {
      id: 't', name: 't', description: '',
      nodes: [
        { id: 'trigger', type: 'trigger', kind: 'manual' },
        { id: 'director', type: 'role', role: 'director', lifetime: 'per-workflow' } as any,
      ],
      edges: [{ from: 'trigger', to: 'director', type: 'triggers' }],
    }
    const result = validateTemplate(tmpl, REGISTERED)
    expect(result.errors.some((e) => e.includes('provider'))).toBe(true)
  })

  it('rejects unknown provider name', () => {
    const tmpl: WorkflowTemplate = {
      id: 't', name: 't', description: '',
      nodes: [
        { id: 'trigger', type: 'trigger', kind: 'manual' },
        { id: 'director', type: 'role', role: 'director', provider: 'gemini', lifetime: 'per-workflow' },
      ],
      edges: [{ from: 'trigger', to: 'director', type: 'triggers' }],
    }
    const result = validateTemplate(tmpl, REGISTERED)
    expect(result.errors.some((e) => e.includes('gemini'))).toBe(true)
  })

  it('rejects provider=codex on director or implementer role', () => {
    const tmpl: WorkflowTemplate = {
      id: 't', name: 't', description: '',
      nodes: [
        { id: 'trigger', type: 'trigger', kind: 'manual' },
        { id: 'director', type: 'role', role: 'director', provider: 'codex', lifetime: 'per-workflow' },
      ],
      edges: [{ from: 'trigger', to: 'director', type: 'triggers' }],
    }
    const result = validateTemplate(tmpl, REGISTERED)
    expect(result.errors.some((e) => e.includes('codex') && e.includes('director'))).toBe(true)
  })

  it('rejects reviews edge whose target is not a reviewer role', () => {
    const tmpl: WorkflowTemplate = {
      id: 't', name: 't', description: '',
      nodes: [...baseNodes],
      edges: [
        { from: 'trigger', to: 'director', type: 'triggers' },
        { from: 'director', to: 'implementer', type: 'delegates' },
        { from: 'implementer', to: 'implementer', type: 'reviews' },  // self-review (not allowed in Phase 3)
      ],
    }
    const result = validateTemplate(tmpl, REGISTERED)
    expect(result.errors.some((e) => e.includes('reviews'))).toBe(true)
  })

  it('rejects publishes edge whose target is not a blackboard node', () => {
    const tmpl: WorkflowTemplate = {
      id: 't', name: 't', description: '',
      nodes: [...baseNodes],
      edges: [
        { from: 'trigger', to: 'director', type: 'triggers' },
        { from: 'reviewer', to: 'implementer', type: 'publishes' },  // target is role (not blackboard) -> NG
      ],
    }
    const result = validateTemplate(tmpl, REGISTERED)
    expect(result.errors.some((e) => e.includes('publishes'))).toBe(true)
  })

  it('emits warning (not error) for subscribes / synthesizes edges', () => {
    const tmpl: WorkflowTemplate = {
      id: 't', name: 't', description: '',
      nodes: [
        ...baseNodes,
        { id: 'bb', type: 'blackboard', schema: {} },
      ] as any,
      edges: [
        { from: 'trigger', to: 'director', type: 'triggers' },
        { from: 'reviewer', to: 'bb', type: 'publishes' },
        { from: 'bb', to: 'implementer', type: 'subscribes' },
      ],
    }
    const result = validateTemplate(tmpl, REGISTERED)
    expect(result.errors).toEqual([])
    expect(result.warnings.some((w) => w.includes('subscribes'))).toBe(true)
  })
})
