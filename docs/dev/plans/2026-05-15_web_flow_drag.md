# Web Flow Drag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** legion web の Template / Instance フロー canvas でノードを drag できるようにする。Template の位置は YAML マスターに `yaml` package の Document API でコメント保持しつつ書き戻す。Instance は in-session のみ。

**Architecture:** `TemplateNode` に optional `position?: { x, y }` を追加。`runtime/template/writer.ts` (新規) が Document API で位置だけを upsert。Server は `PATCH /api/templates/:id/positions` で受け取り、`TemplateRegistry.refreshOne(id)` でメモリキャッシュを更新。Web は `nodesDraggable=true` で drag を解禁し、Template 側のみ Save ボタン + "Unsaved changes" badge + `beforeunload` 警告 + タブタイトル `●` を付ける。位置のない既存ノードは現行 `layoutTemplate()` の topological sort を fallback。

**Tech Stack:** TypeScript 5.7, Bun (test runner), `yaml@2.9.0` (Document API), React 19, `@xyflow/react@12.x`, `@testing-library/react@16.x` + `happy-dom@20.x`.

**Spec reference:** [docs/dev/specs/2026-05-15_web_flow_drag_design.md](../specs/2026-05-15_web_flow_drag_design.md)

**Scope:** `packages/core` / `packages/runtime` / `packages/server` / `packages/web`。`packages/cli` には触らない。Phase 3 完了後 (`cc396ce` 時点) の main をベースとする。

---

## File Structure

### Create

| Path | Responsibility | 予測行数 |
| --- | --- | --- |
| `packages/runtime/src/template/writer.ts` | YAML Document API でノードの position を upsert する純関数 + ファイル書き出し関数 | ~80 |
| `packages/runtime/test/template/writer.test.ts` | `applyPositions` 純関数の unit test (コメント保持 / flow style / 未知 ID) | ~80 |
| `packages/runtime/test/template/writer.contract.test.ts` | 実 YAML を tmpdir コピーして write → loader 往復 | ~80 |
| `packages/web/test/components/TemplateCanvas.test.tsx` | drag で dirty 発火 / saveSignal でリセット | ~100 |
| `packages/web/test/integration/template-save.integration.test.tsx` | 本物サーバ起動 → drag → Save → reload | ~120 |

### Modify

| Path | Change | 予測増減 |
| --- | --- | --- |
| `packages/core/src/types/template.ts` | `NodePosition` interface 追加、5 ノード型に `position?: NodePosition` | +8 |
| `packages/runtime/src/template/loader.ts` | `parsePosition` 追加、`parseNode` 末尾で結合 | +25 |
| `packages/runtime/src/template/registry.ts` | `Entry` 内部型、`sourcePathOf` / `refreshOne` 追加 | +20 |
| `packages/runtime/src/index.ts` | `./template/writer` を export に追加 | +1 |
| `packages/runtime/package.json` | `./template/writer` を `exports` に追加 | +1 |
| `packages/runtime/test/template/loader.test.ts` | position パース正常系 / 異常系 | +30 |
| `packages/runtime/test/template/registry.test.ts` | `sourcePathOf` / `refreshOne` | +30 |
| `packages/server/src/http/handlers/templates.ts` | `PATCH` 分岐 + `validatePositions` | +60 |
| `packages/server/test/handlers/templates.test.ts` | PATCH 200/400/404 ケース | +90 |
| `packages/web/src/api/client.ts` | `patchTemplatePositions` 関数 | +15 |
| `packages/web/src/components/template-canvas/layout.ts` | `layoutTemplate` を position? 優先 + auto fallback に再構成、`applyPositionChanges` helper を export | +30 |
| `packages/web/test/components/template-canvas/layout.test.ts` | position? 優先 / applyPositionChanges 単体 | +50 |
| `packages/web/src/components/TemplateCanvas.tsx` | overrides state、props 拡張、`nodesDraggable=true` | +30 |
| `packages/web/src/pages/TemplateDetail.tsx` | Save / Reset / badge / beforeunload / document.title | +60 |
| `packages/web/src/components/CanvasOverlay.tsx` | overrides state、`layoutTemplate` 共有、grid 計算除去 | +15 / -3 |
| `packages/web/test/components/canvas-overlay.test.tsx` | 既存 assertion が壊れていないか確認 (今は data-id ベース、layout 値は assert していない) | 変更なし or 微修正 |
| `docs/dev/manuals/user_test_manual.md` | drag シナリオ手動確認 runbook 追加 | +30 |

---

## Pre-flight

- [ ] **Step P1: ブランチと spec を確認**

```bash
git branch --show-current
ls docs/dev/specs/2026-05-15_web_flow_drag_design.md
```

Expected:
- branch: `worktree-design-1`
- spec ファイルが存在する

- [ ] **Step P2: ベースラインのテストと型チェックが全パッケージ通る**

```bash
bun install
bun run typecheck
bun run test
```

Expected: 両方とも green。途中で fail する場合は spec 実装前の base が壊れているので、その fail を main で fix してからここに戻る。

- [ ] **Step P3: 関連既存ファイルを把握しておく**

```bash
ls workflows/
cat packages/web/src/components/TemplateCanvas.tsx | head -20
cat packages/web/src/components/CanvasOverlay.tsx | head -30
```

Expected:
- `workflows/` に `feature-implementation.yaml` / `feature-with-review.yaml` / `bug-fix.yaml` がある
- `TemplateCanvas.tsx` が `nodesDraggable={false}` で固定化されているのが見える
- `CanvasOverlay.tsx` が `position: { x: (i % 4) * 180, y: Math.floor(i / 4) * 100 }` で grid 配置しているのが見える

---

## Task 1: core types に NodePosition を追加

**Files:**

- Modify: `packages/core/src/types/template.ts`

このタスクは型のみ。ランタイム test は Task 2 で loader と一緒に書く (型の存在は loader test がカバーする)。

- [ ] **Step 1-1: `NodePosition` interface と 5 ノード型に `position?` を追加**

`packages/core/src/types/template.ts` の冒頭付近 (`export type EdgeType` の前あたり) に追加:

```ts
export interface NodePosition {
  x: number
  y: number
}
```

`RoleNode` / `TriggerNode` / `BlackboardNode` / `HumanGateNode` / `SinkNode` の各 interface 末尾に同じ 1 行を追加:

```ts
  position?: NodePosition
```

- [ ] **Step 1-2: core パッケージ単体で typecheck が通ることを確認**

```bash
bun run --filter=@legion/core typecheck
```

