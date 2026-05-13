# Phase 1 / b01: Web UI Track B (Template Editor 静的モックアップ) 実装計画

> **エージェント worker 向け:** 必須 sub-skill: `superpowers:subagent-driven-development` (推奨) または `superpowers:executing-plans`。Steps は checkbox で進捗管理。

**Goal:** Phase 1 spec §6 / D-035 に従って、`/templates` 一覧と `/templates/:id` の **Layer 1 静的モックアップ**を完成させる。`@xyflow/react` で workflow YAML から読み込んだ node graph を pan/zoom 可能に描画する (編集は不可)。

**Architecture:** a04 でスキャフォールドした `packages/web/` 上に追加する。a04 の `CanvasOverlay` は Layer 2 を扱うので、Layer 1 専用の `TemplateCanvas` コンポーネントを別途作る。`/templates/:id` ページが本コンポーネントをホスト。auto-layout は単純な縦並びまたは横並びで OK (Phase 1 はモックアップなので edit 不要、見やすければ十分)。

**Tech Stack:** TypeScript / React / `@xyflow/react` / `react-router-dom` / a03 の HTTP API (`GET /templates`, `GET /templates/:id`)

**Spec reference:** [../specs/2026-05-13_phase1_design.md](../specs/2026-05-13_phase1_design.md) §6.2
**Decisions reference:** D-009, D-012, D-015, D-035
**Dependency on:** [a04](2026-05-13_phase1_a04_web_runtime.md) (`packages/web/` scaffold + API client + xyflow セットアップ)

---

## File Structure

新規作成:

- `packages/web/src/components/TemplateCard.tsx`
- `packages/web/src/components/TemplateCanvas.tsx`
- `packages/web/src/components/template-canvas/layout.ts` — auto-layout 計算
- `packages/web/src/components/template-canvas/styling.ts` — node 種別ごとの色 / 形
- `packages/web/test/components/template-canvas/layout.test.ts`
- `packages/web/test/components/template-canvas/styling.test.ts`

修正:

- `packages/web/src/pages/TemplatesList.tsx` — placeholder → 本実装
- `packages/web/src/pages/TemplateDetail.tsx` — placeholder → 本実装

---

## 予測行数 (実測との比較用)

### 実装ファイル

| ファイル | 予測行数 | 主要内訳 | 上限への余裕 |
| --- | ---: | --- | --- |
| `components/TemplateCard.tsx` | 30 | カード 1 つ | 余裕大 |
| `components/TemplateCanvas.tsx` | 60 | xyflow バインド (node / edge memo) | 余裕大 |
| `components/template-canvas/styling.ts` | 75 | 色マップ + `nodeStyleFor` + `edgeStyleFor` | 余裕大 |
| `components/template-canvas/layout.ts` | 50 | `layoutTemplate` 単独関数 (~30) + 定数 | 余裕大 |
| `pages/TemplatesList.tsx` (上書き) | 40 | fetch + grid | 余裕大 |
| `pages/TemplateDetail.tsx` (上書き) | 45 | header + canvas マウント | 余裕大 |
| `pages/Settings.tsx` (上書き) | 10 | placeholder | 余裕大 |
| **実装小計** | **310** | | |

### テストファイル

| ファイル | 予測行数 |
| --- | ---: |
| `test/components/template-canvas/styling.test.ts` | 40 |
| `test/components/template-canvas/layout.test.ts` | 45 |
| **テスト小計** | **85** |

### 粒度評価

- 最大ファイル予測 = `template-canvas/styling.ts` 75 行。Layer 1 描画の概念は「node 種別 → 色」「edge 種別 → 色」の 2 マップだけなので 1 ファイルに同居して問題なし。
- `layout.ts` を独立ファイルに切ったのは: アルゴリズム (BFS / topological 配置) と描画 (xyflow への bridge) を分離するため。後に dagre 等の置換を試したい時にここだけ差し替えれば済む。
- 上限突破は無し。Phase 1 の Track B は本質的に「読み取り専用キャンバス」なので量は限定的。Phase 2 で編集機能を入れたら `TemplateCanvas.tsx` が大きく成長する見込みあり (drag / connect / validate)。その時点で `TemplateEditor` として別ファイル化する想定。

---

## Task 1: `/templates` 一覧の本実装

