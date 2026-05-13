import { describe, test, expect } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadWorkflowTemplate } from '@legion/runtime/template/loader'

const REPO = process.cwd()

describe('loadWorkflowTemplate', () => {
  test('parses workflows/feature-implementation.yaml into a WorkflowTemplate', async () => {
    const t = await loadWorkflowTemplate(
      join(REPO, 'workflows', 'feature-implementation.yaml'),
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
})
