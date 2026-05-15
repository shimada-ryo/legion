// Mock for @xyflow/react ReactFlow component.
// representing:    @xyflow/react@12.10.x ReactFlow component, consuming nodes/edges/
//                  onNodesChange/onNodeDragStop/onNodeClick/onPaneClick props
// verified on:     2026-05-15, by reading @xyflow/react dist/esm types
// invalidated when: ReactFlow renames any of these props or changes signatures,
//                   or useNodesState's internal contract diverges from applyNodeChanges
// contract test:   packages/web/test/contracts/xyflow-applyNodeChanges.contract.test.ts
import type { ReactNode } from 'react'
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { render, cleanup, act } from '@testing-library/react'
import type { WorkflowTemplate } from '@legion/core'
import type { NodeChange } from '@xyflow/react'

// Capture the props that TemplateCanvas passes to <ReactFlow> so tests can
// invoke the registered callbacks directly without simulating PointerEvents.
let capturedProps: Record<string, unknown> = {}

mock.module('@xyflow/react', () => {
  const actual = require('@xyflow/react') as Record<string, unknown>
  return {
    ...actual,
    ReactFlow: (props: Record<string, unknown>) => {
      capturedProps = props
      return null
    },
    Background: () => null,
    Controls: () => null,
  }
})

// Imports MUST come AFTER mock.module so the mocked exports are picked up.
import TemplateCanvas from '../../src/components/TemplateCanvas'
import { ThemeProvider } from '../../src/theme/ThemeProvider'

beforeEach(() => {
  capturedProps = {}
  ;(window as any).matchMedia = () => ({
    matches: false,
    media: '',
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
  })
  ;(globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

afterEach(() => cleanup())

const TEMPLATE: WorkflowTemplate = {
  id: 't',
  name: 'T',
  nodes: [
    { type: 'trigger', id: 'trig', kind: 'manual' },
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

function renderWithTheme(ui: ReactNode) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

describe('TemplateCanvas perf — parent is not notified during drag', () => {
  test('60 position changes do NOT call onDirtyChange or onPositionsChange', () => {
    let dirtyCalls = 0
    let positionsCalls = 0

    renderWithTheme(
      <TemplateCanvas
        template={TEMPLATE}
        onDirtyChange={() => { dirtyCalls++ }}
        onPositionsChange={() => { positionsCalls++ }}
        saveSignal={0}
      />,
    )

    const onNodesChange = capturedProps['onNodesChange'] as
      | ((c: NodeChange[]) => void)
      | undefined
    expect(typeof onNodesChange).toBe('function')

    const dBase = dirtyCalls
    const pBase = positionsCalls

    // Fire 60 synthetic position changes — simulates one drag stroke
    act(() => {
      for (let i = 0; i < 60; i++) {
        onNodesChange!([
          { id: 'dir', type: 'position', position: { x: 100 + i, y: 100 }, dragging: true },
        ])
      }
    })

    // Parent must NOT have been notified during these drag-frame events
    expect(dirtyCalls - dBase).toBe(0)
    expect(positionsCalls - pBase).toBe(0)
  })

  test('onNodeDragStop notifies the parent exactly once with the diff', () => {
    const captured: {
      overrides: Record<string, { x: number; y: number }> | null
      dirty: boolean | null
    } = { overrides: null, dirty: null }
    let dirtyCalls = 0
    let positionsCalls = 0

    renderWithTheme(
      <TemplateCanvas
        template={TEMPLATE}
        onDirtyChange={(d) => { captured.dirty = d; dirtyCalls++ }}
        onPositionsChange={(p) => { captured.overrides = p; positionsCalls++ }}
        saveSignal={0}
      />,
    )

    const onNodesChange = capturedProps['onNodesChange'] as
      | ((c: NodeChange[]) => void)
      | undefined

    const dBase = dirtyCalls
    const pBase = positionsCalls

    // Move director from its base layout to (300, 400)
    act(() => {
      onNodesChange!([
        { id: 'dir', type: 'position', position: { x: 300, y: 400 }, dragging: false },
      ])
    })

    // Re-read onNodeDragStop AFTER the act() so we get the closure that has
    // seen the updated nodes state from the re-render caused by onNodesChange.
    const onNodeDragStop = capturedProps['onNodeDragStop'] as (() => void) | undefined

    // Drag stop — this is the single moment the parent gets notified
    onNodeDragStop!()

    expect(captured.overrides).toEqual({ dir: { x: 300, y: 400 } })
    expect(captured.dirty).toBe(true)
    expect(dirtyCalls - dBase).toBe(1)
    expect(positionsCalls - pBase).toBe(1)
  })

  test('onNodeDragStop with no movement reports empty overrides and dirty=false', () => {
    const captured: {
      overrides: Record<string, { x: number; y: number }> | null
      dirty: boolean | null
    } = { overrides: null, dirty: null }

    renderWithTheme(
      <TemplateCanvas
        template={TEMPLATE}
        onDirtyChange={(d) => { captured.dirty = d }}
        onPositionsChange={(p) => { captured.overrides = p }}
        saveSignal={0}
      />,
    )

    const onNodeDragStop = capturedProps['onNodeDragStop'] as (() => void) | undefined
    expect(typeof onNodeDragStop).toBe('function')
    onNodeDragStop!()

    expect(captured.overrides).toEqual({})
    expect(captured.dirty).toBe(false)
  })
})