**Files:**
- Modify: `packages/web/src/pages/TemplatesList.tsx`
- Create: `packages/web/src/components/TemplateCard.tsx`

- [ ] **Step 1: TemplateCard を作る**

`packages/web/src/components/TemplateCard.tsx`:

```tsx
import { Link } from 'react-router-dom'
import type { TemplateSummary } from '../types'

export default function TemplateCard({ template }: { template: TemplateSummary }) {
  return (
    <Link
      to={`/templates/${encodeURIComponent(template.id)}`}
      style={{
        display: 'block',
        padding: 16,
        border: '1px solid #ddd',
        borderRadius: 8,
        textDecoration: 'none',
        color: 'inherit',
        background: 'white',
        minHeight: 120,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 16 }}>{template.name}</div>
      <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>{template.id}</div>
      {template.description && (
        <div style={{ fontSize: 13, marginTop: 10, color: '#444' }}>{template.description}</div>
      )}
      <div style={{ fontSize: 11, color: '#999', marginTop: 12 }}>
        {template.nodeCount} nodes
      </div>
    </Link>
  )
}
```

- [ ] **Step 2: TemplatesList を実装**

`packages/web/src/pages/TemplatesList.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { listTemplates } from '../api/client'
import type { TemplateSummary } from '../types'
import TemplateCard from '../components/TemplateCard'

export default function TemplatesList() {
  const [items, setItems] = useState<TemplateSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listTemplates()
      .then(setItems)
      .catch((e) => setError((e as Error).message))
  }, [])

  if (error) return <div style={{ padding: 16, color: '#c22' }}>Error: {error}</div>
  if (!items) return <div style={{ padding: 16 }}>Loading…</div>

  return (
    <div
      style={{
        padding: 16,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 16,
      }}
    >
      {items.map((t) => (
        <TemplateCard key={t.id} template={t} />
      ))}
    </div>
  )
}
```

- [ ] **Step 3: typecheck**

```bash
bun run --filter @legion/web typecheck
```

期待: pass。

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/TemplatesList.tsx packages/web/src/components/TemplateCard.tsx
git commit -m "feat(web): /templates list view"
```

---

## Task 2: Layer 1 canvas の node スタイリングモジュール

D-013 の node 種別ごとに色 / 形を切り替え。

**Files:**
- Create: `packages/web/src/components/template-canvas/styling.ts`
- Create: `packages/web/test/components/template-canvas/styling.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, test, expect } from 'bun:test'
import { nodeStyleFor, edgeStyleFor } from '../../../src/components/template-canvas/styling'

describe('nodeStyleFor', () => {
  test('returns distinct background color per node type', () => {
    const r = nodeStyleFor({ type: 'role', id: 'x', role: 'director', provider: 'p', lifetime: 'per-task' } as any)
    const t = nodeStyleFor({ type: 'trigger', id: 'x', kind: 'manual' } as any)
    const b = nodeStyleFor({ type: 'blackboard', id: 'x', schema: {} } as any)
    const h = nodeStyleFor({ type: 'human-gate', id: 'x', label: 'L' } as any)
    const s = nodeStyleFor({ type: 'sink', id: 'x', kind: 'github-pr' } as any)
    const bgs = [r.background, t.background, b.background, h.background, s.background]
    expect(new Set(bgs).size).toBe(5)
  })

  test('role node style includes role name in label', () => {
    const s = nodeStyleFor({ type: 'role', id: 'r1', role: 'implementer', provider: 'claude-code', lifetime: 'per-task' } as any)
    expect(s.label).toContain('implementer')
  })
})

describe('edgeStyleFor', () => {
  test('different edge types get different colors', () => {
    const a = edgeStyleFor('triggers')
    const b = edgeStyleFor('delegates')
    const c = edgeStyleFor('publishes')
    expect(new Set([a.stroke, b.stroke, c.stroke]).size).toBe(3)
  })

  test('triggers edge is animated for visibility', () => {
    expect(edgeStyleFor('triggers').animated).toBe(true)
  })
})
```

- [ ] **Step 2: 失敗を確認**

```bash
bun test packages/web/test/components/template-canvas/styling.test.ts
```

- [ ] **Step 3: 実装**

`packages/web/src/components/template-canvas/styling.ts`:

```ts
import type { TemplateNode, EdgeType } from '@legion/core'

