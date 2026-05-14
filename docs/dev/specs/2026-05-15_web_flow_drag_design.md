# Web Flow Drag 設計仕様書

**作成日:** 2026-05-15
**ステータス:** 実装着手用ドラフト
**対象パッケージ:** `packages/core` / `packages/runtime` / `packages/server` / `packages/web`
**前提となる過去決定:** D-008 (React + React Flow), D-012 (Layer 1/2), D-018 (Template vs Instance), D-019 (YAML マスター + DB cache)

本書は legion web UI のフロー canvas にノードドラッグ機能を導入するためのサブ実装の設計を、実装着手者がそのまま読める形に凝縮したものです。コードを書く前に読んでください。

## 1. 目的と完了定義

**成果物:** Template / Instance の両 canvas で固定配置されていたノード位置を、ユーザがドラッグで自由に動かせるようにする。Template 側はその位置を YAML マスターに永続化する。Instance 側は in-session のみ。

完了条件:

- Template 詳細画面でノードをドラッグできる。
- ドラッグ後、ヘッダの `Save` ボタン押下で YAML に position が書き戻される。
- 未保存時はヘッダに "Unsaved changes" badge が出る。`Reset` ボタンで破棄できる。
- 既存 YAML (position なしテンプレート) は現行の `layoutTemplate()` (topological sort) を fallback として表示される。
- Instance 詳細画面 (`CanvasOverlay`) でもノードをドラッグできるが、リロードで初期位置に戻る。
- YAML 書き出しは `yaml` package の Document API を通じ、既存コメント・並び順・インデントを保つ。
- 新規 contract test (`writer.contract.test.ts`) を含む全テストがパスする。

完了の範囲外 (§10): ノード / エッジの新規作成・削除・プロパティ編集、エッジ waypoint 編集、ノードリサイズ、Undo/Redo、Instance ドラッグの永続化 (将来仕事として `docs/DREAM.md` に登録済み)、マルチユーザ同時編集ロック、新規 Template 作成・既存 Template 削除。

## 2. スコープと前提

### 2.1 スコープ

- 新規ファイル: `packages/runtime/src/template/writer.ts`、`packages/runtime/test/template/writer.test.ts`、`packages/runtime/test/template/writer.contract.test.ts`、`packages/server/test/http/handlers/templates.test.ts`、`packages/web/test/components/TemplateCanvas.test.tsx`、`packages/web/test/integration/template-save.integration.test.tsx`
- 変更ファイル: `packages/core/src/types/template.ts`、`packages/runtime/src/template/loader.ts`、`packages/runtime/src/template/registry.ts`、`packages/server/src/http/handlers/templates.ts`、`packages/web/src/api/client.ts`、`packages/web/src/components/TemplateCanvas.tsx`、`packages/web/src/components/CanvasOverlay.tsx`、`packages/web/src/components/template-canvas/layout.ts`、`packages/web/src/pages/TemplateDetail.tsx`、関連テスト

### 2.2 前提決定 (本書で確定)

| 番号 | 決定 | 採用案 |
|---|---|---|
| FD-01 | スコープ | ノード位置の drag のみ。create/delete/property-edit は別 spec。エッジは追従のみで waypoint 編集なし。 |
| FD-02 | 編集対象レイヤ | Template (永続化あり) と Instance (in-session のみ) の両方。 |
| FD-03 | Template 永続化先 | YAML マスター (`workflows/*.yaml`)。D-019 遵拠。 |
| FD-04 | YAML 書き戻し方式 | `yaml` package の Document API でコメント・フォーマット保持。 |
| FD-05 | Save 起動方式 | 明示的 Save ボタン + "Unsaved changes" badge。auto-save しない。 |
| FD-06 | Save 後の reload | サーバ側で `TemplateRegistry.refreshOne(id)` を呼んでメモリキャッシュ更新。 |
| FD-07 | YAML に position が無いノード | 現行 `layoutTemplate()` の topological sort を fallback。 |
| FD-08 | API surface | `PATCH /api/templates/:id/positions`。テンプレ全体 PUT は採用しない。 |
| FD-09 | Instance 永続化 | しない。将来 SQLite に session log として残す方針は `docs/DREAM.md` に記録。 |

## 3. アーキテクチャ概要

