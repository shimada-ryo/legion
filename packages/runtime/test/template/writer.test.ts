import { describe, test, expect } from 'bun:test'
import { parseDocument } from 'yaml'
import { applyPositions } from '@legion/runtime/template/writer'

describe('applyPositions', () => {
  test('inserts position as flow style on the matching node', () => {
    const src = `id: t
name: T
nodes:
  - id: a
    type: trigger
    kind: manual
edges: []
`
    const doc = parseDocument(src)
    applyPositions(doc, { a: { x: 10, y: 20 } })
    const out = doc.toString()
    expect(out).toContain('position: { x: 10, y: 20 }')
  })

  test('preserves top-level description comment and key ordering', () => {
    const src = `id: t
name: T
description: |
  A multi-line
  description.

nodes:
  - id: a   # the trigger
    type: trigger
    kind: manual
edges: []
`
    const doc = parseDocument(src)
    applyPositions(doc, { a: { x: 1, y: 2 } })
    const out = doc.toString()
    expect(out).toContain('A multi-line')
    expect(out).toContain('the trigger')
    const idIdx = out.indexOf('- id: a')
    const typeIdx = out.indexOf('type: trigger')
    expect(idIdx).toBeLessThan(typeIdx)
  })

  test('updates position when the node already has one', () => {
    const src = `id: t
name: T
nodes:
  - id: a
    type: trigger
    kind: manual
    position: { x: 999, y: 999 }
edges: []
`
    const doc = parseDocument(src)
    applyPositions(doc, { a: { x: 5, y: 6 } })
    const out = doc.toString()
    expect(out).toContain('position: { x: 5, y: 6 }')
    expect(out).not.toContain('999')
  })

  test('throws when an id in positions does not exist in the YAML', () => {
    const src = `id: t
name: T
nodes:
  - id: a
    type: trigger
    kind: manual
edges: []
`
    const doc = parseDocument(src)
    expect(() => applyPositions(doc, { ghost: { x: 0, y: 0 } })).toThrow(/ghost/)
  })

  test('throws when nodes is missing or not a sequence', () => {
    const doc = parseDocument(`id: t\nname: T\nedges: []\n`)
    expect(() => applyPositions(doc, {})).toThrow(/nodes sequence/)
  })
})