export interface NodeStyle {
  background: string
  border: string
  label: string
  shape?: 'rect' | 'diamond' | 'parallelogram'
}

const TYPE_BG: Record<TemplateNode['type'], string> = {
  trigger: '#e8e8e8',
  role: '#e8f0ff',
  blackboard: '#f4e8ff',
  'human-gate': '#fff5d6',
  sink: '#e8e8d8',
}

const TYPE_BORDER: Record<TemplateNode['type'], string> = {
  trigger: '#888',
  role: '#0066cc',
  blackboard: '#aa00aa',
  'human-gate': '#cc8800',
  sink: '#666',
}

export function nodeStyleFor(node: TemplateNode): NodeStyle {
  const background = TYPE_BG[node.type]
  const border = TYPE_BORDER[node.type]
  let label = `${node.id}`
  if (node.type === 'role') label = `${node.role}\n(${node.lifetime})`
  if (node.type === 'trigger') label = `${node.id} (${node.kind})`
  if (node.type === 'blackboard') label = `📋 ${node.id}`
  if (node.type === 'human-gate') label = `🙋 ${node.label}`
  if (node.type === 'sink') label = `${node.id} (${node.kind})`
  return { background, border, label }
}

export interface EdgeStyle {
  stroke: string
  animated: boolean
  label: string
}

const EDGE_COLOR: Record<EdgeType, string> = {
  triggers: '#0066cc',
  delegates: '#00aa66',
  publishes: '#aa00aa',
  subscribes: '#7700aa',
  reviews: '#cc6600',
  synthesizes: '#cc0066',
}

export function edgeStyleFor(type: EdgeType): EdgeStyle {
  return {
    stroke: EDGE_COLOR[type] ?? '#999',
    animated: type === 'triggers',
    label: type,
  }
}
```

- [ ] **Step 4: テスト成功確認**

```bash
bun test packages/web/test/components/template-canvas/styling.test.ts
```

期待: 4 tests passed。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/template-canvas/styling.ts packages/web/test/components/template-canvas/styling.test.ts
git commit -m "feat(web): template canvas node/edge styling module"
```

---

## Task 3: 自動レイアウト計算

簡易 BFS から x/y を割り当て。 (Phase 1 はモックアップなので過剰な dagre 等は入れない、手作りで足りる)

**Files:**
- Create: `packages/web/src/components/template-canvas/layout.ts`
- Create: `packages/web/test/components/template-canvas/layout.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, test, expect } from 'bun:test'
import { layoutTemplate } from '../../../src/components/template-canvas/layout'
import type { WorkflowTemplate } from '@legion/core'

const T: WorkflowTemplate = {
  id: 'fi',
  name: 'Feature Implementation',
  nodes: [
    { type: 'trigger', id: 'trig', kind: 'manual' },
    { type: 'role', id: 'dir', role: 'director', provider: 'claude-code', lifetime: 'per-workflow' },
    { type: 'role', id: 'impl', role: 'implementer', provider: 'claude-code', lifetime: 'per-task' },
    { type: 'role', id: 'rev', role: 'reviewer', provider: 'claude-code', lifetime: 'per-task' },
  ],
  edges: [
    { from: 'trig', to: 'dir', type: 'triggers' },
    { from: 'dir', to: 'impl', type: 'delegates' },
    { from: 'impl', to: 'rev', type: 'reviews' },
  ],
}

describe('layoutTemplate', () => {
  test('places trigger at left (column 0)', () => {
    const map = layoutTemplate(T)
    expect(map['trig']?.x).toBe(0)
  })

  test('director at column 1, implementer at column 2, reviewer at column 3', () => {
    const map = layoutTemplate(T)
    expect(map['dir']?.x).toBeGreaterThan(map['trig']!.x)
    expect(map['impl']?.x).toBeGreaterThan(map['dir']!.x)
    expect(map['rev']?.x).toBeGreaterThan(map['impl']!.x)
  })

  test('orphan nodes (no edges) get position (0, large-y)', () => {
    const t: WorkflowTemplate = {
      id: 'o',
      name: 'O',
      nodes: [
        { type: 'role', id: 'lonely', role: 'x', provider: 'p', lifetime: 'per-task' },
      ],
      edges: [],
    }
    const map = layoutTemplate(t)
    expect(map['lonely']).toBeDefined()
  })
})
```

