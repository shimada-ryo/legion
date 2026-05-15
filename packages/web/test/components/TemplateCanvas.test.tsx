import type { ReactNode } from 'react'
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { render, cleanup } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import TemplateCanvas from '../../src/components/TemplateCanvas'
import { ThemeProvider } from '../../src/theme/ThemeProvider'
import type { WorkflowTemplate, NodePosition } from '@legion/core'

beforeEach(() => {
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

function renderWithProviders(ui: ReactNode) {
  return render(
    <ThemeProvider>
      <ReactFlowProvider>{ui}</ReactFlowProvider>
    </ThemeProvider>,
  )
}

describe('TemplateCanvas', () => {
  test('renders a draggable node for every template node', () => {
    const { container } = renderWithProviders(
      <TemplateCanvas
        template={TEMPLATE}
        onDirtyChange={() => {}}
        onPositionsChange={() => {}}
        saveSignal={0}
      />,
    )
    expect(container.querySelectorAll('[data-id="trig"]').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('[data-id="dir"]').length).toBeGreaterThan(0)
  })

  test('onPositionsChange is not called on mount (drag-stop is the only trigger)', () => {
    let captured: Record<string, NodePosition> | null = null
    renderWithProviders(
      <TemplateCanvas
        template={TEMPLATE}
        onDirtyChange={() => {}}
        onPositionsChange={(p) => { captured = p }}
        saveSignal={0}
      />,
    )
    expect(captured).toBeNull()
  })

  test('saveSignal change does not notify the parent (drag-stop is the only trigger)', () => {
    let dirtyCalls: boolean[] = []
    const { rerender } = renderWithProviders(
      <TemplateCanvas
        template={TEMPLATE}
        onDirtyChange={(d) => dirtyCalls.push(d)}
        onPositionsChange={() => {}}
        saveSignal={0}
      />,
    )
    dirtyCalls = []

    rerender(
      <ThemeProvider>
        <ReactFlowProvider>
          <TemplateCanvas
            template={TEMPLATE}
            onDirtyChange={(d) => dirtyCalls.push(d)}
            onPositionsChange={() => {}}
            saveSignal={1}
          />
        </ReactFlowProvider>
      </ThemeProvider>,
    )

    // The new pattern only notifies the parent at onNodeDragStop.
    // Bumping saveSignal alone must not call onDirtyChange.
    expect(dirtyCalls).toEqual([])
  })
})
