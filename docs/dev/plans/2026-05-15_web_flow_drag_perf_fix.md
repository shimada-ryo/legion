# Web Flow Drag Perf Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** legion web の TemplateCanvas / CanvasOverlay の drag 実装を React Flow 標準パターン (`useNodesState` + `applyNodeChanges` + `onNodeDragStop`) に乗せ替えて、drag 中のチラつき・カクつき・親 re-render を撲滅する。前 spec で導入した `applyPositionChanges` helper は不要になるので削除する。

**Architecture:** React Flow 側に nodes 配列の state を管理させる。drag 中は React Flow 内部 store のみが更新され、React component の再 render は移動したノードに限定される。親 (`TemplateDetail`) への通知は `onNodeDragStop` で 1 回だけ。

**Tech Stack:** TypeScript 5.7, Bun (test runner), React 19, `@xyflow/react@12.10.x` (`useNodesState`, `applyNodeChanges`), `@testing-library/react@16.x` + `happy-dom@20.x`.

**Spec reference:** [docs/dev/specs/2026-05-15_web_flow_drag_perf_fix_design.md](../specs/2026-05-15_web_flow_drag_perf_fix_design.md)

**Scope:** `packages/web/` のみ。`packages/core` / `packages/runtime` / `packages/server` / `packages/cli` は触らない。前 spec の YAML 書き戻し / PATCH / Save UX は維持する。

---

## File Structure

### Create

| Path | Responsibility | 予測行数 |
| --- | --- | --- |
| `packages/web/test/contracts/xyflow-applyNodeChanges.contract.test.ts` | `@xyflow/react` の `applyNodeChanges` が未変更ノードの object 参照を保持する契約検証 | ~50 |
| `packages/web/test/components/TemplateCanvas.perf.test.tsx` | drag 中の親通知 0 件、drag stop で 1 件、`diffPositions` の動作 | ~120 |

### Modify

| Path | Change | 予測増減 |
| --- | --- | --- |
| `packages/web/src/components/TemplateCanvas.tsx` | `useNodesState` 採用 + `onNodeDragStop` 通知 + `buildInitialNodes` / `diffPositions` 内部 helper | ±0 |
| `packages/web/src/components/CanvasOverlay.tsx` | `useNodesState` 採用 + roleStatus 由来の data 更新を `setNodes` map で実施 | -17 |
| `packages/web/src/components/template-canvas/layout.ts` | `applyPositionChanges` を削除、import から `NodeChange` を外す | -25 |
| `packages/web/test/components/template-canvas/layout.test.ts` | `applyPositionChanges` の 3 テストを削除 (層は 8 → 5 件に減る) | -50 |
| `packages/web/test/components/TemplateCanvas.test.tsx` | `saveSignal` テストを `setNodes` 経由で動くように軽く調整 | +0 / 数行修正 |

---

## Pre-flight

- [ ] **Step P1: ブランチと spec を確認**

```bash
cd /d/Projects/Misc/legion/.claude/worktrees/design-1
git branch --show-current
ls docs/dev/specs/2026-05-15_web_flow_drag_perf_fix_design.md
```

Expected:
- branch: `worktree-design-1`
- spec ファイルが存在する

- [ ] **Step P2: ベースラインのテストと型チェックが通る**

```bash
bun run typecheck
bun run test
```

Expected: 全部 green。277 tests 程度を pass しているはず (前 perf 実装の段階)。

- [ ] **Step P3: `@xyflow/react` の API シェイプを再確認**

```bash
grep -n "useNodesState\|applyNodeChanges" packages/web/node_modules/@xyflow/react/dist/esm/index.d.ts | head
```

Expected: `useNodesState` と `applyNodeChanges` が export されていることが見える。これが前提。

---

## Task 1: `applyNodeChanges` の contract test

**Files:**

- Create: `packages/web/test/contracts/xyflow-applyNodeChanges.contract.test.ts`

`@xyflow/react` の `applyNodeChanges` が「未変更ノードの object 参照を保持する」契約を固定化する。本実装が乗っかる前提を test で守る。

- [ ] **Step 1-1: contract test を書く**

`packages/web/test/contracts/xyflow-applyNodeChanges.contract.test.ts`:

```ts
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

    // 'a' 自体は新規 object
    expect(next[0]).not.toBe(initial[0])
    expect(next[0]!.position).toEqual({ x: 50, y: 50 })

    // 'b' と 'c' は同じ参照のまま (これが本実装の前提)
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
    // a is new object, but data object should be reused (no data change)
    expect(next[0]!.data).toBe(initial[0]!.data)
  })
})
```