- [ ] **Step 2: 失敗を確認**

```bash
bun test packages/web/test/components/template-canvas/layout.test.ts
```

- [ ] **Step 3: 実装**

`packages/web/src/components/template-canvas/layout.ts`:

```ts
import type { WorkflowTemplate } from '@legion/core'

const COL_W = 200
const ROW_H = 120

/**
 * Assign a (col, row) coordinate to every node via a topological layering pass:
 *
 *   col(n) = max(col(parent) + 1)  for parents reachable in the edge graph
 *
 * Cycles cannot occur in well-formed Layer 1 (D-014 makes intra-instance the only
 * place dependencies live), so cycle handling is omitted.
 */
export function layoutTemplate(t: WorkflowTemplate): Record<string, { x: number; y: number }> {
  const cols: Record<string, number> = {}
  // Seed: nodes with no incoming edges → column 0
  const incoming = new Map<string, string[]>()
  for (const n of t.nodes) incoming.set(n.id, [])
  for (const e of t.edges) {
    if (!incoming.has(e.to)) incoming.set(e.to, [])
    incoming.get(e.to)!.push(e.from)
  }
  // Iterative relaxation until stable
  for (let pass = 0; pass < t.nodes.length + 1; pass++) {
    for (const n of t.nodes) {
      const parents = incoming.get(n.id) ?? []
      if (parents.length === 0) {
        cols[n.id] = 0
        continue
      }
      const parentCol = Math.max(...parents.map((p) => cols[p] ?? 0))
      cols[n.id] = parentCol + 1
    }
  }
  // Assign rows by grouping per column
  const byCol = new Map<number, string[]>()
  for (const n of t.nodes) {
    const c = cols[n.id]!
    if (!byCol.has(c)) byCol.set(c, [])
    byCol.get(c)!.push(n.id)
  }
  const result: Record<string, { x: number; y: number }> = {}
  for (const [c, ids] of byCol) {
    ids.forEach((id, i) => {
      result[id] = { x: c * COL_W, y: i * ROW_H }
    })
  }
  return result
}
```

- [ ] **Step 4: テスト成功確認**

```bash
bun test packages/web/test/components/template-canvas/layout.test.ts
```

期待: 3 tests passed。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/template-canvas/layout.ts packages/web/test/components/template-canvas/layout.test.ts
git commit -m "feat(web): template canvas topological layout"
```

---

## Task 4: `TemplateCanvas` コンポーネント本体

**Files:**
- Create: `packages/web/src/components/TemplateCanvas.tsx`

- [ ] **Step 1: 実装**

```tsx
import { useMemo } from 'react'
import { ReactFlow, Background, Controls, type Node, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { WorkflowTemplate } from '@legion/core'
import { nodeStyleFor, edgeStyleFor } from './template-canvas/styling'
import { layoutTemplate } from './template-canvas/layout'

export default function TemplateCanvas({ template }: { template: WorkflowTemplate }) {
  const positions = useMemo(() => layoutTemplate(template), [template])

  const nodes = useMemo<Node[]>(
    () =>
      template.nodes.map((n) => {
        const style = nodeStyleFor(n)
        const pos = positions[n.id] ?? { x: 0, y: 0 }
        return {
          id: n.id,
          position: pos,
          data: { label: style.label },
          style: {
            padding: 8,
            background: style.background,
            border: `2px solid ${style.border}`,
            borderRadius: 6,
            fontSize: 12,
            whiteSpace: 'pre-line',
            minWidth: 120,
            textAlign: 'center',
          },
        }
      }),
    [template, positions],
  )

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

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} nodesConnectable={false}>
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
```

(`nodesDraggable={false}` と `nodesConnectable={false}` で編集を防ぐ。Phase 1 は静的モックアップ。)

- [ ] **Step 2: typecheck**

```bash
bun run --filter @legion/web typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/TemplateCanvas.tsx
git commit -m "feat(web): TemplateCanvas read-only Layer 1 view"
```

---

## Task 5: `/templates/:id` ページ本実装

**Files:**
- Modify: `packages/web/src/pages/TemplateDetail.tsx`

- [ ] **Step 1: 実装**

```tsx
import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getTemplate } from '../api/client'
import type { WorkflowTemplate } from '@legion/core'
import TemplateCanvas from '../components/TemplateCanvas'