Expected: 0 errors.

`@legion/core` には別途 test はない (型定義のみのパッケージ) ので、ここでは typecheck だけで完結。

- [ ] **Step 1-3: 影響パッケージの typecheck**

```bash
bun run --filter=@legion/runtime typecheck
bun run --filter=@legion/server typecheck
bun run --filter=@legion/web typecheck
```

Expected: 全部 0 errors。`position?` は optional なので既存コードは何も変更を要求されない。

- [ ] **Step 1-4: コミット**

```bash
git add packages/core/src/types/template.ts
git commit -m "feat(core): add optional position field to TemplateNode types"
```

---

## Task 2: runtime loader が `position` をパース

**Files:**

- Modify: `packages/runtime/src/template/loader.ts`
- Modify: `packages/runtime/test/template/loader.test.ts`

- [ ] **Step 2-1: 失敗するテストを追加**

`packages/runtime/test/template/loader.test.ts` の `describe('loadWorkflowTemplate', ...)` の末尾に追加:

```ts
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
```

- [ ] **Step 2-2: テストが期待通り fail することを確認**

```bash
bun test packages/runtime/test/template/loader.test.ts
```

Expected: `parses position field on nodes` が `expect(t.nodes[0]!.position).toEqual(...)` で fail (loader が position を取り出さないので undefined)。

- [ ] **Step 2-3: `parsePosition` を実装し `parseNode` から呼ぶ**

`packages/runtime/src/template/loader.ts` を編集。import に `NodePosition` を加える:

```ts
import type {
  WorkflowTemplate,
  TemplateNode,
  TemplateEdge,
  EdgeType,
  NodePosition,
} from '@legion/core'
```

`parseNode` の return 直前に position 取り込みを加える:

```ts
function parseNode(raw: unknown, file: string, idx: number): TemplateNode {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${file}: nodes[${idx}] must be an object`)
  }
  const n = raw as Record<string, unknown>
  if (typeof n['id'] !== 'string' || typeof n['type'] !== 'string') {
    throw new Error(`${file}: nodes[${idx}] missing id or type`)
  }
  if (!KNOWN_NODE_TYPES.has(n['type'])) {
    throw new Error(`${file}: nodes[${idx}] unknown type '${n['type']}'`)
  }
  const position = parsePosition(n['position'], file, idx)
  const out = position ? { ...n, position } : n
  return out as unknown as TemplateNode
}

function parsePosition(raw: unknown, file: string, idx: number): NodePosition | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${file}: nodes[${idx}].position must be an object`)
  }
  const p = raw as Record<string, unknown>
  if (typeof p['x'] !== 'number' || typeof p['y'] !== 'number') {
    throw new Error(`${file}: nodes[${idx}].position requires numeric x and y`)
  }
  if (!Number.isFinite(p['x']) || !Number.isFinite(p['y'])) {
    throw new Error(`${file}: nodes[${idx}].position must be finite numbers`)
  }
  return { x: p['x'], y: p['y'] }
}
```

- [ ] **Step 2-4: テストが pass することを確認**

```bash
bun test packages/runtime/test/template/loader.test.ts
```

Expected: 3 つの新規テスト + 既存 4 つ、合計 7 つすべて pass。

- [ ] **Step 2-5: コミット**

```bash
git add packages/runtime/src/template/loader.ts packages/runtime/test/template/loader.test.ts
git commit -m "feat(runtime): parse optional position on template nodes"
```

---

## Task 3: runtime writer (YAML round-trip)

**Files:**

- Create: `packages/runtime/src/template/writer.ts`
- Create: `packages/runtime/test/template/writer.test.ts`
- Modify: `packages/runtime/package.json` (exports に `./template/writer` を追加)

- [ ] **Step 3-1: 失敗するテストを書く**

`packages/runtime/test/template/writer.test.ts` を新規作成:

```ts
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
    // id key still appears before type key
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
```

- [ ] **Step 3-2: writer.ts が無い状態でテスト実行 → import エラーで fail することを確認**

```bash
bun test packages/runtime/test/template/writer.test.ts
```

Expected: モジュール解決エラー or import fail。

- [ ] **Step 3-3: writer.ts を実装**

`packages/runtime/src/template/writer.ts` を新規作成:

```ts
import { readFile, writeFile } from 'node:fs/promises'
import { parseDocument, isMap, isSeq, type Document } from 'yaml'
import type { NodePosition } from '@legion/core'

export type PositionMap = Record<string, NodePosition>

/**
 * Read sourcePath, update or insert `position` fields for the listed nodes,
 * and write the file back. Comments and key ordering are preserved by
 * round-tripping through yaml's Document API.
 */
export async function writeTemplatePositions(
  sourcePath: string,
  positions: PositionMap,
): Promise<void> {
  const text = await readFile(sourcePath, 'utf-8')
  const doc = parseDocument(text)
  applyPositions(doc, positions)
  await writeFile(sourcePath, doc.toString())
}

/**
 * Apply position updates to a parsed Document in place. Exported for unit
 * testing — production callers should prefer writeTemplatePositions.
 */
export function applyPositions(doc: Document, positions: PositionMap): void {
  const nodes = doc.get('nodes')
  if (!isSeq(nodes)) throw new Error('template has no nodes sequence')

  const idsInYaml = new Set<string>()
  for (const item of nodes.items) {
    if (!isMap(item)) continue
    const id = item.get('id')
    if (typeof id === 'string') idsInYaml.add(id)
  }
  for (const id of Object.keys(positions)) {
    if (!idsInYaml.has(id)) {
      throw new Error(`unknown node id in positions: ${id}`)
    }
  }

  for (const item of nodes.items) {
    if (!isMap(item)) continue
    const id = item.get('id')
    if (typeof id !== 'string') continue
    const pos = positions[id]
    if (!pos) continue
    item.set('position', doc.createNode(pos, { flow: true }))
  }
}
```

- [ ] **Step 3-4: パッケージ exports に追加**

`packages/runtime/package.json` の `exports` に追記:

```json
    "./template/writer": "./src/template/writer.ts",
```

(他の `./template/*` エントリと並べる)

- [ ] **Step 3-5: テストが pass することを確認**

```bash
bun test packages/runtime/test/template/writer.test.ts
```

Expected: 5 つすべて pass。

- [ ] **Step 3-6: コミット**

```bash
git add packages/runtime/src/template/writer.ts packages/runtime/test/template/writer.test.ts packages/runtime/package.json
git commit -m "feat(runtime): add YAML position writer with Document API"
```

---

