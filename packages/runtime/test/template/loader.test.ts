import { describe, test, expect } from 'bun:test'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { loadWorkflowTemplate } from '@legion/runtime/template/loader'
import { validateTemplate } from '@legion/runtime/orchestrator/template-validate'

const REPO_ROOT = resolve(import.meta.dir, '../../../..')

describe('loadWorkflowTemplate', () => {
  test('parses workflows/feature-implementation.yaml into a WorkflowTemplate', async () => {
    const t = await loadWorkflowTemplate(
      join(REPO_ROOT, 'workflows', 'feature-implementation.yaml'),
    )
    expect(t.id).toBe('feature-implementation')
    expect(t.name).toBe('Feature Implementation Workflow')
    const roleIds = t.nodes.filter((n) => n.type === 'role').map((n) => n.id)
    expect(roleIds).toEqual(['director', 'implementer', 'reviewer'])
    expect(t.edges.length).toBeGreaterThan(0)
  })

  test('throws on missing required field (id)', async () => {
    const tmp = join(tmpdir(), 'no-id.yaml')
    await Bun.write(tmp, 'name: x\nnodes: []\nedges: []\n')
    await expect(loadWorkflowTemplate(tmp)).rejects.toThrow(/id/)
  })

  test('throws on unknown node type', async () => {
    const tmp = join(tmpdir(), 'bad-node.yaml')
    await Bun.write(
      tmp,
      "id: t\nname: t\nnodes:\n  - {id: x, type: alien}\nedges: []\n",
    )
    await expect(loadWorkflowTemplate(tmp)).rejects.toThrow(/alien/)
  })

  test('feature-with-review.yaml loads and passes validateTemplate', async () => {
    const t = await loadWorkflowTemplate(
      join(REPO_ROOT, 'workflows', 'feature-with-review.yaml'),
    )
    expect(t.id).toBe('feature-with-review')
    const roleIds = t.nodes.filter((n) => n.type === 'role').map((n) => n.id)
    expect(roleIds).toEqual(['director', 'implementer', 'reviewer'])
    expect(t.edges.some((e) => e.type === 'reviews')).toBe(true)

    const result = validateTemplate(t, new Set(['claude-code', 'codex']))
    expect(result.errors).toEqual([])
  })

  test('parses position field on nodes', async () => {
    const tmp = join(tmpdir(), 'with-position.yaml')
    await Bun.write(
      tmp,
      `id: t
name: T
nodes:
  - id: a
    type: trigger
    kind: manual
    position: { x: 100, y: 200 }
  - id: b
    type: trigger
    kind: manual
edges: []
`,
    )
    const t = await loadWorkflowTemplate(tmp)
    expect(t.nodes[0]!.position).toEqual({ x: 100, y: 200 })
    expect(t.nodes[1]!.position).toBeUndefined()
  })

  test('throws when position.x is not a number', async () => {
    const tmp = join(tmpdir(), 'bad-position-type.yaml')
    await Bun.write(
      tmp,
      `id: t
name: T
nodes:
  - id: a
    type: trigger
    kind: manual
    position: { x: "1", y: 2 }
edges: []
`,
    )
    await expect(loadWorkflowTemplate(tmp)).rejects.toThrow(/numeric x and y/)
  })

  test('throws when position.x is not finite', async () => {
    const tmp = join(tmpdir(), 'bad-position-nan.yaml')
    await Bun.write(
      tmp,
      `id: t
name: T
nodes:
  - id: a
    type: trigger
    kind: manual
    position: { x: .nan, y: 0 }
edges: []
`,
    )
    await expect(loadWorkflowTemplate(tmp)).rejects.toThrow(/finite numbers/)
  })
})