- [ ] **Step 1-2: テスト実行**

```bash
cd /d/Projects/Misc/legion/.claude/worktrees/design-1
bun test test/contracts/xyflow-applyNodeChanges.contract.test.ts
```

(packages/web cwd で実行されるはずなので path は相対)

Expected: 3 tests pass.

- [ ] **Step 1-3: コミット**

```bash
git branch --show-current
```

Must say `worktree-design-1`. Then:

```bash
git add packages/web/test/contracts/xyflow-applyNodeChanges.contract.test.ts
git commit -m "test(web): add xyflow applyNodeChanges contract test"
```

---

## Task 2: TemplateCanvas を `useNodesState` パターンに書き換え

**Files:**

- Modify: `packages/web/src/components/TemplateCanvas.tsx` (約 110 行に書き換え)
- Modify: `packages/web/test/components/TemplateCanvas.test.tsx` (`saveSignal` テストを軽く調整)

### Step 2-1: TemplateCanvas.tsx を書き換える

REPLACE the entire contents of `packages/web/src/components/TemplateCanvas.tsx` with:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '../styles/react-flow.css'
import type { WorkflowTemplate, NodePosition } from '@legion/core'
import { nodeStyleFor, edgeStyleFor } from './template-canvas/styling'
import { layoutTemplate } from './template-canvas/layout'
import { useTheme } from '../theme/ThemeProvider'

export interface TemplateCanvasProps {
  template: WorkflowTemplate
  onDirtyChange: (dirty: boolean) => void
  onPositionsChange: (overrides: Record<string, NodePosition>) => void
  /** Parent increments this to ask the canvas to drop in-flight overrides. */
  saveSignal: number
}

function buildInitialNodes(
  template: WorkflowTemplate,
  baseLayout: Record<string, NodePosition>,
): Node[] {
  return template.nodes.map((n) => {
    const style = nodeStyleFor(n)
    return {
      id: n.id,
      position: baseLayout[n.id] ?? { x: 0, y: 0 },
      data: { label: style.label },
      style: {
        padding: 8,
        border: `2px solid ${style.border}`,
        borderRadius: 6,
        fontSize: 12,
        whiteSpace: 'pre-line',
        minWidth: 120,
        textAlign: 'center',
      },
    }
  })
}

export function diffPositions(
  nodes: Node[],
  base: Record<string, NodePosition>,
): Record<string, NodePosition> {
  const out: Record<string, NodePosition> = {}
  for (const n of nodes) {
    const b = base[n.id]
    if (!b) continue
    if (n.position.x !== b.x || n.position.y !== b.y) {
      out[n.id] = { x: n.position.x, y: n.position.y }
    }
  }
  return out
}

export default function TemplateCanvas({
  template,
  onDirtyChange,
  onPositionsChange,
  saveSignal,
}: TemplateCanvasProps) {
  const baseLayout = useMemo(() => layoutTemplate(template), [template])
  const initialNodes = useMemo(
    () => buildInitialNodes(template, baseLayout),
    [template, baseLayout],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const { resolved } = useTheme()

  // template 切替 / 親からの Save・Reset 通知で初期化
  useEffect(() => {
    setNodes(initialNodes)
  }, [initialNodes, saveSignal, setNodes])

  const edges = useMemo<Edge[]>(
    () =>
      template.edges.map((e, i) => {
        const style = edgeStyleFor(e.type)
        return {
          id: `${e.from}-${e.to}-${i}`,
          source: e.from,
          target: e.to,
          label: style.label,
          animated: style.animated,
          style: { stroke: style.stroke, strokeWidth: 2 },
          labelStyle: { fontSize: 10, fill: style.stroke },
        }
      }),
    [template],
  )

  const [dotColor, setDotColor] = useState('')
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement)
    setDotColor(cs.getPropertyValue('--canvas-grid').trim())
  }, [resolved])

  const onNodeDragStop = useCallback(() => {
    const overrides = diffPositions(nodes, baseLayout)
    onPositionsChange(overrides)
    onDirtyChange(Object.keys(overrides).length > 0)
  }, [nodes, baseLayout, onPositionsChange, onDirtyChange])

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        fitView
        nodesDraggable={true}
        nodesConnectable={false}
      >
        <Background color={dotColor} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
