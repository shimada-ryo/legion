# Web Flow Drag — Perf Fix 設計仕様書

**作成日:** 2026-05-15
**ステータス:** 実装着手用ドラフト
**対象パッケージ:** `packages/web`
**前提となる過去決定:** [2026-05-15_web_flow_drag_design.md](2026-05-15_web_flow_drag_design.md) (本 spec はそのフォローアップ)

本書は legion web UI の flow canvas drag 実装で表面化した致命的な UX 問題 (ノードを動かすたびに画面全体がチラつき・カクつく) を修正するためのサブ実装の設計です。コードを書く前に読んでください。

## 1. 目的と完了定義

**成果物:** TemplateCanvas / CanvasOverlay の両 canvas で、ノードを drag したときに **動かしたノード以外の React 再 render を発生させない**。drag は React Flow の標準パターン (`useNodesState` + `applyNodeChanges`) に乗せ替える。親 (TemplateDetail) への状態通知は drag 終了時 (`onNodeDragStop`) に限定する。

**完了条件:**

- 6 ノードのテンプレートで 1 ノードを drag したとき、Profiler 観測の component render 回数が drag フレーム数を線形に追従しない (= 動かしていないノードが再 render されない)。具体的には§7 で定義する perf regression test がパスする。
- TemplateDetail (親) のタブタイトル `●` マークは drag 中に明滅しない (drag 中は親の dirty state が触られないため)。
- Save / Reset / Unsaved badge / beforeunload / YAML 書き戻し の振る舞いは [前 spec](2026-05-15_web_flow_drag_design.md) と同等を維持する。
- 既存テストすべて pass。
- 手動 E2E でノードが「ヌルッと」動くこと (手で見て確認、これは spec の合否条件には入れないが受入条件)。

**完了の範囲外:**

- ノードの virtualisation / off-screen culling
- ノード描画の SVG → Canvas 化
- Web Worker での layout 計算
- 親 (TemplateDetail) と子 (TemplateCanvas) を 1 つのコンポーネントに統合する大規模リファクタ

## 2. スコープと前提

### 2.1 スコープ

- 修正ファイル: `packages/web/src/components/TemplateCanvas.tsx`, `packages/web/src/components/CanvasOverlay.tsx`
- テスト追加: `packages/web/test/components/TemplateCanvas.test.tsx` に perf regression test を 1〜2 ケース追加
- helper への追加なし (`layout.ts` 内の `applyPositionChanges` は本 spec では使わなくなるが、後方互換のため残す)
- spec / plan / 手動 runbook 更新: 本 spec が完了し次第、前 spec の §11 / runbook 末尾の関連箇所を必要に応じて補足する (本 spec 後に書く)

### 2.2 前提決定 (本書で確定)

| 番号 | 決定 | 採用案 |
|---|---|---|
| PF-01 | drag state の保持場所 | React Flow 推奨の `useNodesState`。`@xyflow/react` の hook を使う |
| PF-02 | drag 中の親通知 | しない (`onNodeDragStop` でのみ 1 回通知) |
| PF-03 | dirty 判定 | drag 終了時、現在 nodes の position と `baseLayout` を diff した結果から計算 |
| PF-04 | inline style / data オブジェクト | 親 useMemo の外で安定化、または `initialNodes` 計算時に 1 度だけ生成 |
| PF-05 | `applyPositionChanges` の扱い | 本 spec の修正では未使用化 (export は残す)。前 spec の単体テストは残す |
| PF-06 | CanvasOverlay (Instance) の取扱い | TemplateCanvas と同じパターンに揃える。Instance も in-session drag を持つので同根の問題 |

## 3. 根本原因 (再確認)

[前 spec](2026-05-15_web_flow_drag_design.md) §8.3 / §8.5 の設計と、[Task 8 / 10 の実装](../plans/2026-05-15_web_flow_drag.md) で生じた具体的なアンチパターン:

### 3.1 主犯: drag のたびに全ノード配列を新規構築