```
┌─ packages/core ────────────────────────────────────────────┐
│  TemplateNode に position?: { x, y } を optional 追加      │
└────────────────────────────────────────────────────────────┘
            │
            ↓
┌─ packages/runtime ─────────────────────────────────────────┐
│  template/loader.ts:    position? を parse / 数値検証      │
│  template/writer.ts:    Document API で 1 ノード分の       │
│                         position を upsert (新規)         │
│  template/registry.ts:  sourcePathOf(id) / refreshOne(id) │
└────────────────────────────────────────────────────────────┘
            │
            ↓
┌─ packages/server ──────────────────────────────────────────┐
│  http/handlers/templates.ts:                              │
│    PATCH /api/templates/:id/positions                     │
│      → validate → writer → registry.refreshOne → 200      │
└────────────────────────────────────────────────────────────┘
            │
            ↓
┌─ packages/web ─────────────────────────────────────────────┐
│  TemplateDetail (親, page)                                 │
│    ├─ Save / Reset / Unsaved badge                        │
│    └─ TemplateCanvas (子)                                  │
│         react-flow nodesDraggable=true                    │
│         onNodesChange → overrides state                   │
│         (overrides は子で抱える、saveSignal でリセット)    │
│                                                            │
│  InstanceDetail (親, page)                                 │
│    └─ CanvasOverlay (子)                                   │
│         react-flow nodesDraggable=true                    │
│         overrides は in-session のみ (Save なし)          │
└────────────────────────────────────────────────────────────┘
```

### 3.1 親子コンポーネント責務分担 (Template 側)

| 方向 | 何を伝える | 仕組み |
|---|---|---|
| 子 → 親 | dirty かどうか | `onDirtyChange: (boolean) => void` callback prop |
| 子 → 親 | 最新の overrides (Save 時に PATCH に積む) | `onPositionsChange` callback → 親が `useRef` に保持 |
| 親 → 子 | Save 完了 / Reset 押下 → overrides 捨てて | `saveSignal: number` prop (incrementing) |

Redux 等のグローバル state は導入しない (D-008 準拠)。

## 4. データモデル変更

### 4.1 `packages/core/src/types/template.ts`

```ts
export interface NodePosition {
  x: number
  y: number
}

export interface RoleNode {
  type: 'role'
  id: string
  role: string
  provider: string
  lifetime: RoleLifetime
  position?: NodePosition   // 追加
}

// TriggerNode / BlackboardNode / HumanGateNode / SinkNode にも同じ position?: NodePosition を追加
```

設計判断:

- **on-node に置く理由:** 別 `layout: { [id]: pos }` block にすると、ノード追加/削除と layout 整合の二重管理になる。YAML 上も「そのノードの属性」として読める。
- **optional な理由:** 既存 YAML には position フィールドが無い。後方互換。ユーザが drag していない node は YAML 上も position 無しのままにする (writer の冪等性確保)。

### 4.2 YAML 表現

```yaml
nodes:
  - id: director
    type: role
    role: director
    provider: claude-code
    lifetime: per-workflow
    position: { x: 240, y: 120 }   # flow style で 1 行
```

flow style 採用理由: 機械生成された値であることが視覚的に区別できる + 行数を圧迫しない。

## 5. Loader / Registry 変更

### 5.1 `packages/runtime/src/template/loader.ts`

`parseNode` を拡張し、`position` フィールドが存在すれば検証して取り込む。

```ts
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

### 5.2 `packages/runtime/src/template/registry.ts`

書き戻し先のファイルパスを registry に持たせる。

```ts
interface Entry {
  template: WorkflowTemplate
  sourcePath: string
}

export class TemplateRegistry {
  private entries = new Map<string, Entry>()

  // 既存 API (Entry を経由した実装に差し替え)
  list(): WorkflowTemplate[]
  get(id: string): WorkflowTemplate | undefined
  refresh(): Promise<void>        // 全 readdir、起動時用途。既存。

  // 新規 API
  sourcePathOf(id: string): string | undefined
  refreshOne(id: string): Promise<void>   // Save 後の単発 reload。対象 1 ファイルのみ。
}
```

設計判断: `refresh()` 全走査ではなく `refreshOne()` を追加した理由 — templates が増えると毎 Save で readdir 走査するのは無駄。`refresh()` は起動時用途として残す。

## 6. YAML round-trip writer (新規)

### 6.1 `packages/runtime/src/template/writer.ts`

`yaml` package の Document API でコメント / フォーマット / ノード並び順を保ったまま position だけを更新する。推定 80 行。

```ts
import { readFile, writeFile } from 'node:fs/promises'
import { parseDocument, isMap, isSeq, type Document } from 'yaml'
import type { NodePosition } from '@legion/core'