## Task 4: runtime writer contract test (real YAML round-trip)

**Files:**

- Create: `packages/runtime/test/template/writer.contract.test.ts`

このテストは「`yaml@2.x` package が実際の YAML ファイルを comment-preserving に round-trip できる」という前提を contract として固定化する。SDK bump のときに必ず走らせる。

- [ ] **Step 4-1: contract test を書く**

`packages/runtime/test/template/writer.contract.test.ts` を新規作成:

```ts
// Mock-pair contract test for packages/runtime/src/template/writer.ts.
// representing:   yaml@2.9.x parseDocument + Document.toString round-trip
// verified on:    <implementation date>, against workflows/feature-with-review.yaml
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
```

- [ ] **Step 4-2: 実装日を埋める**

ヘッダコメントの `<implementation date>` を `2026-05-15` (or 着手当日) に書き換える。

- [ ] **Step 4-3: テスト実行**

```bash
bun test packages/runtime/test/template/writer.contract.test.ts
```

Expected: 2 つの test が pass。1 つ目で `feature-with-review.yaml` の `description: |` ブロックが保たれること、新規 position が flow style で挿入されること、loader が再パースできることを検証。

- [ ] **Step 4-4: コミット**

```bash
git add packages/runtime/test/template/writer.contract.test.ts
git commit -m "test(runtime): add YAML writer round-trip contract test"
```

---

## Task 5: runtime registry に sourcePathOf / refreshOne

**Files:**

- Modify: `packages/runtime/src/template/registry.ts`
- Modify: `packages/runtime/test/template/registry.test.ts`

- [ ] **Step 5-1: 失敗するテストを追加**

`packages/runtime/test/template/registry.test.ts` の `describe('TemplateRegistry', ...)` の末尾に追加:

```ts
test('sourcePathOf returns the YAML path for known templates', async () => {
  const reg = new TemplateRegistry(join(REPO_ROOT, 'workflows'))
  await reg.refresh()
  const p = reg.sourcePathOf('feature-implementation')
  expect(p).toMatch(/feature-implementation\.yaml$/)
})

test('sourcePathOf returns undefined for unknown id', async () => {
  const reg = new TemplateRegistry(join(REPO_ROOT, 'workflows'))
  await reg.refresh()
  expect(reg.sourcePathOf('nope')).toBeUndefined()
})

test('refreshOne reloads a single template from disk', async () => {
  const reg = new TemplateRegistry(join(REPO_ROOT, 'workflows'))
  await reg.refresh()
  // before: no position on director
  const before = reg.get('feature-with-review')!
  const dir1 = before.nodes.find((n) => n.id === 'director')!
  expect(dir1.position).toBeUndefined()

  // We don't actually mutate the YAML on disk in this test; just call
  // refreshOne and verify it returns successfully and re-reads the file.
  await reg.refreshOne('feature-with-review')
  const after = reg.get('feature-with-review')!
  expect(after.id).toBe('feature-with-review')
})

test('refreshOne throws for unknown id', async () => {
  const reg = new TemplateRegistry(join(REPO_ROOT, 'workflows'))
  await reg.refresh()
  await expect(reg.refreshOne('nope')).rejects.toThrow(/unknown template/)
})
```

- [ ] **Step 5-2: テスト fail を確認**

```bash
bun test packages/runtime/test/template/registry.test.ts
```

Expected: 既存 3 つ + 新規 4 つの test が走るが、`sourcePathOf` / `refreshOne` が無いので `is not a function` で fail。

- [ ] **Step 5-3: registry を実装**

`packages/runtime/src/template/registry.ts` を全面書き換え:

```ts
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorkflowTemplate } from '@legion/core'
import { loadWorkflowTemplate } from './loader'

interface Entry {
  template: WorkflowTemplate
  sourcePath: string
}

export class TemplateRegistry {
  private entries = new Map<string, Entry>()

  constructor(private readonly dir: string) {}

  async refresh(): Promise<void> {
    const files = await readdir(this.dir)
    const next = new Map<string, Entry>()
    for (const name of files) {
      if (!/\.ya?ml$/i.test(name)) continue
      const sourcePath = join(this.dir, name)
      const template = await loadWorkflowTemplate(sourcePath)
      next.set(template.id, { template, sourcePath })
    }
    this.entries = next
  }

  async refreshOne(id: string): Promise<void> {
    const existing = this.entries.get(id)
    if (!existing) throw new Error(`unknown template: ${id}`)
    const template = await loadWorkflowTemplate(existing.sourcePath)
    this.entries.set(id, { template, sourcePath: existing.sourcePath })
  }

  list(): WorkflowTemplate[] {
    return [...this.entries.values()].map((e) => e.template)
  }

  get(id: string): WorkflowTemplate | undefined {
    return this.entries.get(id)?.template
  }

  sourcePathOf(id: string): string | undefined {
    return this.entries.get(id)?.sourcePath
  }
}
```

- [ ] **Step 5-4: テスト pass を確認**

```bash
bun test packages/runtime/test/template/registry.test.ts
```

Expected: 既存 3 + 新規 4 = 7 個すべて pass。

- [ ] **Step 5-5: 周辺パッケージの typecheck**

```bash
bun run --filter=@legion/runtime typecheck
bun run --filter=@legion/server typecheck
```

Expected: 0 errors。

- [ ] **Step 5-6: コミット**

```bash
git add packages/runtime/src/template/registry.ts packages/runtime/test/template/registry.test.ts
git commit -m "feat(runtime): track template source path + add refreshOne"
```

---

## Task 6: server PATCH /api/templates/:id/positions

**Files:**

- Modify: `packages/server/src/http/handlers/templates.ts`
- Modify: `packages/server/test/handlers/templates.test.ts`

- [ ] **Step 6-1: 失敗するテストを追加**

`packages/server/test/handlers/templates.test.ts` の末尾に新規 `describe` ブロックを追加。テンプレ書き換えのテストは fs を汚すので、各テスト前に対象 YAML をバックアップしてリストアする方式にする:

