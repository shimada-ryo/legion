// Mock-pair contract test for packages/runtime/src/template/writer.ts.
// representing:   yaml@2.9.x parseDocument + Document.toString round-trip
// verified on:    2026-05-15, against workflows/feature-with-review.yaml
// invalidated when: yaml package bumps major or changes how block-style maps
//                   serialise after add/set on existing items
import { describe, test, expect } from 'bun:test'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, copyFile, readFile, rm } from 'node:fs/promises'
import { writeTemplatePositions } from '@legion/runtime/template/writer'
import { loadWorkflowTemplate } from '@legion/runtime/template/loader'

const REPO_ROOT = resolve(import.meta.dir, '../../../..')
const FIXTURE = join(REPO_ROOT, 'workflows', 'feature-with-review.yaml')

describe('writeTemplatePositions (real workflow YAML round-trip)', () => {
  test('preserves comments and block ordering, inserts flow-style position', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'legion-writer-'))
    try {
      const dest = join(dir, 'feature-with-review.yaml')
      await copyFile(FIXTURE, dest)

      await writeTemplatePositions(dest, {
        director: { x: 100, y: 200 },
        reviewer: { x: 400, y: 50 },
      })

      const after = await readFile(dest, 'utf-8')

      // description block (preserved comment-like content)
      expect(after).toContain('Director delegates to Implementer')

      // flow-style position
      expect(after).toContain('position: { x: 100, y: 200 }')
      expect(after).toContain('position: { x: 400, y: 50 }')

      // nodes still appear in the original order
      const dirIdx = after.indexOf('- id: director')
      const implIdx = after.indexOf('- id: implementer')
      const revIdx = after.indexOf('- id: reviewer')
      expect(dirIdx).toBeLessThan(implIdx)
      expect(implIdx).toBeLessThan(revIdx)

      // loader can re-parse the written file
      const reloaded = await loadWorkflowTemplate(dest)
      const dir2 = reloaded.nodes.find((n) => n.id === 'director')
      const rev2 = reloaded.nodes.find((n) => n.id === 'reviewer')
      expect(dir2!.position).toEqual({ x: 100, y: 200 })
      expect(rev2!.position).toEqual({ x: 400, y: 50 })

      // Untouched node has no position
      const impl2 = reloaded.nodes.find((n) => n.id === 'implementer')
      expect(impl2!.position).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('subsequent write updates the same key in place', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'legion-writer-'))
    try {
      const dest = join(dir, 'feature-with-review.yaml')
      await copyFile(FIXTURE, dest)
      await writeTemplatePositions(dest, { director: { x: 1, y: 1 } })
      await writeTemplatePositions(dest, { director: { x: 9, y: 9 } })
      const after = await readFile(dest, 'utf-8')
      expect(after).toContain('position: { x: 9, y: 9 }')
      expect(after).not.toContain('position: { x: 1, y: 1 }')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