export type PositionMap = Record<string, NodePosition>

export async function writeTemplatePositions(
  sourcePath: string,
  positions: PositionMap,
): Promise<void> {
  const text = await readFile(sourcePath, 'utf-8')
  const doc = parseDocument(text)
  applyPositions(doc, positions)
  await writeFile(sourcePath, doc.toString())
}

export function applyPositions(doc: Document, positions: PositionMap): void {
  const nodes = doc.get('nodes')
  if (!isSeq(nodes)) throw new Error('template has no nodes sequence')

  // 検証: positions の全 nodeId が YAML 内に実在することを先に確認 (部分書き込みを避ける)
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

  // 適用
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

設計判断:

- **読み直してから書く:** registry のメモリキャッシュではなく `readFile(sourcePath)` で最新 YAML を取る。外部エディタによる手動編集とも共存できる。
- **flow style 強制:** `createNode(pos, { flow: true })` で `position: { x: 240, y: 120 }` の 1 行スタイルに固定。
- **全 nodeId 事前検証:** PATCH の payload に 1 件でも未知 ID があれば書き込まず例外。部分書き込みを避ける。
- **原子性は受容:** `writeFile` はトランケート→書き込み。途中で落ちると空ファイル化のリスクあり。今回は単一テナント・ローカルファイルなので tmpfile + rename はやらず受容する。書き込み失敗時はサーバが 500、クライアントの local state は dirty のまま残るので再保存できる。

## 7. Server API

### 7.1 `packages/server/src/http/handlers/templates.ts`

既存 GET ハンドラを保ったまま `PATCH /api/templates/:id/positions` を足す。

```
PATCH /api/templates/:id/positions
  body: { positions: { [nodeId]: { x: number, y: number } } }
  200:  updated template (WorkflowTemplate)
  400:  bad body / unknown node id / non-finite numbers
  404:  template id not found
  500:  YAML write or refresh failure
```

```ts
const patchMatch = url.pathname.match(/^\/api\/templates\/([^/]+)\/positions$/)
if (patchMatch && req.method === 'PATCH') {
  const id = patchMatch[1]!
  const sourcePath = ctx.options.templates.sourcePathOf(id)
  if (!sourcePath) return new Response('Not Found', { status: 404 })

  const body = await req.json().catch(() => null)
  const validated = validatePositions(body, ctx.options.templates.get(id)!)
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
```

`validatePositions` (handlers ファイル内、~20 行):

```ts
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

設計判断:

- **`/positions` を path suffix にした理由:** 将来 `PATCH /api/templates/:id` 自体 (rename / property edit) を足すときに干渉しない。
- **PATCH の意味論:** ボディに含まれた node 分だけ更新。含まれていない node の position は触らない。
- **空 positions:** 一貫性のため write→refresh を実行する (no-op として無害)。

## 8. Web 実装

### 8.1 `packages/web/src/api/client.ts` (追記)

```ts
export async function patchTemplatePositions(
  id: string,
  positions: Record<string, { x: number; y: number }>,
): Promise<WorkflowTemplate> {
  const res = await fetch(`/api/templates/${id}/positions`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ positions }),
  })
  if (!res.ok) {
    throw new Error(`PATCH /api/templates/${id}/positions: ${res.status} ${await res.text()}`)
  }
  return res.json()
}
```

### 8.2 `packages/web/src/components/template-canvas/layout.ts` (拡張)

現行 `layoutTemplate()` を「全 node を topological sort で配置」から、「YAML に position があれば使い、無いものは topological sort」に変更する。

```ts
export function layoutTemplate(t: WorkflowTemplate): Record<string, NodePosition> {
  const explicit: Record<string, NodePosition> = {}
  const needsAuto: TemplateNode[] = []
  for (const n of t.nodes) {
    if (n.position) explicit[n.id] = n.position
    else needsAuto.push(n)
  }
  const auto = autoLayout(needsAuto, t.edges)   // 現行 topo-sort を private 関数化
  return { ...auto, ...explicit }                // explicit 優先
}