```tsx
const nodes = useMemo<Node[]>(
  () => template.nodes.map((n) => ({ id, position, data: { ... }, style: { ... } })),
  [template, baseLayout, overrides],   // overrides は drag のたびに更新される
)
```

drag のポインタイベント (秒間 ~60 回) ごとに:

1. `onNodesChange` → `setOverrides()` → React 再 render
2. `nodes` の useMemo deps `overrides` が変わるので再評価
3. 動いていないノードも含めて全 N 個の Node オブジェクトが新規構築される
4. `data`, `style` も毎回 new object (参照不一致)
5. React Flow は内部の shallow compare で「全ノードが新しい」と判断 → 全ノード React component を再 render

結果: 6 ノードなら drag 1 秒で 360+ ノード render が発生する。

### 3.2 共犯 A: 親への通知が drag のたびに発火

```tsx
useEffect(() => { onDirtyChange(Object.keys(overrides).length > 0) }, [overrides, onDirtyChange])
useEffect(() => { onPositionsChange(overrides) }, [overrides, onPositionsChange])
```

`overrides` が秒間 60 回変わるため effect も同回数発火。`onDirtyChange = setDirty` は React がベイルアウトしてくれるとはいえ、判定コストはかかる。`onPositionsChange` も親の `positionsRef.current` を更新するためにコールバックを毎回呼ぶ。さらに親 `TemplateDetail` で `onPositionsChange={(p) => ...}` を inline 定義しているため、deps が「変わったように見える」副作用も発生する。

### 3.3 共犯 B: タブタイトル更新が drag 中に発火

```tsx
// TemplateDetail.tsx
useEffect(() => {
  document.title = `${dirty ? '● ' : ''}${template.name} — legion`
  return () => { document.title = 'legion' }
}, [dirty, template])
```

`dirty` は最初の drag で `false → true` に切り替わって以後は変わらないので、これ自体は二度目以降の drag では発火しない。が、cleanup の `document.title = 'legion'` が走った直後に `● ...` が貼り直されるため、初回 drag 時に一瞬タイトルが消える「点滅」を起こしている可能性がある。

### 3.4 共犯 C: inline オブジェクトの参照不安定性

`data: { label }` と `style: { padding, ... }` を毎回 useMemo 内で作っているため、ノードの position が変わらなくても data/style 参照は変わる。React Flow 内部の `selectorEqualityFn` がノード再 render を防ぐためには参照安定性が必要。

## 4. 解決方針: React Flow 標準パターンへ乗せ替え

`@xyflow/react` v12 の README とソース (`useNodesEdgesState.d.ts`, `applyNodeChanges`) を参照すると、推奨形は以下のとおり:

```tsx
const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
```

ここで `useNodesState` の中身は:

```ts
const [nodes, setNodes] = useState(initialNodes)
const onNodesChange = useCallback(
  (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
  [],
)
```

`applyNodeChanges` は「変更があったノードだけ新しいオブジェクト参照、それ以外は元の参照を保持」する関数。これにより:

- React Flow の reconciler は「変更されたノード」のみ再 render する
- 動いていないノードの object identity が保たれる → 再 render されない

### 4.1 親への通知の新方式

drag 中は親に一切触らない。drag 終了 (`onNodeDragStop`) で 1 回だけ通知する:

```tsx
const onNodeDragStop = useCallback(() => {
  const overrides = diffPositionsFromBase(nodes, baseLayout)
  onPositionsChange(overrides)
  onDirtyChange(Object.keys(overrides).length > 0)
}, [nodes, baseLayout, onPositionsChange, onDirtyChange])
```

`diffPositionsFromBase` は現在 nodes 配列の中で baseLayout と異なる position を持つ要素を抽出する純関数 (本 spec で新規追加)。

### 4.2 saveSignal による reset

親が Save / Reset した直後に、子の nodes 状態を base に戻す:

```tsx
useEffect(() => { setNodes(initialNodes) }, [saveSignal])
```

ここで `initialNodes` も `useMemo` で `template` だけに依存して安定化する。

### 4.3 template 切替時