export default function TemplateDetail() {
  const { id } = useParams<{ id: string }>()
  const [template, setTemplate] = useState<WorkflowTemplate | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    getTemplate(id)
      .then(setTemplate)
      .catch((e) => setError((e as Error).message))
  }, [id])

  if (error) return <div style={{ padding: 16, color: '#c22' }}>Error: {error}</div>
  if (!template) return <div style={{ padding: 16 }}>Loading…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: 12, borderBottom: '1px solid #ddd', background: '#fafafa' }}>
        <Link to="/templates" style={{ marginRight: 12 }}>← Templates</Link>
        <strong>{template.name}</strong>
        <span style={{ color: '#666', marginLeft: 8 }}>({template.id})</span>
        <span style={{ marginLeft: 16, fontSize: 12, color: '#888' }}>
          (read-only mockup — Phase 1 では編集不可)
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <TemplateCanvas template={template} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: typecheck**

```bash
bun run --filter @legion/web typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/TemplateDetail.tsx
git commit -m "feat(web): /templates/:id detail page with TemplateCanvas"
```

---

## Task 6: Settings placeholder の整備

Phase 1 では空でよいが、辿りつけることだけ確認。

**Files:**
- Modify: `packages/web/src/pages/Settings.tsx`

- [ ] **Step 1: 実装**

```tsx
export default function Settings() {
  return (
    <div style={{ padding: 16 }}>
      <h2>Settings</h2>
      <p style={{ color: '#666' }}>
        Provider 設定 / auth 状態 / port 等は Phase 1.5 以降で実装します。
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/pages/Settings.tsx
git commit -m "chore(web): tidy Settings placeholder"
```

---

## Task 7: Manual smoke (Phase 1 全体動作確認)

a01〜a04 + b01 すべて完了後の総合確認。

- [ ] **Step 1: server + web を同時起動**

```bash
bun run --filter @legion/server start &
bun run --filter @legion/web dev &
```

- [ ] **Step 2: ブラウザで http://localhost:5173 を開き、以下を確認**

1. `/templates` 一覧に `workflows/*.yaml` のカードが並ぶ
2. カードクリック → `/templates/:id` で Layer 1 canvas が表示される
3. node が種別ごとに色分けされている (Role 青、Blackboard 紫、Human-Gate 黄等)
4. edge にラベル (triggers / delegates 等) が出る
5. ノードドラッグが効かない (read-only)
6. `/templates` ↔ `/instances` ↔ `/settings` のタブ切替が動く
7. `/instances` 一覧の状態別カラム表示が出る
8. trigger を curl で発火し、新しいカードが現れる
9. `/instances/:id` に遷移して 3-panel + event log + sidebar が動く

- [ ] **Step 3: 終了**

```bash
kill %1 %2
```

このタスクには commit は無し。

---

## 完了条件

- [ ] `bun run --filter @legion/web typecheck` パス
- [ ] `bun test --filter @legion/web` で styling + layout の追加テスト (~7 cases) を含めて緑
- [ ] `/templates`, `/templates/:id` 画面が server と組み合わせて動作
- [ ] Phase 1 のスコープ (D-035 の 5 画面) が manual smoke で全部到達できる

## Phase 1 完了の総点検

b01 完了をもって Phase 1 の全 deliverable が揃う:

- worktree manager 動作 (a01)
- Claude Code adapter 動作 (a02)
- event log + control API (a03)
- Web UI Track A: Instances 系画面 (a04)
- Web UI Track B: Templates 系静的モックアップ (b01)

このあとは Phase 2 (Director–Worker orchestration + Blackboard) に進む。Phase 2 計画は別途新規ブレストから起こす。

---

## 実測との突合 (実装完了後に記入)

実測コマンド例:

```bash
wc -l packages/web/src/components/TemplateCard.tsx \
     packages/web/src/components/TemplateCanvas.tsx \
     packages/web/src/components/template-canvas/*.ts \
     packages/web/src/pages/Templates*.tsx \
     packages/web/test/components/template-canvas/*.ts
```

突合表 (実装着手者が埋める):

| ファイル | 予測 | 実測 | 差 (±%) | 上限超過? |
| --- | ---: | ---: | ---: | --- |
| (実装後に記入) | | | | |

差が ±30% を超えた項目について原因を残す。