```ts
import { readFile, writeFile } from 'node:fs/promises'

describe('PATCH /api/templates/:id/positions', () => {
  const yamlPath = join(REPO_ROOT, 'workflows', 'feature-with-review.yaml')
  let originalYaml: string

  beforeEach(async () => {
    originalYaml = await readFile(yamlPath, 'utf-8')
  })
  afterEach(async () => {
    await writeFile(yamlPath, originalYaml)
  })

  test('writes positions and returns updated template (200)', async () => {
    const res = await fetch(
      `http://localhost:${server.port}/api/templates/feature-with-review/positions`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          positions: { director: { x: 50, y: 60 } },
        }),
      },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { nodes: Array<{ id: string; position?: { x: number; y: number } }> }
    const dir = body.nodes.find((n) => n.id === 'director')!
    expect(dir.position).toEqual({ x: 50, y: 60 })
  })

  test('returns 404 for unknown template', async () => {
    const res = await fetch(
      `http://localhost:${server.port}/api/templates/nope/positions`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ positions: {} }),
      },
    )
    expect(res.status).toBe(404)
  })

  test('returns 400 for unknown node id', async () => {
    const res = await fetch(
      `http://localhost:${server.port}/api/templates/feature-with-review/positions`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ positions: { ghost: { x: 0, y: 0 } } }),
      },
    )
    expect(res.status).toBe(400)
  })

  test('returns 400 for non-finite numbers', async () => {
    const res = await fetch(
      `http://localhost:${server.port}/api/templates/feature-with-review/positions`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ positions: { director: { x: 0, y: 1e400 } } }),
      },
    )
    expect(res.status).toBe(400)
  })

  test('returns 400 for malformed body', async () => {
    const res = await fetch(
      `http://localhost:${server.port}/api/templates/feature-with-review/positions`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      },
    )
    expect(res.status).toBe(400)
  })

  test('subsequent GET reflects the persisted positions (registry hot reload)', async () => {
    await fetch(
      `http://localhost:${server.port}/api/templates/feature-with-review/positions`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ positions: { director: { x: 11, y: 22 } } }),
      },
    )
    const get = await fetch(`http://localhost:${server.port}/api/templates/feature-with-review`)
    const body = (await get.json()) as { nodes: Array<{ id: string; position?: { x: number; y: number } }> }
    const dir = body.nodes.find((n) => n.id === 'director')!
    expect(dir.position).toEqual({ x: 11, y: 22 })
  })
})
```

- [ ] **Step 6-2: テスト fail を確認**

```bash
bun test packages/server/test/handlers/templates.test.ts
```

Expected: 既存 3 + 新規 6 = 9。新規 6 つ全てが 405 (Method Not Allowed) で fail (現状 PATCH ハンドラが無い)。

- [ ] **Step 6-3: PATCH ハンドラを実装**

`packages/server/src/http/handlers/templates.ts` を編集:

```ts
import type { AppRuntime } from '../../app'
import type { WorkflowTemplate } from '@legion/core'
import {
  writeTemplatePositions,
  type PositionMap,
} from '@legion/runtime/template/writer'

export async function handleTemplates(
  req: Request,
  ctx: AppRuntime,
): Promise<Response> {
  const url = new URL(req.url)

  if (url.pathname === '/api/templates' && req.method === 'GET') {
    const list = ctx.options.templates.list().map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description ?? null,
      nodeCount: t.nodes.length,
    }))
    return Response.json(list)
  }

  const patchMatch = url.pathname.match(/^\/api\/templates\/([^/]+)\/positions$/)
  if (patchMatch && req.method === 'PATCH') {
    const id = patchMatch[1]!
    const sourcePath = ctx.options.templates.sourcePathOf(id)
    const template = ctx.options.templates.get(id)
    if (!sourcePath || !template) return new Response('Not Found', { status: 404 })

    const body = await req.json().catch(() => null)
    const validated = validatePositions(body, template)
    if ('error' in validated) {
      return new Response(validated.error, { status: 400 })
    }

    try {
      await writeTemplatePositions(sourcePath, validated.value)
      await ctx.options.templates.refreshOne(id)
    } catch (e) {
      return new Response(`write failed: ${(e as Error).message}`, { status: 500 })
    }
    return Response.json(ctx.options.templates.get(id))
  }

  const getMatch = url.pathname.match(/^\/api\/templates\/([^/]+)$/)
  if (getMatch && req.method === 'GET') {
    const t = ctx.options.templates.get(getMatch[1]!)
    if (!t) return new Response('Not Found', { status: 404 })
    return Response.json(t)
  }

  return new Response('Method Not Allowed', { status: 405 })
}

function validatePositions(
  body: unknown,
  template: WorkflowTemplate,
): { value: PositionMap } | { error: string } {
  if (typeof body !== 'object' || body === null) return { error: 'body must be an object' }
  const raw = (body as Record<string, unknown>)['positions']
  if (typeof raw !== 'object' || raw === null) return { error: 'positions must be an object' }
  const knownIds = new Set(template.nodes.map((n) => n.id))
  const out: PositionMap = {}
  for (const [id, pos] of Object.entries(raw)) {
    if (!knownIds.has(id)) return { error: `unknown node id: ${id}` }
    if (typeof pos !== 'object' || pos === null) return { error: `positions.${id} must be object` }
    const p = pos as Record<string, unknown>
    if (typeof p['x'] !== 'number' || typeof p['y'] !== 'number') {
      return { error: `positions.${id} requires numeric x, y` }
    }
    if (!Number.isFinite(p['x']) || !Number.isFinite(p['y'])) {
      return { error: `positions.${id} must have finite x, y` }
    }
    out[id] = { x: p['x'], y: p['y'] }
  }
  return { value: out }
}
```

注: 既存 handler は同期関数で `Response | Promise<Response>` を返していたが、PATCH では `await req.json()` するため async 化する。呼び出し側 `routes.ts` は `Response | Promise<Response>` を受け取れるので問題なし。

- [ ] **Step 6-4: テスト pass を確認**

```bash
bun test packages/server/test/handlers/templates.test.ts
```

Expected: 9 個すべて pass。

- [ ] **Step 6-5: 全体 typecheck + テスト**

```bash
bun run typecheck
bun test
```

Expected: 全パッケージ green。

- [ ] **Step 6-6: コミット**

```bash
git add packages/server/src/http/handlers/templates.ts packages/server/test/handlers/templates.test.ts
git commit -m "feat(server): add PATCH /api/templates/:id/positions"
```

---

## Task 7: web layout helper の拡張

**Files:**

- Modify: `packages/web/src/components/template-canvas/layout.ts`
- Modify: `packages/web/test/components/template-canvas/layout.test.ts`

- [ ] **Step 7-1: 失敗するテストを追加**

`packages/web/test/components/template-canvas/layout.test.ts` の末尾に追加:

```ts
import { applyPositionChanges } from '../../../src/components/template-canvas/layout'
import type { NodeChange } from '@xyflow/react'