// 新規 helper: react-flow の NodeChange を overrides に反映する
export function applyPositionChanges(
  prev: Record<string, NodePosition>,
  changes: NodeChange[],
  baseLayout: Record<string, NodePosition>,
): Record<string, NodePosition>
```

`applyPositionChanges` は TemplateCanvas と CanvasOverlay の両方が使う。`position` 種別の change のみ拾い、`dimensions` / `select` などは無視する。

フォルダ名 `template-canvas/` は Instance 側からも参照される文脈上やや misleading だが、本 spec ではリネームしない (別 spec)。

### 8.3 `packages/web/src/components/TemplateCanvas.tsx` (拡張、現行 81 → +30 行)

```tsx
export interface TemplateCanvasProps {
  template: WorkflowTemplate
  onDirtyChange: (dirty: boolean) => void
  onPositionsChange: (overrides: Record<string, NodePosition>) => void
  saveSignal: number   // 親が +1 で「overrides 捨てて」を伝える
}

export default function TemplateCanvas({
  template,
  onDirtyChange,
  onPositionsChange,
  saveSignal,
}: TemplateCanvasProps) {
  const baseLayout = useMemo(() => layoutTemplate(template), [template])
  const [overrides, setOverrides] = useState<Record<string, NodePosition>>({})

  useEffect(() => { setOverrides({}) }, [template.id])    // template 切替でリセット
  useEffect(() => { setOverrides({}) }, [saveSignal])     // 親からのリセット
  useEffect(() => { onDirtyChange(Object.keys(overrides).length > 0) }, [overrides, onDirtyChange])
  useEffect(() => { onPositionsChange(overrides) }, [overrides, onPositionsChange])

  const nodes = useMemo<Node[]>(() => template.nodes.map((n) => ({
    id: n.id,
    position: overrides[n.id] ?? baseLayout[n.id] ?? { x: 0, y: 0 },
    data: { label: nodeStyleFor(n).label },
    style: { /* 既存 */ },
  })), [template, baseLayout, overrides])

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setOverrides((prev) => applyPositionChanges(prev, changes, baseLayout))
  }, [baseLayout])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      nodesDraggable={true}
      nodesConnectable={false}
      fitView
    >
      {/* 既存 Background / Controls */}
    </ReactFlow>
  )
}
```

### 8.4 `packages/web/src/pages/TemplateDetail.tsx` (拡張、現行 40 → +40 行)

ヘッダに Save / Reset ボタンと dirty badge を追加。`(read-only mockup — Phase 1 では編集不可)` テキストは削除する。

```tsx
const [dirty, setDirty] = useState(false)
const [saveSignal, setSaveSignal] = useState(0)
const [pending, setPending] = useState(false)
const positionsRef = useRef<Record<string, NodePosition>>({})

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

// beforeunload: dirty 時のページ離脱を警告
useEffect(() => {
  if (!dirty) return
  const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
  window.addEventListener('beforeunload', handler)
  return () => window.removeEventListener('beforeunload', handler)
}, [dirty])

// document.title にドットマーク (記事・IDE 風)
useEffect(() => {
  if (!template) return
  document.title = `${dirty ? '● ' : ''}${template.name} — legion`
  return () => { document.title = 'legion' }
}, [dirty, template])
```

設計判断 (§6 セクションで決定済):

- **`saveSignal` 方式:** 親が Save / Reset で発火する。値を +1 して `useEffect [saveSignal]` を再走させる単純パターン。
- **`positionsRef`:** 子からリアルタイムに上がる overrides を ref に貯める。re-render を発生させない。
- **error 表示:** 既存 `error` state を流用。
- **`beforeunload` 警告:** dirty 時のみ install。`e.preventDefault() + e.returnValue = ''` の慣例形でブラウザネイティブの確認ダイアログを出す。
- **タブタイトル `●` マーク:** dirty 時に prefix。React Router の他ページに移動した時は unmount で `'legion'` に戻る。

### 8.5 `packages/web/src/components/CanvasOverlay.tsx` (拡張、現行 149 → +20 行)

Instance side。Save なし、PATCH なし、in-session overrides のみ。

```tsx
const baseLayout = useMemo(() => layoutTemplate(template), [template])
const [overrides, setOverrides] = useState<Record<string, NodePosition>>({})