```

主要変更:
- `useNodesState` を import / 採用
- 旧 `overrides` state, `applyPositionChanges` 利用, `useEffect [overrides, onDirtyChange]`, `useEffect [overrides, onPositionsChange]` を削除
- `buildInitialNodes` で `data` / `style` を安定生成
- `diffPositions` を export (Task 3 のテストから呼ぶ)
- `onNodeDragStop` で親通知

### Step 2-2: 既存 TemplateCanvas.test.tsx の `saveSignal` テストを微調整

`packages/web/test/components/TemplateCanvas.test.tsx` の `saveSignal change clears the dirty flag and overrides` test は、drag 中の dirty 通知に依存していたので、新パターン (drag stop 時のみ通知) に合わせて単純化する。

該当 test を以下に書き換える (他 2 テストは残す):

```tsx
test('saveSignal change resets to initial layout (no dirty notification)', () => {
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

  // saveSignal 変化のみで親への通知は走らない (drag 終了以外では通知しない)
  expect(dirtyCalls).toEqual([])
})
```

### Step 2-3: 型チェック + 既存テスト

```bash
cd /d/Projects/Misc/legion/.claude/worktrees/design-1
bun run --filter=@legion/web typecheck
bun test
```

Expected:
- typecheck 0 errors
- 53 web tests がまだ通る (`applyPositionChanges` の test がまだ残っているのは Task 4 で削除する)

### Step 2-4: コミット

```bash
git branch --show-current
```

Must say `worktree-design-1`. Then:

```bash
git add packages/web/src/components/TemplateCanvas.tsx packages/web/test/components/TemplateCanvas.test.tsx
git commit -m "refactor(web): switch TemplateCanvas to useNodesState pattern"
```

---

## Task 3: TemplateCanvas の perf regression テストを追加

**Files:**

- Create: `packages/web/test/components/TemplateCanvas.perf.test.tsx`

`@xyflow/react` の `ReactFlow` コンポーネントを test 内で stub し、`onNodesChange` / `onNodeDragStop` を test から直接叩く。これで drag 中の親通知ゼロ / drag stop で 1 回通知を確認する。

### Step 3-1: perf test を書く

`packages/web/test/components/TemplateCanvas.perf.test.tsx`:

```tsx
// Mock for @xyflow/react ReactFlow component.
// representing:    @xyflow/react@12.10.x ReactFlow component, consuming nodes/edges/
//                  onNodesChange/onNodeDragStop/onNodeClick/onPaneClick props
// verified on:     2026-05-15, by reading @xyflow/react dist/esm types
// invalidated when: ReactFlow renames any of these props or changes signatures,
//                   or useNodesState's internal contract diverges from applyNodeChanges
// contract test:   packages/web/test/contracts/xyflow-applyNodeChanges.contract.test.ts
import type { ReactNode } from 'react'
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { render, cleanup } from '@testing-library/react'
import type { WorkflowTemplate } from '@legion/core'
import type { NodeChange } from '@xyflow/react'

// Capture the props that TemplateCanvas passes to <ReactFlow> so tests can
// invoke the registered callbacks directly without simulating PointerEvents.
let capturedProps: Record<string, unknown> = {}