describe('layoutTemplate with explicit positions', () => {
  test('explicit position wins over topological sort', () => {
    const t: WorkflowTemplate = {
      id: 'e',
      name: 'E',
      nodes: [
        { type: 'trigger', id: 'trig', kind: 'manual', position: { x: 500, y: 600 } },
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
    const map = layoutTemplate(t)
    expect(map['trig']).toEqual({ x: 500, y: 600 })
    // director still gets an auto-computed slot (whatever the topo sort yields)
    expect(map['dir']).toBeDefined()
  })

  test('partial: explicit on some nodes, auto on others', () => {
    const t: WorkflowTemplate = {
      id: 'p',
      name: 'P',
      nodes: [
        { type: 'trigger', id: 'a', kind: 'manual' },
        { type: 'trigger', id: 'b', kind: 'manual', position: { x: 999, y: 111 } },
      ],
      edges: [],
    }
    const map = layoutTemplate(t)
    expect(map['b']).toEqual({ x: 999, y: 111 })
    expect(map['a']).toBeDefined()
    expect(map['a']!.x).not.toBe(999)
  })
})

describe('applyPositionChanges', () => {
  const base = { a: { x: 0, y: 0 }, b: { x: 100, y: 100 } }

  test('records position change relative to base when no override exists yet', () => {
    const changes: NodeChange[] = [
      { id: 'a', type: 'position', position: { x: 50, y: 60 }, dragging: false },
    ]
    const next = applyPositionChanges({}, changes, base)
    expect(next).toEqual({ a: { x: 50, y: 60 } })
  })

  test('ignores non-position changes', () => {
    const changes: NodeChange[] = [
      { id: 'a', type: 'select', selected: true },
      { id: 'b', type: 'dimensions', dimensions: { width: 10, height: 20 } },
    ]
    const next = applyPositionChanges({ a: { x: 9, y: 9 } }, changes, base)
    expect(next).toEqual({ a: { x: 9, y: 9 } })
  })

  test('ignores position changes where position is undefined (dragstart)', () => {
    const changes: NodeChange[] = [
      { id: 'a', type: 'position', dragging: true },
    ]
    const next = applyPositionChanges({}, changes, base)
    expect(next).toEqual({})
  })
})
```

- [ ] **Step 7-2: テスト fail を確認**

```bash
bun test packages/web/test/components/template-canvas/layout.test.ts
```

Expected: 既存テスト 3 つ pass、新規 5 つは `layoutTemplate` が position を無視している / `applyPositionChanges` が未定義で fail。

- [ ] **Step 7-3: `layout.ts` を再構成**

`packages/web/src/components/template-canvas/layout.ts` を編集:

```ts
import type { WorkflowTemplate, TemplateNode, TemplateEdge, NodePosition } from '@legion/core'
import type { NodeChange } from '@xyflow/react'

const COL_W = 200
const ROW_H = 120

export function layoutTemplate(
  t: WorkflowTemplate,
): Record<string, NodePosition> {
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
  const cols: Record<string, number> = {}
  const incoming = new Map<string, string[]>()
  for (const n of nodes) incoming.set(n.id, [])
  const targetIds = new Set(nodes.map((n) => n.id))
  for (const e of allEdges) {
    if (!targetIds.has(e.to)) continue
    if (!incoming.has(e.to)) incoming.set(e.to, [])
    incoming.get(e.to)!.push(e.from)
  }
  for (let pass = 0; pass < nodes.length + 1; pass++) {
    for (const n of nodes) {
      const parents = incoming.get(n.id) ?? []
      if (parents.length === 0) {
        cols[n.id] = 0
        continue
      }
      const parentCol = Math.max(...parents.map((p) => cols[p] ?? 0))
      cols[n.id] = parentCol + 1
    }
  }
  const byCol = new Map<number, string[]>()
  for (const n of nodes) {
    const c = cols[n.id]!
    if (!byCol.has(c)) byCol.set(c, [])
    byCol.get(c)!.push(n.id)
  }
  const result: Record<string, NodePosition> = {}
  for (const [c, ids] of byCol) {
    ids.forEach((id, i) => {
      result[id] = { x: c * COL_W, y: i * ROW_H }
    })
  }
  return result
}

/**
 * Reduce React Flow NodeChange[] into an updated overrides map.
 * Only position changes with a defined position are kept; dimensions /
 * select / drag-start (no position) are ignored.
 */
export function applyPositionChanges(
  prev: Record<string, NodePosition>,
  changes: NodeChange[],
  _base: Record<string, NodePosition>,
): Record<string, NodePosition> {
  let next = prev
  let copied = false
  for (const c of changes) {
    if (c.type !== 'position') continue
    if (!c.position) continue
    if (!copied) {
      next = { ...prev }
      copied = true
    }
    next[c.id] = { x: c.position.x, y: c.position.y }
  }
  return next
}
```

注: `applyPositionChanges` の `base` 引数は spec で残してあったが、実際は使わない (override は React Flow から来る absolute position をそのまま保存すればよく、相対計算は不要)。引数は将来の拡張のために残す。`_` prefix で lint も鎮める。

- [ ] **Step 7-4: テスト pass を確認**

```bash
bun test packages/web/test/components/template-canvas/layout.test.ts
```

Expected: 既存 3 + 新規 5 = 8 個すべて pass。

- [ ] **Step 7-5: コミット**

```bash
git add packages/web/src/components/template-canvas/layout.ts packages/web/test/components/template-canvas/layout.test.ts
git commit -m "feat(web): support explicit node positions in layoutTemplate"
```

---

## Task 8: web TemplateCanvas に drag 機能を組み込む

**Files:**

- Modify: `packages/web/src/components/TemplateCanvas.tsx`
- Create: `packages/web/test/components/TemplateCanvas.test.tsx`

- [ ] **Step 8-1: 失敗するテストを書く**

`packages/web/test/components/TemplateCanvas.test.tsx` を新規作成:

```tsx
import type { ReactNode } from 'react'
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { render, cleanup, act } from '@testing-library/react'
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
  // ResizeObserver shim for happy-dom
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

  test('onPositionsChange is called with empty map initially', () => {
    let captured: Record<string, NodePosition> | null = null
    renderWithProviders(
      <TemplateCanvas
        template={TEMPLATE}
        onDirtyChange={() => {}}
        onPositionsChange={(p) => { captured = p }}
        saveSignal={0}
      />,
    )
    expect(captured).toEqual({})
  })

  test('saveSignal change clears the dirty flag and overrides', () => {
    // We cannot easily simulate a drag through happy-dom (no PointerEvent).
    // Instead, drive overrides through ReactFlow's onNodesChange directly via
    // a rerender: bump saveSignal and verify onDirtyChange(false) is emitted.
    let dirtyCalls: boolean[] = []
    const { rerender } = renderWithProviders(
      <TemplateCanvas
        template={TEMPLATE}
        onDirtyChange={(d) => dirtyCalls.push(d)}
        onPositionsChange={() => {}}
        saveSignal={0}
      />,
    )
    // After initial mount: at least one onDirtyChange(false)
    expect(dirtyCalls).toContain(false)

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
    // After saveSignal bump: dirty should be false (overrides cleared)
    expect(dirtyCalls[dirtyCalls.length - 1]).toBe(false)
  })
})
```

注: happy-dom は PointerEvent / drag を完全に模擬しないので、drag そのものの DOM 経由テストは諦め、props の wiring (signal → reset、dirty 通知) を検証する形にする。実際の drag 経由の挙動は Task 11 の integration test と手動 E2E (Task 13) でカバー。

- [ ] **Step 8-2: テスト fail を確認**

```bash
bun test packages/web/test/components/TemplateCanvas.test.tsx
```

Expected: import / type エラーで fail (現行 TemplateCanvas の props と合わない)。

- [ ] **Step 8-3: TemplateCanvas を書き換える**

`packages/web/src/components/TemplateCanvas.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '../styles/react-flow.css'
import type { WorkflowTemplate, NodePosition } from '@legion/core'
import { nodeStyleFor, edgeStyleFor } from './template-canvas/styling'
import {
  layoutTemplate,
  applyPositionChanges,
} from './template-canvas/layout'
import { useTheme } from '../theme/ThemeProvider'