const nodes = useMemo<Node[]>(() => template.nodes.map((n) => ({
  id: n.id,
  type: 'statusNode',
  position: overrides[n.id] ?? baseLayout[n.id] ?? { x: 0, y: 0 },
  data: { /* 既存 */ },
})), [template, baseLayout, overrides, roleStatus])

const onNodesChange = useCallback((changes: NodeChange[]) => {
  setOverrides((prev) => applyPositionChanges(prev, changes, baseLayout))
}, [baseLayout])
```

設計判断:

- **既存の 4-col grid (`(i % 4) * 180`, `Math.floor(i / 4) * 100`) を捨てる:** Template と Instance で位置計算が違うのは混乱の元。両方とも `layoutTemplate()` を使う。視覚的な変化が出ることを spec の「§9 既存挙動の変更」に明記する。
- **`templateSnapshot` から position が読まれる:** Template Save 後に spawn された Instance だけが保存済み position を持つ。それ以前の Instance の snapshot には position が無いので auto layout fallback。snapshot は immutable なので、走行中の Instance の位置は Template 編集の影響を受けない (D-018 を尊重)。
- **`onSelectNode` 周り:** ドラッグしたノードが `onNodeClick` を発火させない挙動は React Flow デフォルトで担保される。追加対応不要。

## 9. 既存挙動の変更

- Instance canvas (`CanvasOverlay`) の初期レイアウトが「4 列 grid」から「Template と同じ topological sort」に変わる。Template 詳細と同じ見た目になる。
- `TemplateNode` 型に optional `position` が増える。他パッケージから `TemplateNode` を型として使っている箇所への影響は無い (optional 追加)。
- `TemplateRegistry` の内部 Map shape が変わるが、外部公開 API (`list`/`get`) は同じシグネチャ。
- TemplateDetail ヘッダの "(read-only mockup — Phase 1 では編集不可)" テキストが消える。

## 10. 非ゴール / 将来仕事

- ノード / エッジの **新規作成 / 削除 / プロパティ編集** — 別 spec。create を含めると node type picker / role provider lifetime editor / edge type picker / `template-validate.ts` のリアルタイム検証など UI が大規模化する。
- **エッジの waypoint 編集** — react-flow の custom edge + 状態管理の別物。今回はノード追従のみ。
- **Undo / Redo** — overrides 単一スナップショットのみ保持。履歴は別 spec。
- **マルチユーザ同時編集ロック / リアルタイム同期** — D-001 (single-tenant) で当面不要。
- **新規 Template 作成・既存 Template 削除** — Templates list 側の UX 設計が別途必要。
- **Instance ドラッグの永続化** — `docs/DREAM.md` に「Instance セッションログを SQLite に永続化」として記録済み。SQLite テーブル設計と一緒に別 spec で扱う。

## 11. テスト戦略

mocks-require-contract-tests ポリシー (`.claude/CLAUDE.md`) に沿って設計する。

### 11.1 unit / integration test

| ファイル | 対象 | 行数推定 | 備考 |
|---|---|---|---|
| `packages/runtime/test/template/loader.test.ts` (拡張) | optional `position` のパースと検証エラー | +30 | mock なし |
| `packages/runtime/test/template/registry.test.ts` (拡張) | `sourcePathOf` / `refreshOne` | +30 | mock なし |
| `packages/runtime/test/template/writer.test.ts` (新規) | `applyPositions` 純関数: コメント保持 / flow style / 未知 ID 拒否 | 80 | 純関数、mock なし |
| `packages/server/test/http/handlers/templates.test.ts` (新規) | PATCH 200/400/404 ハンドラ。fake registry を注入 | 80 | fake registry を mock として使う (§11.3 参照) |
| `packages/web/test/components/template-canvas/layout.test.ts` (拡張) | `position?` 優先、足りないノードに auto-layout fallback | +40 | mock なし |
| `packages/web/test/components/TemplateCanvas.test.tsx` (新規) | drag で dirty 発火、saveSignal で overrides リセット | 100 | React Flow を本物のまま DOM render |
| `packages/web/test/components/CanvasOverlay.test.tsx` (拡張) | 既存 4-col grid 期待値を `layoutTemplate()` 互換に修正 | +20 | mock なし |
| `packages/web/test/integration/template-save.integration.test.tsx` (新規) | TemplateDetail → drag → Save → API → reload の往復 | 120 | `_server-fixture.ts` で本物サーバ起動 (既存パターン) |

### 11.2 contract test

| ファイル | 対象 | 行数推定 |
|---|---|---|
| `packages/runtime/test/template/writer.contract.test.ts` (新規) | 実 YAML を tmpdir にコピー → writer → loader 往復。description コメント・edge コメント・block ordering 保持、新規 position が flow style で挿入されることを検証 | 80 |

`yaml@2.x` Document API の挙動契約 (CST 保持・flow style・並び順) に依存。`yaml` package を bump する際は再走必須。

### 11.3 mock のヘッダコメント

`packages/server/test/http/handlers/templates.test.ts` で `TemplateRegistry` を fake する箇所:

```ts
// Mock for TemplateRegistry
// representing:    packages/runtime/src/template/registry.ts (sourcePathOf, refreshOne, get, list)
// verified on:     <implementation date>, by registry.test.ts + writer.contract.test.ts
// invalidated when: TemplateRegistry adds required new method consumed by the templates handler,
//                   or any of the four signatures (sync/async, return shape) changes
// contract test:   packages/runtime/test/template/registry.test.ts (sourcePathOf/refreshOne real-fs),
//                   packages/runtime/test/template/writer.contract.test.ts (YAML round-trip)
```

### 11.4 ゲート

`writer.contract.test.ts` は phase 境界 / `yaml` package bump の前に再走させる。

### 11.5 回避するもの

- `fetch` を mock した API client unit test は書かない (`_server-fixture.ts` の本物サーバ統合テストで代替)。
- React Flow を mock しない (DOM をそのまま render、既存 canvas-overlay テストと同方針)。

## 12. ファイル / 行数見積もり

| ファイル | 追加 | 変更 | 合計 (見積) |
|---|---|---|---|
| `packages/core/src/types/template.ts` | +6 | 既存 5 ノード型に position? 追加 | ~75 |
| `packages/runtime/src/template/loader.ts` | +20 | `parsePosition` 追加 + `parseNode` 末尾結合 | ~100 |
| `packages/runtime/src/template/registry.ts` | +15 | Entry 化 + sourcePathOf / refreshOne | ~50 |
| `packages/runtime/src/template/writer.ts` | 新規 80 | — | 80 |
| `packages/server/src/http/handlers/templates.ts` | +60 | PATCH 分岐 + `validatePositions` | ~85 |
| `packages/web/src/api/client.ts` | +15 | `patchTemplatePositions` | — |
| `packages/web/src/components/template-canvas/layout.ts` | +30 | `layoutTemplate` 再構成 + `applyPositionChanges` | ~75 |
| `packages/web/src/components/TemplateCanvas.tsx` | +30 | overrides state, signal 同期 | ~110 |
| `packages/web/src/components/CanvasOverlay.tsx` | +20 | overrides state, `layoutTemplate()` 共有 | ~170 |
| `packages/web/src/pages/TemplateDetail.tsx` | +40 | Save/Reset/badge | ~80 |
| 新規テスト 6 本 | +480 | — | — |
| 既存テスト拡張 3 本 | +90 | — | — |

source 合計 (テスト除く): ~315 行追加。`CanvasOverlay.tsx` (~170 行) と `TemplateCanvas.tsx` (~110 行) は legion の refactoring policy (function 100 / class 500 / file 1000) の閾値以内。

## 13. 実装順序

実装は writing-plans skill で詳細プランに分解する。本書では大まかな依存順のみ示す:

1. **core types** (`template.ts` に `NodePosition` / `position?`) — 他全部の前提
2. **runtime loader** (`position` parse + tests)
3. **runtime writer** (`writer.ts` + writer.test + writer.contract.test) — registry より先
4. **runtime registry** (`Entry` / `sourcePathOf` / `refreshOne` + tests)
5. **server PATCH handler** (+ tests)
6. **web layout helper** (`layoutTemplate` 拡張 + `applyPositionChanges`)
7. **web TemplateCanvas** (drag 有効化 + override state + props 拡張)
8. **web TemplateDetail** (Save / Reset / badge ヘッダ)
9. **web CanvasOverlay** (drag 有効化 + in-session overrides + layoutTemplate 共有)
10. **web integration test** (`template-save.integration.test.tsx`)
11. **manual E2E**: `docs/dev/manuals/user_test_manual.md` に drag シナリオを追記し、scratch repo で手動確認