mock.module('@xyflow/react', () => {
  const actual = require('@xyflow/react')
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

// Imports MUST come after mock.module
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
    observe() {}; unobserve() {}; disconnect() {}
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
  test('multiple position changes do NOT call onDirtyChange or onPositionsChange', () => {
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

    // baseline 通知数 (初回 mount で呼ばれるなら 0〜1 程度)
    const dBase = dirtyCalls
    const pBase = positionsCalls

    // 60 フレーム分の position change を発火 — drag 中の振る舞いをシミュレート
    for (let i = 0; i < 60; i++) {
      onNodesChange!([
        { id: 'dir', type: 'position', position: { x: 100 + i, y: 100 }, dragging: true },
      ])
    }

    // drag 中は親通知ゼロ
    expect(dirtyCalls - dBase).toBe(0)
    expect(positionsCalls - pBase).toBe(0)
  })

  test('onNodeDragStop notifies the parent exactly once with the diff', () => {
    let lastOverrides: Record<string, { x: number; y: number }> | null = null
    let dirtyAtEnd: boolean | null = null

    renderWithTheme(
      <TemplateCanvas
        template={TEMPLATE}
        onDirtyChange={(d) => { dirtyAtEnd = d }}
        onPositionsChange={(p) => { lastOverrides = p }}
        saveSignal={0}
      />,
    )

    const onNodesChange = capturedProps['onNodesChange'] as
      | ((c: NodeChange[]) => void)
      | undefined
    const onNodeDragStop = capturedProps['onNodeDragStop'] as
      | (() => void)
      | undefined

    // 動かす
    onNodesChange!([
      { id: 'dir', type: 'position', position: { x: 300, y: 400 }, dragging: false },
    ])

    // drag 終了
    onNodeDragStop!()

    expect(lastOverrides).toEqual({ dir: { x: 300, y: 400 } })
    expect(dirtyAtEnd).toBe(true)
  })

  test('onNodeDragStop with no movement reports empty overrides and dirty=false', () => {
    let lastOverrides: Record<string, { x: number; y: number }> | null = null
    let dirtyAtEnd: boolean | null = null

    renderWithTheme(
      <TemplateCanvas
        template={TEMPLATE}
        onDirtyChange={(d) => { dirtyAtEnd = d }}
        onPositionsChange={(p) => { lastOverrides = p }}
        saveSignal={0}
      />,
    )

    const onNodeDragStop = capturedProps['onNodeDragStop'] as (() => void) | undefined
    onNodeDragStop!()

    expect(lastOverrides).toEqual({})
    expect(dirtyAtEnd).toBe(false)
  })
})
```

### Step 3-2: テスト実行

```bash
cd /d/Projects/Misc/legion/.claude/worktrees/design-1
bun test
```

Expected:
- 全パッケージ green
- 新規 perf test の 3 件 pass
- 既存 TemplateCanvas.test.tsx の 3 件 pass

注意: `bun:test` の `mock.module` は test ファイル先頭で評価される。`import TemplateCanvas` は mock の **後** に書く必要があり、test ファイル上半分の構造を守る。

### Step 3-3: コミット

```bash
git branch --show-current
git add packages/web/test/components/TemplateCanvas.perf.test.tsx
git commit -m "test(web): add perf regression test for TemplateCanvas drag"
```

---

## Task 4: `applyPositionChanges` helper を削除

**Files:**

- Modify: `packages/web/src/components/template-canvas/layout.ts`
- Modify: `packages/web/test/components/template-canvas/layout.test.ts`

新パターンに乗ったので、前 spec の `applyPositionChanges` helper は呼び出し元が消える。YAGNI 削除。

### Step 4-1: layout.ts から削除

`packages/web/src/components/template-canvas/layout.ts` から、以下を削除する:

- `import type { NodeChange } from '@xyflow/react'`
- `export function applyPositionChanges(...)` 関数 (約 15 行)

残るのは `layoutTemplate` と (private な) `autoLayout` のみ。

`layout.ts` の最終形 (確認用):

```ts
import type { WorkflowTemplate, TemplateNode, TemplateEdge, NodePosition } from '@legion/core'

const COL_W = 200
const ROW_H = 120

export function layoutTemplate(t: WorkflowTemplate): Record<string, NodePosition> {
  const explicit: Record<string, NodePosition> = {}
  const needsAuto: TemplateNode[] = []
  for (const n of t.nodes) {
    if (n.position) explicit[n.id] = n.position
    else needsAuto.push(n)
  }
  const auto = autoLayout(needsAuto, t.edges)
  return { ...auto, ...explicit }
}