export interface TemplateCanvasProps {
  template: WorkflowTemplate
  onDirtyChange: (dirty: boolean) => void
  onPositionsChange: (overrides: Record<string, NodePosition>) => void
  /** Parent increments this to ask the canvas to drop in-flight overrides. */
  saveSignal: number
}

export default function TemplateCanvas({
  template,
  onDirtyChange,
  onPositionsChange,
  saveSignal,
}: TemplateCanvasProps) {
  const baseLayout = useMemo(() => layoutTemplate(template), [template])
  const [overrides, setOverrides] = useState<Record<string, NodePosition>>({})
  const { resolved } = useTheme()

  useEffect(() => { setOverrides({}) }, [template.id])
  useEffect(() => { setOverrides({}) }, [saveSignal])
  useEffect(() => { onDirtyChange(Object.keys(overrides).length > 0) }, [overrides, onDirtyChange])
  useEffect(() => { onPositionsChange(overrides) }, [overrides, onPositionsChange])

  const [dotColor, setDotColor] = useState('')
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement)
    setDotColor(cs.getPropertyValue('--canvas-grid').trim())
  }, [resolved])

  const nodes = useMemo<Node[]>(
    () =>
      template.nodes.map((n) => {
        const style = nodeStyleFor(n)
        const pos = overrides[n.id] ?? baseLayout[n.id] ?? { x: 0, y: 0 }
        return {
          id: n.id,
          position: pos,
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
      }),
    [template, baseLayout, overrides],
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

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setOverrides((prev) => applyPositionChanges(prev, changes, baseLayout))
    },
    [baseLayout],
  )

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
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

- [ ] **Step 8-4: TemplateDetail 側からの呼び出しが既存 props と合わなくなるので暫定 stub で typecheck を通す**

`packages/web/src/pages/TemplateDetail.tsx` の `<TemplateCanvas template={template} />` を一時的に以下に差し替える (Task 9 で本実装する):

```tsx
<TemplateCanvas
  template={template}
  onDirtyChange={() => {}}
  onPositionsChange={() => {}}
  saveSignal={0}
/>
```

- [ ] **Step 8-5: テスト pass を確認**

```bash
bun test packages/web/test/components/TemplateCanvas.test.tsx
bun run --filter=@legion/web typecheck
```

Expected: テスト 3 個 pass、typecheck 0 errors。

- [ ] **Step 8-6: コミット**

```bash
git add packages/web/src/components/TemplateCanvas.tsx packages/web/test/components/TemplateCanvas.test.tsx packages/web/src/pages/TemplateDetail.tsx
git commit -m "feat(web): enable drag on TemplateCanvas with override state"
```

---

## Task 9: TemplateDetail に Save / Reset / badge / beforeunload

**Files:**

- Modify: `packages/web/src/api/client.ts`
- Modify: `packages/web/src/pages/TemplateDetail.tsx`

このタスクは UI 結線が中心で、unit test は次タスクの integration test でカバーする (DOM での button click → fetch → DOM 更新は本物サーバで検証する方が信頼性が高い)。

- [ ] **Step 9-1: API client に `patchTemplatePositions` を追加**

`packages/web/src/api/client.ts` の末尾に追加:

```ts
export async function patchTemplatePositions(
  id: string,
  positions: Record<string, { x: number; y: number }>,
): Promise<WorkflowTemplate> {
  const res = await fetch(`${BASE}/templates/${encodeURIComponent(id)}/positions`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ positions }),
  })
  if (!res.ok) {
    throw new Error(`PATCH ${BASE}/templates/${id}/positions: ${res.status} ${await res.text()}`)
  }
  return res.json() as Promise<WorkflowTemplate>
}
```

- [ ] **Step 9-2: TemplateDetail を書き換える**

