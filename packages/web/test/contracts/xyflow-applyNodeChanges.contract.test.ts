// Contract test for @xyflow/react applyNodeChanges helper.
// representing:    @xyflow/react@12.10.x applyNodeChanges(changes, nodes) → Node[]
// verified on:     2026-05-15, against @xyflow/react@12.10.2
// invalidated when: @xyflow/react bumps to a version that loses referential
//                   equality for unchanged nodes, or renames/relocates the helper
// related to:      packages/web/src/components/TemplateCanvas.tsx (uses useNodesState
//                  which internally calls applyNodeChanges; relies on this contract)
import { describe, test, expect } from 'bun:test'
import { applyNodeChanges, type Node, type NodeChange } from '@xyflow/react'

describe('applyNodeChanges (xyflow contract)', () => {
  test('unchanged nodes preserve object reference after a position change', () => {
    const initial: Node[] = [
      { id: 'a', position: { x: 0, y: 0 }, data: { label: 'A' } },
      { id: 'b', position: { x: 100, y: 0 }, data: { label: 'B' } },
      { id: 'c', position: { x: 200, y: 0 }, data: { label: 'C' } },
    ]
    const changes: NodeChange[] = [
      { id: 'a', type: 'position', position: { x: 50, y: 50 }, dragging: false },
    ]
    const next = applyNodeChanges(changes, initial)

    // 'a' is a new object
    expect(next[0]).not.toBe(initial[0])
    expect(next[0]!.position).toEqual({ x: 50, y: 50 })

    // 'b' and 'c' keep the same reference (this is the contract our impl relies on)
    expect(next[1]).toBe(initial[1])
    expect(next[2]).toBe(initial[2])
  })

  test('zero changes returns nodes with all references preserved', () => {
    const initial: Node[] = [
      { id: 'a', position: { x: 0, y: 0 }, data: {} },
      { id: 'b', position: { x: 100, y: 0 }, data: {} },
    ]
    const next = applyNodeChanges([], initial)
    expect(next[0]).toBe(initial[0])
    expect(next[1]).toBe(initial[1])
  })

  test('position change with dragging=true preserves data reference', () => {
    const initial: Node[] = [
      { id: 'a', position: { x: 0, y: 0 }, data: { label: 'A' } },
    ]
    const changes: NodeChange[] = [
      { id: 'a', type: 'position', position: { x: 10, y: 20 }, dragging: true },
    ]
    const next = applyNodeChanges(changes, initial)
    // 'a' is a new object, but the data object should be reused (data did not change)
    expect(next[0]!.data).toBe(initial[0]!.data)
  })
})