template prop が別ものに差し替わったときも `initialNodes` を作り直し、`setNodes` を呼ぶ。`useMemo([template])` で `initialNodes` が新しくなり、上の effect が走る形でカバーする。

### 4.4 inline オブジェクトの安定化

`data` / `style` は `initialNodes` 計算時に 1 度だけ作る。drag 中は position だけが変わり、data/style 参照は維持される。

## 5. データフロー

```
drag pointer move
  └─ React Flow 内部の onNodesChange (NodeChange[])
       └─ setNodes((nds) => applyNodeChanges(changes, nds))   ← 子の state だけ更新
            └─ 動いたノードだけ object 新規、他は同じ参照
                 └─ ReactFlow 内部の reconciler が動いたノードだけ再 render

drag end
  └─ onNodeDragStop callback
       ├─ diffPositionsFromBase(nodes, baseLayout)
       ├─ onPositionsChange(overrides)  ← 親に通知 1 回
       └─ onDirtyChange(... > 0)        ← 親に通知 1 回
            └─ 親 TemplateDetail が re-render (badge 表示、document.title 更新)
```

drag 中、親 (TemplateDetail) は一切再 render されない。

## 6. 具体的なコード変更

### 6.1 `packages/web/src/components/TemplateCanvas.tsx`

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
      data: { label: style.label },                   // stable per template
      style: {                                         // stable per template
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

function diffPositions(
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
  const initialNodes = useMemo(() => buildInitialNodes(template, baseLayout), [template, baseLayout])
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const { resolved } = useTheme()

  // template が切り替わったとき or saveSignal が来たときに reset
  useEffect(() => { setNodes(initialNodes) }, [initialNodes, setNodes])
  useEffect(() => { setNodes(initialNodes) }, [saveSignal, initialNodes, setNodes])

  // edges は template にしか依存しない
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

  // drag 終了時のみ親に通知
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

主要な変更点:
- `useNodesState` を導入
- `overrides` state を削除、`nodes` state がそのまま React Flow の controlled state
- `useEffect [overrides, onDirtyChange]` / `useEffect [overrides, onPositionsChange]` を削除
- `onNodeDragStop` で 1 回だけ親に通知
- `initialNodes` を helper 関数 `buildInitialNodes` で安定生成
- `diffPositions` helper を追加

### 6.2 `packages/web/src/components/CanvasOverlay.tsx`

同じパターンを適用する。Instance 側は親への通知 (Save 機能) がないので `onNodeDragStop` は不要だが、in-session drag が動くために `useNodesState` への切り替えは必要。

主な変更:
- `useNodesState(initialNodes)` を使う
- `overrides` state を削除
- `useEffect [template.id] → setOverrides({})` の代わりに `useEffect [initialNodes]` で `setNodes(initialNodes)`
- `roleStatus` (agentInstances 由来) が変わったときに data だけ更新する必要があるため、`useEffect [roleStatus, initialNodes]` で `setNodes` を更新する (position は保持して data だけ差し替えるロジックが必要)

`roleStatus` のリアルタイム更新は重要 (走行中の Instance はステータスが変わる)。これを drag state と両立させる工夫が要る:

```tsx
useEffect(() => {
  // roleStatus が変わったとき、現在 nodes の position を保持しつつ data だけ差し替え
  setNodes((current) =>
    current.map((cn) => {
      const status = roleStatusForNode(cn.id, template, roleStatus)
      const oldData = cn.data as StatusNodeData
      if (oldData.status === status) return cn   // 参照保持
      return { ...cn, data: { ...oldData, status } }
    }),
  )
}, [roleStatus, template, setNodes])
```

ポイント:
- 該当ノードのみ新規 object、他は元参照を保持
- `cn.position` は触らない (drag 結果を維持)

### 6.3 `applyPositionChanges` の扱い

`packages/web/src/components/template-canvas/layout.ts` の `applyPositionChanges` は本 spec の修正後は呼び出し元がなくなる。

選択肢:
- A. 削除する
- B. export を残す (将来また自前実装に戻したくなったときのため)

**採用: A. 削除する**。YAGNI。前 spec の単体テストも一緒に外す。`layoutTemplate` (テンプレート → base 位置) は今後も使うので残す。

## 7. 検証戦略 — 目で見ない方法で perf を担保する

UX 問題はブラウザでしか見えないが、原因は static に分析可能。以下 2 つの自動テストで regression を防ぐ。

### 7.1 Render-count regression test

React の `Profiler` API でコンポーネント render 数を計測する。

`packages/web/test/components/TemplateCanvas.test.tsx` に追加:

```tsx
import { Profiler, type ProfilerOnRenderCallback } from 'react'

test('drag of a single node does not re-render the whole tree per frame', () => {
  let canvasRenderCount = 0
  const onRender: ProfilerOnRenderCallback = (id, phase) => {
    if (id === 'tcv') canvasRenderCount++
  }

  const { container } = renderWithProviders(
    <Profiler id="tcv" onRender={onRender}>
      <TemplateCanvas
        template={TEMPLATE}
        onDirtyChange={() => {}}
        onPositionsChange={() => {}}
        saveSignal={0}
      />
    </Profiler>,
  )
  const baseline = canvasRenderCount

  // React Flow の onNodesChange を直接叩いて drag フレーム N 回分を発火
  // 60 フレーム分を流しても canvas 全体の render が線形に増えないことを確認する
  // 具体的な発火方法は実装で決める (内部 store dispatch, ReactFlowProvider context 経由)

  // assertion: 60 フレーム流しても canvas root の render は < 5
  expect(canvasRenderCount - baseline).toBeLessThan(5)
})
```

具体的な「drag を発火する API 経路」はリポジトリ内で固まり次第追記する (要 `@xyflow/react` の test utils 調査)。最低限の代替案: ReactFlow の `onNodesChange` を test ユーティリティ越しに呼び出すラッパを作る。

### 7.2 Object reference preservation test (純関数レベル)

`applyNodeChanges` の挙動契約は `@xyflow/react` 側のものなので、こちらでは「未変更ノードの object 参照が保持される」ことを `useNodesState` を通じて検証するテストを書く:

```tsx
test('unchanged nodes preserve object references after a single position change', () => {
  const initial: Node[] = [
    { id: 'a', position: { x: 0, y: 0 }, data: {} },
    { id: 'b', position: { x: 100, y: 0 }, data: {} },
  ]
  // useNodesState の動作: applyNodeChanges([positionChange(a)], initial) を呼んだ後、
  // 結果配列の 'b' エントリは initial の 'b' と同じ参照のはず
  // (これは @xyflow/react の契約で、本実装が前提とするもの)
  const next = applyNodeChanges(
    [{ id: 'a', type: 'position', position: { x: 50, y: 50 }, dragging: false }],
    initial,
  )
  expect(next[1]).toBe(initial[1])   // 'b' の参照保持
  expect(next[0]).not.toBe(initial[0])   // 'a' は新規
})
```

これは厳密には `@xyflow/react` の挙動契約 test なので、`packages/web/test/contracts/xyflow-applyNodeChanges.contract.test.ts` という contract test として置く (legion の mocks-require-contract policy と整合)。`@xyflow/react` を bump したとき必ず再走させる。

### 7.3 補助テスト: drag stop で初めて親通知が走る

```tsx
test('parent is NOT notified during drag (no calls until drag stop)', () => {
  let dirtyCalls = 0
  let positionsCalls = 0
  renderWithProviders(
    <TemplateCanvas
      template={TEMPLATE}
      onDirtyChange={() => dirtyCalls++}
      onPositionsChange={() => positionsCalls++}
      saveSignal={0}
    />,
  )
  // 初回 mount での 1 回ずつは許容
  const dBase = dirtyCalls
  const pBase = positionsCalls

  // 30 フレーム分の position change を発火 (drag stop なし)
  // ...

  // drag 中は親通知ゼロ
  expect(dirtyCalls - dBase).toBe(0)
  expect(positionsCalls - pBase).toBe(0)
})
```

### 7.4 既存 contract test との関係

- `writer.contract.test.ts` (前 spec): YAML round-trip の契約。本 spec の修正と無関係なので影響なし。
- `xyflow-applyNodeChanges.contract.test.ts` (本 spec で追加): React Flow の参照保持挙動の契約。
- 両方とも phase 境界 / `@xyflow/react` または `yaml` package bump 時に必須再走。

## 8. 既存挙動との差分

- TemplateCanvas / CanvasOverlay の挙動: 見た目は同等。違いは「drag がスムーズに見える」だけ。
- ドラッグ中の `Unsaved changes` badge: drag 終了で初めて表示される (drag 開始時点ではまだ出ない)。これは UX 上の小さな違いだが、許容できる (badge は永続的に出るので drag 終了直後にちゃんと出る)。
- ドラッグ中の document.title `●`: drag 終了で表示される。同上。
- `applyPositionChanges` helper の削除: 前 spec の §8.2 で導入した helper は本 spec で未使用となるため削除する。前 spec のテスト 3 件も削除。

## 9. 非ゴール / 将来仕事

- 多数ノード時 (100+) の virtualisation / culling
- Canvas API / WebGL レンダリング (React Flow は SVG 描画のため上限あり)
- 高さ可変ノード / リサイズ可能ノード
- Web Worker での layout 計算

これらは現状 (10〜20 ノード規模) では不要。`docs/DREAM.md` に追記する候補。

## 10. テスト戦略まとめ

| ファイル | 対象 | 種別 |
|---|---|---|
| `packages/web/test/components/TemplateCanvas.test.tsx` (拡張) | drag 中の親通知ゼロ、render 数線形性なし | unit |
| `packages/web/test/contracts/xyflow-applyNodeChanges.contract.test.ts` (新規) | 未変更ノードの object 参照保持 | contract |
| `packages/web/test/components/template-canvas/layout.test.ts` (削除) | 削除する `applyPositionChanges` の 3 テスト | (削除) |
| `packages/web/test/integration/template-save.integration.test.tsx` (既存) | 既存往復テストはそのまま pass する | regression |

`@xyflow/react` の bump 時には `xyflow-applyNodeChanges.contract.test.ts` 必須再走。

## 11. ファイル / 行数見積もり

| ファイル | 追加 / 変更 | 推定 |
|---|---|---|
| `packages/web/src/components/TemplateCanvas.tsx` | 書き換え (115 → 約 110 行) | ±0 |
| `packages/web/src/components/CanvasOverlay.tsx` | 書き換え (162 → 約 145 行) | -17 |
| `packages/web/src/components/template-canvas/layout.ts` | `applyPositionChanges` 削除 | -25 |
| `packages/web/test/components/template-canvas/layout.test.ts` | `applyPositionChanges` テスト削除 | -50 |
| `packages/web/test/components/TemplateCanvas.test.tsx` | perf test 2 ケース追加 | +60 |
| `packages/web/test/contracts/xyflow-applyNodeChanges.contract.test.ts` | 新規 contract test | +40 |

合計: source -42 行、test +50 行。実装は線が増えるどころか減る。

## 12. 実装順序

詳細は writing-plans で plan に分解する。大まかな依存:

1. contract test: `xyflow-applyNodeChanges.contract.test.ts` を先に書いて挙動契約を固める
2. TemplateCanvas を書き換え + 既存テスト + 新規 perf test を pass させる
3. CanvasOverlay を書き換え + 既存テスト pass
4. `applyPositionChanges` と関連 unit test を削除
5. 統合実行: `bun run test` 全 green、`writer.contract.test.ts` + 新 contract test の両方が単独でも pass
6. 手動 E2E (UX 確認はここで初めて目を使う)

## 13. 関連ドキュメント

- [2026-05-15_web_flow_drag_design.md](2026-05-15_web_flow_drag_design.md) — 前提となる drag 機能の元 spec
- [2026-05-15_web_flow_drag.md](../plans/2026-05-15_web_flow_drag.md) — 元 spec の実装プラン
- `docs/DREAM.md` — 将来仕事メモ (本 spec の非ゴールを追記する候補)