`packages/web/src/pages/TemplateDetail.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getTemplate, patchTemplatePositions } from '../api/client'
import type { WorkflowTemplate, NodePosition } from '@legion/core'
import TemplateCanvas from '../components/TemplateCanvas'

export default function TemplateDetail() {
  const { id } = useParams<{ id: string }>()
  const [template, setTemplate] = useState<WorkflowTemplate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saveSignal, setSaveSignal] = useState(0)
  const [pending, setPending] = useState(false)
  const positionsRef = useRef<Record<string, NodePosition>>({})

  useEffect(() => {
    if (!id) return
    getTemplate(id)
      .then(setTemplate)
      .catch((e) => setError((e as Error).message))
  }, [id])

  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  useEffect(() => {
    if (!template) return
    document.title = `${dirty ? '● ' : ''}${template.name} — legion`
    return () => { document.title = 'legion' }
  }, [dirty, template])

  const onSave = async () => {
    if (!template || pending) return
    setPending(true)
    try {
      const updated = await patchTemplatePositions(template.id, positionsRef.current)
      setTemplate(updated)
      setSaveSignal((n) => n + 1)
      setDirty(false)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
    setPending(false)
  }

  const onReset = () => { setSaveSignal((n) => n + 1); setDirty(false) }

  if (error) return <div style={{ padding: 16, color: 'var(--status-error)' }}>Error: {error}</div>
  if (!template) return <div style={{ padding: 16 }}>Loading…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          padding: 12,
          borderBottom: '1px solid var(--border-default)',
          background: 'var(--bg-surface)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Link to="/templates">← Templates</Link>
        <strong>{template.name}</strong>
        <span style={{ color: 'var(--fg-muted)' }}>({template.id})</span>
        {dirty && (
          <span
            data-testid="unsaved-badge"
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 4,
              background: 'var(--status-warning, #f59e0b)',
              color: '#fff',
            }}
          >
            Unsaved changes
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button
          data-testid="reset-btn"
          disabled={!dirty || pending}
          onClick={onReset}
        >
          Reset
        </button>
        <button
          data-testid="save-btn"
          disabled={!dirty || pending}
          onClick={onSave}
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <TemplateCanvas
          template={template}
          onDirtyChange={setDirty}
          onPositionsChange={(p) => { positionsRef.current = p }}
          saveSignal={saveSignal}
        />
      </div>
    </div>
  )
}
```

注: 既存ヘッダの `(read-only mockup — Phase 1 では編集不可)` テキストは削除する (drag できるようになったため)。

- [ ] **Step 9-3: typecheck**

```bash
bun run --filter=@legion/web typecheck
```

Expected: 0 errors。

- [ ] **Step 9-4: コミット**

```bash
git add packages/web/src/api/client.ts packages/web/src/pages/TemplateDetail.tsx
git commit -m "feat(web): wire Save/Reset/badge/beforeunload in TemplateDetail"
```

---

## Task 10: web CanvasOverlay にも drag を入れる (in-session のみ)

**Files:**

- Modify: `packages/web/src/components/CanvasOverlay.tsx`
- Modify: `packages/web/test/components/canvas-overlay.test.tsx` (既存 assertion が壊れていないことを確認するだけ)

- [ ] **Step 10-1: CanvasOverlay を書き換える**

`packages/web/src/components/CanvasOverlay.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '../styles/react-flow.css'
import type { WorkflowTemplate, TemplateNode, NodePosition } from '@legion/core'
import type { AgentInstanceView } from '../types'
import { useTheme } from '../theme/ThemeProvider'
import {
  layoutTemplate,
  applyPositionChanges,
} from './template-canvas/layout'

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

export default function CanvasOverlay({
  template,
  agentInstances,
  onSelectNode,
}: CanvasOverlayProps) {
  const roleStatus = useMemo(() => deriveRoleStatus(agentInstances), [agentInstances])
  const baseLayout = useMemo(() => layoutTemplate(template), [template])
  const [overrides, setOverrides] = useState<Record<string, NodePosition>>({})
  const { resolved } = useTheme()

  // Instance changes (different template snapshot) reset in-session overrides
  useEffect(() => { setOverrides({}) }, [template.id])

  const [dotColor, setDotColor] = useState('')
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement)
    setDotColor(cs.getPropertyValue('--canvas-grid').trim())
  }, [resolved])

  const nodes = useMemo<Node[]>(
    () =>
      template.nodes.map((n) => {
        const status = n.type === 'role' ? roleStatus.get(n.id) : undefined
        return {
          id: n.id,
          type: 'statusNode',
          position: overrides[n.id] ?? baseLayout[n.id] ?? { x: 0, y: 0 },
          data: {
            label: `${n.id}\n(${n.type})`,
            status: status ?? null,
            borderColor: NODE_BORDER[n.type] ?? '#888',
          },
        }
      }),
    [template, baseLayout, overrides, roleStatus],
  )

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

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setOverrides((prev) => applyPositionChanges(prev, changes, baseLayout))
    },
    [baseLayout],
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

- [ ] **Step 10-2: 既存 canvas-overlay テストが pass することを確認**

```bash
bun test packages/web/test/components/canvas-overlay.test.tsx
```

Expected: 既存 3 つすべて pass。data-id ベースの assertion なので layout の変化に影響されない。

- [ ] **Step 10-3: web 全テスト**

```bash
bun test packages/web/
bun run --filter=@legion/web typecheck
```

Expected: 全 green。

- [ ] **Step 10-4: コミット**

```bash
git add packages/web/src/components/CanvasOverlay.tsx
git commit -m "feat(web): enable in-session drag on CanvasOverlay"
```

---

## Task 11: Web integration test (Template save round-trip)

**Files:**

- Create: `packages/web/test/integration/template-save.integration.test.tsx`

このテストは本物の `startApp` を別プロセスで立ち上げ (既存 `_server-fixture.ts` パターン)、`patchTemplatePositions` を呼んで GET で確認するだけのスリムな統合テストにする。drag そのものを happy-dom で模擬するのは不安定なので、UI 層を介さず API 層を回す。

- [ ] **Step 11-1: テストを書く**

`packages/web/test/integration/template-save.integration.test.tsx` を新規作成:

```tsx
// Integration test for Template position save round-trip.
// Boots a real @legion/server in-process (no UI / no happy-dom), calls the
// client.ts function against it, then verifies GET reflects the change.
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { join, resolve } from 'node:path'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { startApp, type AppHandle } from '@legion/server/app'
import { TemplateRegistry } from '@legion/runtime/template/registry'
import { initEventLogSchema } from '@legion/runtime/eventlog/schema'
import { initInstanceSchema } from '@legion/runtime/orchestrator/instance-store'
import type { AgentProvider } from '@legion/core'
import { patchTemplatePositions, getTemplate } from '../../src/api/client'

const REPO_ROOT = resolve(import.meta.dir, '../../../..')
const YAML_PATH = join(REPO_ROOT, 'workflows', 'feature-with-review.yaml')

let app: AppHandle
let baseDir: string
let originalYaml: string

function noopProvider(): AgentProvider {
  return {
    id: 'claude-code',
    displayName: 'mock',
    capabilities: {
      supportsCheckpoint: false,
      supportsResume: false,
      supportsAttach: false,
      supportsApprovalFlow: false,
    },
    detect: async () => ({ installed: true }),
    authenticate: async () => ({ authenticated: true }),
    launch: async () => ({ sessionId: 's' }),
    stream: async function* () {},
    send: async () => {},
    interrupt: async () => {},
    approve: async () => {},
    deny: async () => {},
    status: async () => ({}),
    checkpoint: async () => ({ id: '', createdAt: new Date(), metadata: {} }),
    resume: async () => ({ sessionId: '' }),
    shutdown: async () => {},
    exportTranscript: async () => ({ sessionId: '', events: [] }),
  }
}