function autoLayout(
  nodes: TemplateNode[],
  allEdges: TemplateEdge[],
): Record<string, NodePosition> {
  // ... 既存のままで保持
}
```

### Step 4-2: layout.test.ts の `applyPositionChanges` テストを削除

`packages/web/test/components/template-canvas/layout.test.ts` の末尾にある `describe('applyPositionChanges', ...)` ブロック (3 tests) を削除する。

また、ファイル上部の以下も削除:

```ts
import { applyPositionChanges } from '../../../src/components/template-canvas/layout'
import type { NodeChange } from '@xyflow/react'
```

`describe('layoutTemplate', ...)` の既存 3 テスト と `describe('layoutTemplate with explicit positions', ...)` の 2 テスト (合計 5 テスト) は残す。

### Step 4-3: 型チェック + テスト

```bash
cd /d/Projects/Misc/legion/.claude/worktrees/design-1
bun run --filter=@legion/web typecheck
bun test
```

Expected:
- typecheck 0 errors
- layout.test.ts は 5 件に減って 5/5 pass
- 他のテストは全 green

### Step 4-4: コミット

```bash
git branch --show-current
git add packages/web/src/components/template-canvas/layout.ts packages/web/test/components/template-canvas/layout.test.ts
git commit -m "refactor(web): drop applyPositionChanges helper (unused)"
```

---

## Task 5: CanvasOverlay を `useNodesState` パターンに書き換え

**Files:**

- Modify: `packages/web/src/components/CanvasOverlay.tsx`

Instance 側の drag を同じパターンに揃える。Instance 特有の難しさは `roleStatus` がリアルタイムに変わる点で、position は保持しながら data だけ差し替える。

### Step 5-1: CanvasOverlay.tsx を書き換える

REPLACE the entire contents of `packages/web/src/components/CanvasOverlay.tsx` with:

```tsx
import { useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '../styles/react-flow.css'
import type { WorkflowTemplate, TemplateNode, NodePosition } from '@legion/core'
import type { AgentInstanceView } from '../types'
import { useTheme } from '../theme/ThemeProvider'
import { layoutTemplate } from './template-canvas/layout'

export interface CanvasOverlayProps {
  template: WorkflowTemplate
  agentInstances: AgentInstanceView[]
  onSelectNode: (id: string | null) => void
}

const NODE_BORDER: Record<TemplateNode['type'], string> = {
  trigger: '#888',
  role: '#0066cc',
  blackboard: '#aa00aa',
  'human-gate': '#cc8800',
  sink: '#444',
}

const STATUS_BG: Record<string, string> = {
  starting: 'var(--node-bg-running)',
  running: 'var(--node-bg-running)',
  completed: 'var(--node-bg-success)',
  failed: 'var(--node-bg-error)',
}

function mergeStatus(a: string | undefined, b: string): string {
  if (a === 'running' || b === 'running' || a === 'starting' || b === 'starting') return 'running'
  if (a === 'failed' || b === 'failed') return 'failed'
  if (a === 'completed' || b === 'completed') return 'completed'
  return b
}

function deriveRoleStatus(instances: AgentInstanceView[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const ai of instances) {
    m.set(ai.roleNodeId, mergeStatus(m.get(ai.roleNodeId), ai.status))
  }
  return m
}

interface StatusNodeData extends Record<string, unknown> {
  label: string
  status: string | null
  borderColor: string
}

function StatusNode({ data }: NodeProps<Node<StatusNodeData>>) {
  const bg = data.status ? (STATUS_BG[data.status] ?? 'var(--node-bg)') : 'var(--node-bg)'
  return (
    <div
      data-status={data.status ?? undefined}
      style={{
        padding: 8,
        background: bg,
        color: 'var(--fg-primary)',
        border: `2px solid ${data.borderColor}`,
        borderRadius: 6,
        fontSize: 12,
        whiteSpace: 'pre-line',
      }}
    >
      <Handle type="target" position={Position.Top} />
      {data.label}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

const NODE_TYPES = { statusNode: StatusNode }

function buildInitialNodes(
  template: WorkflowTemplate,
  baseLayout: Record<string, NodePosition>,
): Node[] {
  return template.nodes.map((n) => ({
    id: n.id,
    type: 'statusNode',
    position: baseLayout[n.id] ?? { x: 0, y: 0 },
    data: {
      label: `${n.id}\n(${n.type})`,
      status: null,
      borderColor: NODE_BORDER[n.type] ?? '#888',
    } satisfies StatusNodeData,
  }))
}

export default function CanvasOverlay({
  template,
  agentInstances,
  onSelectNode,
}: CanvasOverlayProps) {
  const roleStatus = useMemo(() => deriveRoleStatus(agentInstances), [agentInstances])
  const baseLayout = useMemo(() => layoutTemplate(template), [template])
  // initialNodes は template/baseLayout のみに依存する。roleStatus は下の effect で
  // data だけ差し替えるため、ここでは含めない (含めると drag 位置がリセットされる)。
  const initialNodes = useMemo(
    () => buildInitialNodes(template, baseLayout),
    [template, baseLayout],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const { resolved } = useTheme()

  // template 切替時 position を初期化
  useEffect(() => {
    setNodes(initialNodes)
  }, [initialNodes, setNodes])

  // roleStatus が変わったとき、position は保持しつつ data の status だけ差し替える。
  // 該当ノードのみ新規 object、それ以外は参照保持。
  useEffect(() => {
    setNodes((current) =>
      current.map((cn) => {
        const tn = template.nodes.find((t) => t.id === cn.id)
        if (!tn) return cn
        const newStatus = tn.type === 'role' ? roleStatus.get(cn.id) ?? null : null
        const oldData = cn.data as StatusNodeData
        if (oldData.status === newStatus) return cn
        return { ...cn, data: { ...oldData, status: newStatus } }
      }),
    )
  }, [roleStatus, template, setNodes])

  const [dotColor, setDotColor] = useState('')
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement)
    setDotColor(cs.getPropertyValue('--canvas-grid').trim())
  }, [resolved])

  const edges = useMemo<Edge[]>(
    () =>
      template.edges.map((e, i) => ({
        id: `${e.from}-${e.to}-${i}`,
        source: e.from,
        target: e.to,
        label: e.type,
        labelStyle: { fontSize: 10 },
      })),
    [template],
  )

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodeTypes={NODE_TYPES}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        nodesDraggable={true}
        nodesConnectable={false}
        fitView
      >
        <Background color={dotColor} />
        <Controls />
      </ReactFlow>
    </div>
  )
}
```

設計上の注意:

- `useNodesState` が返す `onNodesChange` (内部で `applyNodeChanges` を使う) をそのまま採用。自前で書かない。
- `initialNodes` の deps は `template` と `baseLayout` のみ。`roleStatus` を含めると、status 変化で `initialNodes` が新規になり、`useEffect [initialNodes]` が `setNodes(initialNodes)` を呼んでユーザの drag 位置がリセットされてしまう。これを避けるため `roleStatus` 専用の effect で status だけ patch する。
- `roleStatus` 専用の effect 内の `setNodes` mapper は、status が変わったノードだけ新規 object、その他は元の参照を保持するように書いてある (`oldData.status === newStatus` early return)。これによって React Flow の re-render は status が変わったノードに限定される。

### Step 5-2: 既存テストが通ることを確認

```bash
cd /d/Projects/Misc/legion/.claude/worktrees/design-1
bun run --filter=@legion/web typecheck
bun test
```

Expected: 既存 canvas-overlay.test.tsx (data-id ベースの 3 件) は影響を受けない、全 green。

### Step 5-3: コミット

```bash
git branch --show-current
git add packages/web/src/components/CanvasOverlay.tsx
git commit -m "refactor(web): switch CanvasOverlay to useNodesState pattern"
```

---

## Task 6: 統合確認 + contract gate

- [ ] **Step 6-1: 全 typecheck と test を走らせる**

```bash
cd /d/Projects/Misc/legion/.claude/worktrees/design-1
bun run typecheck
bun run test
```

Expected: 全パッケージ 0 errors、全テスト green。テスト数は perf test (+3) - applyPositionChanges test (-3) + contract test (+3) = 計 +3 程度。

- [ ] **Step 6-2: contract test を単独で実行 (gate)**

```bash
bun test test/contracts/xyflow-applyNodeChanges.contract.test.ts
bun test test/components/TemplateCanvas.perf.test.tsx
```

(packages/web 配下からのパスで実行されるはず)

Expected:
- contract test 3 件 pass
- perf test 3 件 pass

両方 single-run でパスすることが mocks-require-contract policy のゲート。

- [ ] **Step 6-3: 手動 E2E (ユーザ実行)**

`docs/dev/manuals/user_test_manual.md` § 「フロー canvas のノードドラッグ」の 3 シナリオを手動で実行。

加えて、本 spec で fix した perf 問題に特有の確認:

- ノードを長押し&グリグリ動かしたとき、滑らかに追従するか
- ドラッグ中、タブタイトル先頭の `●` マークが点滅しないか
- ドラッグ中、`Unsaved changes` badge が点滅しないか
- ドラッグを離した瞬間に `●` と badge が出るか

完了時の差分や気付きは `docs/dev/handoff/` 配下の最新ファイルに追記する (legion の慣例)。

- [ ] **Step 6-4: 最終 git log 確認**

```bash
git log --oneline worktree-design-1 ^main
```

Expected: 元の 15 commit に加え、本 plan で 5〜6 件の commit が並ぶ。すべて英語、subject < 70 chars、Co-Authored-By なし。

---

## Done condition

- 全 check box が ✅
- `bun run typecheck` 0 errors
- `bun run test` 全 green
- `xyflow-applyNodeChanges.contract.test.ts` 単独 pass
- `TemplateCanvas.perf.test.tsx` 単独 pass
- 手動 E2E: ドラッグが滑らかに動く、badge / タブタイトル `●` がドラッグ中点滅しない