beforeAll(async () => {
  const db = new Database(':memory:')
  initEventLogSchema(db)
  initInstanceSchema(db)
  baseDir = await mkdtemp(join(tmpdir(), 'legion-int-'))
  const templates = new TemplateRegistry(join(REPO_ROOT, 'workflows'))
  await templates.refresh()
  app = await startApp({
    port: 0,
    db,
    templates,
    repoPath: REPO_ROOT,
    worktreeBaseDir: baseDir,
    adapterFactory: noopProvider,
  })
  // Direct fetch in this test environment goes to /api on origin; happy-dom
  // does not set up a default origin, so the client.ts BASE='/api' would fail.
  // Patch fetch to prepend our server URL.
  const origFetch = globalThis.fetch
  ;(globalThis as any).__origFetch = origFetch
  ;(globalThis as any).fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api')) {
      return origFetch(`http://localhost:${app.port}${input}`, init)
    }
    return origFetch(input as any, init)
  }
})

afterAll(async () => {
  ;(globalThis as any).fetch = (globalThis as any).__origFetch
  await app.stop()
  await rm(baseDir, { recursive: true, force: true })
})

beforeEach(async () => {
  originalYaml = await readFile(YAML_PATH, 'utf-8')
})
afterEach(async () => {
  await writeFile(YAML_PATH, originalYaml)
})

describe('template save round-trip via client.ts', () => {
  test('PATCH then GET returns the persisted position', async () => {
    const updated = await patchTemplatePositions('feature-with-review', {
      director: { x: 42, y: 84 },
    })
    const dir = updated.nodes.find((n) => n.id === 'director')!
    expect(dir.position).toEqual({ x: 42, y: 84 })

    const refetched = await getTemplate('feature-with-review')
    const dir2 = refetched.nodes.find((n) => n.id === 'director')!
    expect(dir2.position).toEqual({ x: 42, y: 84 })
  })

  test('YAML on disk still contains the description comment after save', async () => {
    await patchTemplatePositions('feature-with-review', {
      reviewer: { x: 9, y: 9 },
    })
    const after = await readFile(YAML_PATH, 'utf-8')
    expect(after).toContain('Director delegates to Implementer')
    expect(after).toContain('position: { x: 9, y: 9 }')
  })

  test('400 on unknown node id', async () => {
    await expect(
      patchTemplatePositions('feature-with-review', { ghost: { x: 0, y: 0 } }),
    ).rejects.toThrow(/400/)
  })
})
```

- [ ] **Step 11-2: テスト実行**

```bash
bun test packages/web/test/integration/template-save.integration.test.tsx
```

Expected: 3 つすべて pass。

- [ ] **Step 11-3: コミット**

```bash
git add packages/web/test/integration/template-save.integration.test.tsx
git commit -m "test(web): integration test for template position save"
```

---

## Task 12: 手動 E2E runbook を追記

**Files:**

- Modify: `docs/dev/manuals/user_test_manual.md`

- [ ] **Step 12-1: runbook 章を追加**

`docs/dev/manuals/user_test_manual.md` の既存末尾に追加 (見出しは既存ファイルの章番号に合わせる):

```markdown
## フロー canvas のノードドラッグ (2026-05-15 追加)

### 1. Template canvas で drag → Save が永続化されることを確認

1. `LEGION_SCRATCH_REPO` を `legion-playground` に設定して server を起動する
   (詳細は既存節 §<前章番号> を参照)
2. ブラウザで `/templates/feature-with-review` を開く
3. ノードをドラッグして適当に動かす
4. ヘッダに `Unsaved changes` badge が表示されること、タブタイトル先頭に `●` マークが付くことを確認
5. `Save` ボタンを押す
6. badge / タブマークが消える
7. ページをリロード — 直前にドラッグした位置のままレンダリングされること
8. `workflows/feature-with-review.yaml` を VSCode で開き、`director` などのノードに
   `position: { x: ..., y: ... }` が flow style で追記されていること、`description: |`
   ブロックと既存コメントが保たれていることを確認

### 2. Reset と離脱警告の挙動を確認

1. ノードをドラッグ
2. `Reset` を押す → 位置が元に戻る、badge も消える
3. もう一度ドラッグして badge を出した状態にする
4. ブラウザのアドレスバーで他 URL に移動を試みる → ブラウザ標準の確認ダイアログが出る
5. キャンセル — そのページに留まる

### 3. Instance canvas は in-session のみ

1. workflow を trigger して instance を作る
2. `/instances/:id` を開く
3. ノードをドラッグして動かす
4. ページをリロード → 位置が初期状態に戻ること (in-session の動作確認)
5. ヘッダに Save ボタンが無いこと
```

- [ ] **Step 12-2: コミット**

```bash
git add docs/dev/manuals/user_test_manual.md
git commit -m "docs(manuals): add flow drag test runbook"
```

---

## Task 13: 統合確認 (全テスト / typecheck / 手動 E2E)

- [ ] **Step 13-1: 全 typecheck / test を流す**

```bash
bun run typecheck
bun run test
```

Expected: 全パッケージで 0 errors、テストすべて green。

- [ ] **Step 13-2: contract test 単独実行 (ゲート)**

```bash
bun test packages/runtime/test/template/writer.contract.test.ts
```

Expected: 2 つすべて pass。`.claude/CLAUDE.md` の mocks-require-contract policy のゲートを通したことを確認する。

- [ ] **Step 13-3: 手動 E2E**

Task 12 で追記した runbook の §1 / §2 / §3 をブラウザで通す。
完了時の差分や気付きを `docs/dev/handoff/` 配下の最新ファイルに追記する (legion の慣例)。

- [ ] **Step 13-4: 最終確認のための git log を見る**

```bash
git log --oneline worktree-design-1 ^main
```

Expected: 11–13 件程度の commit が並ぶ。コミットメッセージが英語、subject line < 70 chars、Co-Authored-By trailer が無いことを確認する (legion CLAUDE.md 準拠)。

---

## Done condition

- すべての check box が ✅
- `bun run typecheck` 0 errors
- `bun run test` 全 green
- `writer.contract.test.ts` 単独でも pass
- 手動 E2E §1 / §2 / §3 すべて期待通り
- `workflows/feature-with-review.yaml` に flow-style `position` が混入し、description / コメント / ノード順が保たれている
