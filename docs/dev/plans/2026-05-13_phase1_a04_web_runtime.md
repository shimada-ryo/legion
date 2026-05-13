# Phase 1 / a04: Web UI Track A 実装計画

> **エージェント worker 向け:** 必須 sub-skill: `superpowers:subagent-driven-development` (推奨) または `superpowers:executing-plans`。Steps は checkbox で進捗管理。

**Goal:** Phase 1 spec §6 (D-034, D-035) に従って、Track A 用の Web UI を React + Vite で立てる。ルートは 5 つ (`/templates`, `/templates/:id`, `/instances`, `/instances/:id`, `/settings`) で、Phase 1 実装範囲は **Instances 系 2 ルート + Settings placeholder**。`/instances/:id` は 3-panel (canvas + 右 sidebar + 下部 event log) を持ち、a03 の HTTP/WS API を消費する。

**Architecture:** `packages/web/` を Vite + React 18+ + TypeScript で構築。状態管理は D-008 の決定により最小 (`fetch` + `useState` + `useReducer` + WebSocket、TanStack Query 不採用)。ルーティングは `react-router-dom`。Canvas は `@xyflow/react`。Bottom event log と Right sidebar は固定レイアウト。`/templates` は Track B (b01) で作るので本計画では list ルートを placeholder にしておく。

**Tech Stack:** TypeScript / Vite / React / `react-router-dom` / `@xyflow/react` / 標準 `WebSocket` / 標準 `fetch`

**Spec reference:** [../specs/2026-05-13_phase1_design.md](../specs/2026-05-13_phase1_design.md) §6
**Decisions reference:** D-008, D-034, D-035
**Dependency on:** [a03](2026-05-13_phase1_a03_server.md) — 起動中の HTTP/WS API を叩く

---

## File Structure

新規作成 (Vite scaffold で生成される定型は省略):

- `packages/web/vite.config.ts` — Vite 設定
- `packages/web/tsconfig.json` — React 用に調整
- `packages/web/index.html` — Vite エントリ HTML
- `packages/web/src/main.tsx` — React 起動
- `packages/web/src/App.tsx` — Router + top tab nav
- `packages/web/src/api/client.ts` — HTTP API client
- `packages/web/src/api/event-stream.ts` — WebSocket subscription hook
- `packages/web/src/pages/InstancesList.tsx` — `/instances`
- `packages/web/src/pages/InstanceDetail.tsx` — `/instances/:id` 3-panel layout
- `packages/web/src/pages/TemplatesList.tsx` — `/templates` (b01 でフル実装、ここでは骨組み)
- `packages/web/src/pages/TemplateDetail.tsx` — `/templates/:id` (b01 でフル実装、ここではプレースホルダ)
- `packages/web/src/pages/Settings.tsx` — `/settings` placeholder
- `packages/web/src/components/TopNav.tsx`
- `packages/web/src/components/InstanceCard.tsx`
- `packages/web/src/components/CanvasOverlay.tsx` — Layer 2 (`@xyflow/react`)
- `packages/web/src/components/EventLogPane.tsx` — bottom panel
- `packages/web/src/components/SidebarTabs.tsx` — 右 sidebar コンテナ
- `packages/web/src/components/sidebar-tabs/OverviewTab.tsx`
- `packages/web/src/components/sidebar-tabs/EventsTab.tsx`
- `packages/web/src/components/sidebar-tabs/DiffTab.tsx`
- `packages/web/src/components/sidebar-tabs/TasksTab.tsx`
- `packages/web/src/components/event-renderers/MessageEvent.tsx`
- `packages/web/src/components/event-renderers/ToolCallEvent.tsx`
- `packages/web/src/components/event-renderers/PermissionRequestEvent.tsx`
- `packages/web/src/components/event-renderers/StatusChangeEvent.tsx`
- `packages/web/src/styles.css` — minimal global CSS
- `packages/web/src/types.ts` — frontend-only 型 (server レスポンスのナロー型)
- `packages/web/test/api/client.test.ts`
- `packages/web/test/components/InstanceCard.test.tsx`
- `packages/web/test/components/event-renderers/PermissionRequestEvent.test.tsx`

修正:

- `packages/web/package.json` — React + Vite + 依存追加
- `packages/web/tsconfig.json` — react jsx 設定

---

## 予測行数 (実測との比較用)

### 実装ファイル (web)

| ファイル | 予測行数 | 主要内訳 | 上限への余裕 |
| --- | ---: | --- | --- |
| `vite.config.ts` | 20 | proxy 設定 | 余裕大 |
| `index.html` | 13 | Vite エントリ | 余裕大 |
| `src/main.tsx` | 12 | createRoot | 余裕大 |
| `src/App.tsx` | 25 | Routes 定義 | 余裕大 |
| `src/styles.css` | 8 | base reset | 余裕大 |
| `src/types.ts` | 30 | フロント側の narrow 型 | 余裕大 |
| `src/api/client.ts` | 65 | 6 fetch 関数 (各 ~8-12) | 余裕大 |
| `src/api/event-stream.ts` | 25 | `useInstanceEventStream` hook | 余裕大 |
| `src/components/TopNav.tsx` | 25 | nav + NavLink | 余裕大 |
| `src/components/InstanceCard.tsx` | 40 | カード 1 個 | 余裕大 |
| `src/components/CanvasOverlay.tsx` | 75 | xyflow バインド (`deriveActiveRoles` 含む) | 余裕大 |
| `src/components/EventLogPane.tsx` | 15 | bottom log の素朴な list | 余裕大 |
| `src/components/SidebarTabs.tsx` | 55 | タブ切替 + 各タブ呼び分け | 余裕大 |
| `src/components/sidebar-tabs/OverviewTab.tsx` | 30 | dl 表示 | 余裕大 |
| `src/components/sidebar-tabs/EventsTab.tsx` | 25 | 種別 dispatcher | 余裕大 |
| `src/components/sidebar-tabs/DiffTab.tsx` | 50 | fetch + 折りたたみ | 余裕大 |
| `src/components/sidebar-tabs/TasksTab.tsx` | 10 | placeholder | 余裕大 |
| `src/components/event-renderers/MessageEvent.tsx` | 15 | バブル 1 つ | 余裕大 |
| `src/components/event-renderers/ToolCallEvent.tsx` | 30 | 折りたたみ + JSON pretty | 余裕大 |
| `src/components/event-renderers/PermissionRequestEvent.tsx` | 50 | Approve/Deny + fetch | 余裕大 |
| `src/components/event-renderers/StatusChangeEvent.tsx` | 12 | 1 行表示 | 余裕大 |
| `src/pages/InstancesList.tsx` | 55 | polling list + grid | 余裕大 |
| `src/pages/InstanceDetail.tsx` | 60 | 3-panel grid + hooks | 余裕大 |
| `src/pages/Settings.tsx` | 12 | placeholder | 余裕大 |
| `src/pages/TemplatesList.tsx` | 5 | placeholder (b01 で本実装 +40) | 余裕大 |
| `src/pages/TemplateDetail.tsx` | 5 | placeholder (b01 で本実装 +40) | 余裕大 |

### 実装ファイル (server 側の追加、Task 9 で a03 に補遺)

| ファイル | 予測行数 | 主要内訳 |
| --- | ---: | --- |
| `server/src/http/handlers/diff.ts` | 30 | `handleInstanceDiff` 1 関数 |

**実装小計: 800 (web 770 + server 補遺 30)**

### テストファイル

| ファイル | 予測行数 |
| --- | ---: |
| `test/setup.ts` | 5 |
| `bunfig.toml` | 3 |
| `test/components/InstanceCard.test.tsx` | 50 |
| `test/components/event-renderers/PermissionRequestEvent.test.tsx` | 70 |
| `test/api/client.test.ts` | 50 |
| **テスト小計** | **178** |

### 粒度評価

- 最大ファイル予測 = `CanvasOverlay.tsx` 75 行、`api/client.ts` 65 行、`InstanceDetail.tsx` 60 行。
- 1 ファイル 1 コンポーネント原則を貫いている (Sidebar の sub-tab、event renderer の subtype 別、それぞれ別ファイル)。component 単位の split によりテスト isolation も容易。
- 行数で見ると小ファイルが多いが、これは Layer 2 描画 / 各 sidebar tab / 各 event 種別という concern boundary を表現するため。並べると total 行数の多さよりも 1 ファイル 1 役割の明瞭さが価値を持つ。
- `pages/InstanceDetail.tsx` は 3-panel の grid template と各 panel の data 渡しだけに留め、ロジックは子コンポーネントへ。これにより `InstanceDetail.tsx` は上限近くに肥大しない。
- Phase 2 で Director-Worker や approval flow が複雑化したら、`PermissionRequestEvent.tsx` がモーダル / 詳細フォーム化して膨らむ予兆あり。その時点で `event-renderers/permission/` サブディレクトリへ分割する想定。

---

## Task 1: 新規依存の D-010 チェックリスト

追加候補:
- `react`, `react-dom` (UI ライブラリ、D-008 で承認済み)
- `vite`, `@vitejs/plugin-react` (ビルドツール、D-008 承認)
- `@types/react`, `@types/react-dom` (型のみ)
- `react-router-dom` (ルーティング)
- `@xyflow/react` (React Flow successor、D-008 承認の具体パッケージ)
- (test): `@testing-library/react`, `@testing-library/dom`, `happy-dom`

- [ ] **Step 1: 各パッケージの健全性を調査**

実行:

```bash
bun pm view react versions --json | tail -3
bun pm view vite versions --json | tail -3
bun pm view @xyflow/react versions --json | tail -3
bun pm view react-router-dom versions --json | tail -3
bun pm view @testing-library/react versions --json | tail -3
bun pm view happy-dom versions --json | tail -3
```

確認: 各パッケージの最新版、最終更新、既知のセキュリティアドバイザリ。

- [ ] **Step 2: User 承認**

要約を提示して承認を取る。代替候補も併記:
- React 18 vs 19 → 19 を推奨 (新機能 `use()` / hook 改善)
- `@xyflow/react` (旧 `react-flow`) → 公式後継、現役
- `react-router-dom` → デファクト
- `happy-dom` → DOM emulation、`jsdom` より速い

- [ ] **Step 3: 依存追加**

```bash
bun add react react-dom react-router-dom @xyflow/react --filter @legion/web
bun add -D vite @vitejs/plugin-react @types/react @types/react-dom @testing-library/react @testing-library/dom happy-dom --filter @legion/web
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/package.json bun.lockb
git commit -m "deps: add React/Vite/xyflow stack to web per D-010"
```

---

## Task 2: Vite + React の最小 scaffold

**Files:**
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/index.html`
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/App.tsx`
- Create: `packages/web/src/styles.css`
- Modify: `packages/web/tsconfig.json`
- Modify: `packages/web/package.json` (scripts)

- [ ] **Step 1: tsconfig.json を React 用に**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "jsx": "react-jsx",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "types": ["bun", "vite/client"]
  },
  "include": ["src/**/*", "test/**/*", "vite.config.ts"]
}
```

- [ ] **Step 2: vite.config.ts**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/templates': 'http://localhost:5500',
      '/instances': 'http://localhost:5500',
      '/workflows': 'http://localhost:5500',
      '/ws': { target: 'ws://localhost:5500', ws: true },
    },
  },
})
```

(`legion` server に dev 中はプロキシ。)

- [ ] **Step 3: index.html**

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>legion</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: main.tsx と App.tsx の骨組み**

`packages/web/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
```

`packages/web/src/App.tsx`:

```tsx
import { Routes, Route, Navigate } from 'react-router-dom'
import TopNav from './components/TopNav'
import TemplatesList from './pages/TemplatesList'
import TemplateDetail from './pages/TemplateDetail'
import InstancesList from './pages/InstancesList'
import InstanceDetail from './pages/InstanceDetail'
import Settings from './pages/Settings'

export default function App() {
  return (
    <div className="app">
      <TopNav />
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/instances" replace />} />
          <Route path="/templates" element={<TemplatesList />} />
          <Route path="/templates/:id" element={<TemplateDetail />} />
          <Route path="/instances" element={<InstancesList />} />
          <Route path="/instances/:id" element={<InstanceDetail />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}
```

`packages/web/src/styles.css` (最小):

```css
:root { font-family: system-ui, sans-serif; }
* { box-sizing: border-box; }
body, html, #root { height: 100%; margin: 0; }
.app { display: flex; flex-direction: column; height: 100%; }
.main { flex: 1; overflow: hidden; }
```

- [ ] **Step 5: 各ページの placeholder**

`packages/web/src/pages/TemplatesList.tsx`, `TemplateDetail.tsx`, `Settings.tsx`:

```tsx
export default function TemplatesList() {
  return <div style={{ padding: 16 }}>Templates (b01 で実装)</div>
}
```

同様の placeholder を `TemplateDetail`, `Settings`, `InstancesList`, `InstanceDetail` に作る (後の task で中身を埋める)。

- [ ] **Step 6: TopNav (placeholder)**

`packages/web/src/components/TopNav.tsx`:

```tsx
import { NavLink } from 'react-router-dom'

export default function TopNav() {
  return (
    <nav className="topnav" style={{ borderBottom: '1px solid #ddd', padding: 8 }}>
      <span style={{ fontWeight: 600, marginRight: 16 }}>LEGION</span>
      <NavLink to="/templates" style={navStyle}>Templates</NavLink>
      <NavLink to="/instances" style={navStyle}>Instances</NavLink>
      <NavLink to="/settings" style={navStyle}>Settings</NavLink>
    </nav>
  )
}

const navStyle = ({ isActive }: { isActive: boolean }) => ({
  marginRight: 12,
  color: isActive ? '#0066cc' : '#333',
  textDecoration: 'none',
  fontWeight: isActive ? 600 : 400,
})
```

- [ ] **Step 7: package.json scripts**

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "typecheck": "tsc --noEmit",
  "test": "bun test"
}
```

- [ ] **Step 8: 確認**

```bash
bun run --filter @legion/web typecheck
bun run --filter @legion/web dev &
sleep 2
curl -s http://localhost:5173 | grep -o 'legion'
kill %1
```

期待: `legion` がレスポンスに含まれる (タイトル経由)。

- [ ] **Step 9: Commit**

```bash
git add packages/web/
git commit -m "feat(web): scaffold Vite + React + router + 5 routes"
```

---

## Task 3: API client + WebSocket フック

**Files:**
- Create: `packages/web/src/api/client.ts`
- Create: `packages/web/src/api/event-stream.ts`
- Create: `packages/web/src/types.ts`

- [ ] **Step 1: 型を切る**

`packages/web/src/types.ts`:

```ts
import type { WorkflowTemplate, AgentEvent } from '@legion/core'

export interface InstanceSummary {
  id: string
  templateId: string
  status: string
  startedAt: string
  endedAt: string | null
}

export interface InstanceDetail extends InstanceSummary {
  templateSnapshot: WorkflowTemplate
  events: AgentEvent[]
}

export interface TemplateSummary {
  id: string
  name: string
  description: string | null
  nodeCount: number
}
```

- [ ] **Step 2: client.ts**

`packages/web/src/api/client.ts`:

```ts
import type { InstanceDetail, InstanceSummary, TemplateSummary } from '../types'
import type { WorkflowTemplate } from '@legion/core'

const BASE = '' // dev: proxied via vite; prod: same-origin

export async function listTemplates(): Promise<TemplateSummary[]> {
  const res = await fetch(`${BASE}/templates`)
  if (!res.ok) throw new Error(`GET /templates: ${res.status}`)
  return res.json()
}

export async function getTemplate(id: string): Promise<WorkflowTemplate> {
  const res = await fetch(`${BASE}/templates/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`GET /templates/${id}: ${res.status}`)
  return res.json()
}

export async function listInstances(): Promise<InstanceSummary[]> {
  const res = await fetch(`${BASE}/instances`)
  if (!res.ok) throw new Error(`GET /instances: ${res.status}`)
  return res.json()
}

export async function getInstance(id: string): Promise<InstanceDetail> {
  const res = await fetch(`${BASE}/instances/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`GET /instances/${id}: ${res.status}`)
  return res.json()
}

export async function triggerWorkflow(
  templateId: string,
  userPrompt: string,
  baseRef?: string,
): Promise<{ workflowInstanceId: string }> {
  const res = await fetch(`${BASE}/workflows/trigger`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ templateId, userPrompt, baseRef }),
  })
  if (!res.ok) throw new Error(`POST /workflows/trigger: ${res.status}`)
  return res.json()
}

export async function resolveApproval(
  instanceId: string,
  approvalId: string,
  decision: 'approve' | 'deny',
  reason?: string,
): Promise<void> {
  const res = await fetch(
    `${BASE}/instances/${encodeURIComponent(instanceId)}/approvals/${encodeURIComponent(approvalId)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision, reason }),
    },
  )
  if (!res.ok) throw new Error(`approval: ${res.status}`)
}
```

- [ ] **Step 3: event-stream フック**

`packages/web/src/api/event-stream.ts`:

```ts
import { useEffect, useState } from 'react'
import type { AgentEvent } from '@legion/core'

export function useInstanceEventStream(instanceId: string | undefined): AgentEvent[] {
  const [events, setEvents] = useState<AgentEvent[]>([])
  useEffect(() => {
    if (!instanceId) return
    setEvents([])
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}/ws/instances/${encodeURIComponent(instanceId)}/events`
    const ws = new WebSocket(url)
    ws.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data as string) as AgentEvent
        setEvents((prev) => [...prev, evt])
      } catch {
        // ignore malformed
      }
    }
    return () => ws.close()
  }, [instanceId])
  return events
}
```

- [ ] **Step 4: tsc 確認**

```bash
bun run --filter @legion/web typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api/ packages/web/src/types.ts
git commit -m "feat(web): API client and WebSocket event stream hook"
```

---

## Task 4: `/instances` 一覧 (kanban カード)

**Files:**
- Modify: `packages/web/src/pages/InstancesList.tsx`
- Create: `packages/web/src/components/InstanceCard.tsx`
- Create: `packages/web/test/components/InstanceCard.test.tsx`

- [ ] **Step 1: 失敗するテストを書く**

`packages/web/test/components/InstanceCard.test.tsx`:

```tsx
import { describe, test, expect } from 'bun:test'
import { render } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import InstanceCard from '../../src/components/InstanceCard'

describe('InstanceCard', () => {
  test('renders template id and status', () => {
    const { getByText } = render(
      <BrowserRouter>
        <InstanceCard
          instance={{
            id: '01H000000000000000000000XX',
            templateId: 'feature-implementation',
            status: 'running',
            startedAt: new Date('2026-05-13T10:00:00Z').toISOString(),
            endedAt: null,
          }}
        />
      </BrowserRouter>,
    )
    expect(getByText('feature-implementation')).toBeDefined()
    expect(getByText(/running/)).toBeDefined()
  })

  test('links to the instance detail page', () => {
    const { container } = render(
      <BrowserRouter>
        <InstanceCard
          instance={{
            id: '01H000000000000000000000YY',
            templateId: 't',
            status: 'completed',
            startedAt: new Date().toISOString(),
            endedAt: null,
          }}
        />
      </BrowserRouter>,
    )
    const a = container.querySelector('a')
    expect(a?.getAttribute('href')).toBe('/instances/01H000000000000000000000YY')
  })
})
```

(`bunfig.toml` または `package.json` で `bun test` の dom emulation を `happy-dom` に設定する必要がある。次の step で扱う。)

- [ ] **Step 2: bun:test を DOM 化**

`packages/web/bunfig.toml`:

```toml
[test]
preload = ["./test/setup.ts"]
```

`packages/web/test/setup.ts`:

```ts
import { GlobalRegistrator } from '@happy-dom/global-registrator'
GlobalRegistrator.register()
```

`@happy-dom/global-registrator` を deps に追加:

```bash
bun add -D @happy-dom/global-registrator --filter @legion/web
```

- [ ] **Step 3: 失敗を確認**

```bash
bun test packages/web/test/components/InstanceCard.test.tsx
```

期待: module not found。

- [ ] **Step 4: InstanceCard を実装**

`packages/web/src/components/InstanceCard.tsx`:

```tsx
import { Link } from 'react-router-dom'
import type { InstanceSummary } from '../types'

const STATUS_COLOR: Record<string, string> = {
  running: '#0066cc',
  waiting: '#cc8800',
  completed: '#00aa44',
  failed: '#cc2222',
}

export default function InstanceCard({ instance }: { instance: InstanceSummary }) {
  return (
    <Link
      to={`/instances/${instance.id}`}
      style={{
        display: 'block',
        padding: 12,
        border: '1px solid #ddd',
        borderRadius: 6,
        textDecoration: 'none',
        color: 'inherit',
        background: 'white',
      }}
    >
      <div style={{ fontWeight: 600 }}>{instance.templateId}</div>
      <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
        <span style={{ color: STATUS_COLOR[instance.status] ?? '#666' }}>{instance.status}</span>
        {' · '}
        <span>{new Date(instance.startedAt).toLocaleString()}</span>
      </div>
      <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>{instance.id.slice(0, 8)}</div>
    </Link>
  )
}
```

- [ ] **Step 5: InstancesList を実装**

`packages/web/src/pages/InstancesList.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { listInstances } from '../api/client'
import type { InstanceSummary } from '../types'
import InstanceCard from '../components/InstanceCard'

const STATUSES = ['running', 'waiting', 'completed', 'failed'] as const

export default function InstancesList() {
  const [items, setItems] = useState<InstanceSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const data = await listInstances()
        if (alive) setItems(data)
      } catch (e) {
        if (alive) setError((e as Error).message)
      }
    }
    tick()
    const id = setInterval(tick, 2000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  if (error) return <div style={{ padding: 16, color: '#c22' }}>Error: {error}</div>

  return (
    <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
      {STATUSES.map((s) => (
        <div key={s}>
          <h3 style={{ marginTop: 0 }}>{s}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items
              .filter((i) => i.status === s)
              .map((i) => (
                <InstanceCard key={i.id} instance={i} />
              ))}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 6: テスト成功確認**

```bash
bun test packages/web/test/components/InstanceCard.test.tsx
```

期待: 2 tests passed。

- [ ] **Step 7: Commit**

```bash
git add packages/web/
git commit -m "feat(web): /instances kanban list + InstanceCard"
```

---

## Task 5: `/instances/:id` 3-panel layout shell

**Files:**
- Modify: `packages/web/src/pages/InstanceDetail.tsx`
- Create: `packages/web/src/components/CanvasOverlay.tsx`
- Create: `packages/web/src/components/EventLogPane.tsx`
- Create: `packages/web/src/components/SidebarTabs.tsx`

- [ ] **Step 1: InstanceDetail のスケルトン**

`packages/web/src/pages/InstanceDetail.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getInstance } from '../api/client'
import type { InstanceDetail as InstanceDetailType } from '../types'
import { useInstanceEventStream } from '../api/event-stream'
import CanvasOverlay from '../components/CanvasOverlay'
import SidebarTabs from '../components/SidebarTabs'
import EventLogPane from '../components/EventLogPane'

export default function InstanceDetail() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<InstanceDetailType | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const events = useInstanceEventStream(id)

  useEffect(() => {
    if (!id) return
    getInstance(id).then(setData).catch(console.error)
  }, [id])

  if (!data) return <div style={{ padding: 16 }}>Loading…</div>

  return (
    <div className="instance-detail" style={layoutStyle}>
      <div className="canvas-area" style={canvasStyle}>
        <CanvasOverlay
          template={data.templateSnapshot}
          events={events}
          onSelectNode={setSelectedNodeId}
        />
      </div>
      <div className="sidebar" style={sidebarStyle}>
        <SidebarTabs
          instanceId={data.id}
          selectedNodeId={selectedNodeId}
          template={data.templateSnapshot}
          events={events}
        />
      </div>
      <div className="event-log" style={eventLogStyle}>
        <EventLogPane events={events} instanceId={data.id} />
      </div>
    </div>
  )
}

const layoutStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 360px',
  gridTemplateRows: '1fr 240px',
  gridTemplateAreas: '"canvas sidebar" "log log"',
  height: '100%',
}
const canvasStyle: React.CSSProperties = { gridArea: 'canvas', borderRight: '1px solid #ddd' }
const sidebarStyle: React.CSSProperties = { gridArea: 'sidebar', overflowY: 'auto' }
const eventLogStyle: React.CSSProperties = {
  gridArea: 'log',
  borderTop: '1px solid #ddd',
  overflowY: 'auto',
  background: '#fafafa',
}
```

- [ ] **Step 2: 子コンポーネントのプレースホルダ**

`packages/web/src/components/CanvasOverlay.tsx`:

```tsx
import type { WorkflowTemplate, AgentEvent } from '@legion/core'

export interface CanvasOverlayProps {
  template: WorkflowTemplate
  events: AgentEvent[]
  onSelectNode: (id: string | null) => void
}

export default function CanvasOverlay(props: CanvasOverlayProps) {
  return (
    <div style={{ padding: 8 }}>
      <div style={{ fontSize: 12, color: '#666' }}>Canvas (Task 6 で React Flow に置換)</div>
      <ul>
        {props.template.nodes.map((n) => (
          <li key={n.id}>
            <button onClick={() => props.onSelectNode(n.id)}>{n.id} ({n.type})</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

`packages/web/src/components/EventLogPane.tsx`:

```tsx
import type { AgentEvent } from '@legion/core'

export default function EventLogPane(props: { events: AgentEvent[]; instanceId: string }) {
  return (
    <div style={{ padding: 8, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
      {props.events.map((e) => (
        <div key={e.id}>
          [{new Date(e.timestamp).toLocaleTimeString()}] {e.type} / {e.sessionId.slice(0, 8)}
        </div>
      ))}
    </div>
  )
}
```

`packages/web/src/components/SidebarTabs.tsx`:

```tsx
import { useState } from 'react'
import type { WorkflowTemplate, AgentEvent } from '@legion/core'

export interface SidebarTabsProps {
  instanceId: string
  selectedNodeId: string | null
  template: WorkflowTemplate
  events: AgentEvent[]
}

const TABS = ['Overview', 'Events', 'Diff', 'Tasks'] as const
type TabName = (typeof TABS)[number]

export default function SidebarTabs(props: SidebarTabsProps) {
  const [tab, setTab] = useState<TabName>('Overview')
  return (
    <div>
      <div style={{ borderBottom: '1px solid #ddd' }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: 8,
              border: 'none',
              background: tab === t ? '#eef' : 'transparent',
              cursor: 'pointer',
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div style={{ padding: 8 }}>
        {tab === 'Overview' && <div>Overview (Task 7)</div>}
        {tab === 'Events' && <div>Events (Task 8)</div>}
        {tab === 'Diff' && <div>Diff (Task 9)</div>}
        {tab === 'Tasks' && <div>Tasks (Task 10)</div>}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: typecheck + visual smoke**

```bash
bun run --filter @legion/web typecheck
```

期待: pass.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/InstanceDetail.tsx packages/web/src/components/CanvasOverlay.tsx packages/web/src/components/EventLogPane.tsx packages/web/src/components/SidebarTabs.tsx
git commit -m "feat(web): /instances/:id 3-panel shell"
```

---

## Task 6: Canvas を `@xyflow/react` で実装

Template の `nodes` / `edges` を React Flow 用に変換、active な Agent Instance を highlight (Phase 1 では event の sessionId と Role node の id 関連付けはまだ無いので、status_change を観測した最後の sessionId に紐づく Role node を highlight する単純版)。

**Files:**
- Modify: `packages/web/src/components/CanvasOverlay.tsx`

- [ ] **Step 1: React Flow を組み込み**

`packages/web/src/components/CanvasOverlay.tsx`:

```tsx
import { useMemo } from 'react'
import { ReactFlow, Background, Controls, type Node, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { WorkflowTemplate, AgentEvent, TemplateNode } from '@legion/core'

export interface CanvasOverlayProps {
  template: WorkflowTemplate
  events: AgentEvent[]
  onSelectNode: (id: string | null) => void
}

const NODE_COLORS: Record<TemplateNode['type'], string> = {
  trigger: '#888',
  role: '#0066cc',
  blackboard: '#aa00aa',
  'human-gate': '#cc8800',
  sink: '#444',
}

export default function CanvasOverlay({ template, events, onSelectNode }: CanvasOverlayProps) {
  const activeRoleIds = useMemo(() => deriveActiveRoles(template, events), [template, events])
  const nodes = useMemo<Node[]>(
    () =>
      template.nodes.map((n, i) => ({
        id: n.id,
        position: { x: (i % 4) * 180, y: Math.floor(i / 4) * 100 },
        data: { label: `${n.id}\n(${n.type})` },
        style: {
          padding: 8,
          background: activeRoleIds.has(n.id) ? '#e8f0ff' : 'white',
          border: `2px solid ${NODE_COLORS[n.type] ?? '#888'}`,
          borderRadius: 6,
          fontSize: 12,
          whiteSpace: 'pre-line',
        },
      })),
    [template, activeRoleIds],
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
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}

function deriveActiveRoles(
  template: WorkflowTemplate,
  _events: AgentEvent[],
): Set<string> {
  // Phase 1: highlight any role node when any event has arrived.
  // Future: map sessionId → roleNodeId via AgentInstance table.
  return new Set(template.nodes.filter((n) => n.type === 'role').map((n) => n.id))
}
```

- [ ] **Step 2: typecheck**

```bash
bun run --filter @legion/web typecheck
```

期待: pass.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/CanvasOverlay.tsx
git commit -m "feat(web): CanvasOverlay using @xyflow/react"
```

---

## Task 7: Overview tab

選択中 node の概要情報を出す。Role node の場合は role / lifetime / provider、その他はそのフィールド。

**Files:**
- Create: `packages/web/src/components/sidebar-tabs/OverviewTab.tsx`
- Modify: `packages/web/src/components/SidebarTabs.tsx`

- [ ] **Step 1: 実装**

`packages/web/src/components/sidebar-tabs/OverviewTab.tsx`:

```tsx
import type { WorkflowTemplate } from '@legion/core'

export default function OverviewTab(props: {
  template: WorkflowTemplate
  selectedNodeId: string | null
}) {
  if (!props.selectedNodeId) return <div>Select a node to inspect.</div>
  const n = props.template.nodes.find((x) => x.id === props.selectedNodeId)
  if (!n) return <div>Unknown node.</div>
  return (
    <dl style={{ margin: 0 }}>
      <dt>ID</dt><dd>{n.id}</dd>
      <dt>Type</dt><dd>{n.type}</dd>
      {n.type === 'role' && (
        <>
          <dt>Role</dt><dd>{n.role}</dd>
          <dt>Provider</dt><dd>{n.provider}</dd>
          <dt>Lifetime</dt><dd>{n.lifetime}</dd>
        </>
      )}
      {n.type === 'trigger' && <><dt>Kind</dt><dd>{n.kind}</dd></>}
      {n.type === 'blackboard' && <><dt>Schema</dt><dd><pre>{JSON.stringify(n.schema, null, 2)}</pre></dd></>}
      {n.type === 'human-gate' && <><dt>Label</dt><dd>{n.label}</dd></>}
      {n.type === 'sink' && <><dt>Kind</dt><dd>{n.kind}</dd></>}
    </dl>
  )
}
```

- [ ] **Step 2: SidebarTabs に組み込み**

```tsx
import OverviewTab from './sidebar-tabs/OverviewTab'
// ...
{tab === 'Overview' && (
  <OverviewTab template={props.template} selectedNodeId={props.selectedNodeId} />
)}
```

- [ ] **Step 3: typecheck**

```bash
bun run --filter @legion/web typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/sidebar-tabs/OverviewTab.tsx packages/web/src/components/SidebarTabs.tsx
git commit -m "feat(web): Overview tab in sidebar"
```

---

## Task 8: Events tab (構造化イベント描画)

D-035 の event subtype 描画 (assistant message / tool use / tool result / permission request)。

**Files:**
- Create: `packages/web/src/components/sidebar-tabs/EventsTab.tsx`
- Create: `packages/web/src/components/event-renderers/MessageEvent.tsx`
- Create: `packages/web/src/components/event-renderers/ToolCallEvent.tsx`
- Create: `packages/web/src/components/event-renderers/PermissionRequestEvent.tsx`
- Create: `packages/web/src/components/event-renderers/StatusChangeEvent.tsx`
- Create: `packages/web/test/components/event-renderers/PermissionRequestEvent.test.tsx`
- Modify: `packages/web/src/components/SidebarTabs.tsx`

- [ ] **Step 1: 各 event renderer**

`MessageEvent.tsx`:

```tsx
import type { AgentEvent } from '@legion/core'

export default function MessageEvent({ event }: { event: AgentEvent }) {
  const text = (event.payload as { text?: string }).text ?? ''
  return (
    <div style={{ padding: 8, background: '#f6f6f6', borderRadius: 6, margin: '4px 0' }}>
      <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>assistant</div>
      <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
    </div>
  )
}
```

`ToolCallEvent.tsx`:

```tsx
import { useState } from 'react'
import type { AgentEvent } from '@legion/core'

export default function ToolCallEvent({ event }: { event: AgentEvent }) {
  const [open, setOpen] = useState(false)
  const p = event.payload as { name?: string; input?: unknown; result?: unknown; kind?: string }
  return (
    <div style={{ padding: 8, border: '1px solid #ddd', borderRadius: 6, margin: '4px 0' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        {open ? '▼' : '▶'} tool {p.name ?? '?'} {p.kind === 'result' ? '(result)' : ''}
      </button>
      {open && (
        <pre style={{ marginTop: 8, fontSize: 11, overflow: 'auto' }}>
          {JSON.stringify(p.input ?? p.result, null, 2)}
        </pre>
      )}
    </div>
  )
}
```

`PermissionRequestEvent.tsx`:

```tsx
import { useState } from 'react'
import type { AgentEvent } from '@legion/core'
import { resolveApproval } from '../../api/client'

export default function PermissionRequestEvent({
  event,
  instanceId,
}: {
  event: AgentEvent
  instanceId: string
}) {
  const p = event.payload as { approvalId?: string; tool?: string; input?: unknown }
  const [decided, setDecided] = useState<'approve' | 'deny' | null>(null)

  async function decide(d: 'approve' | 'deny') {
    if (!p.approvalId) return
    await resolveApproval(instanceId, p.approvalId, d)
    setDecided(d)
  }

  return (
    <div style={{ padding: 8, background: '#fff5d6', border: '1px solid #cc8800', borderRadius: 6, margin: '4px 0' }}>
      <div style={{ fontSize: 11, color: '#664400' }}>permission request</div>
      <div style={{ marginTop: 4 }}><strong>{p.tool ?? '?'}</strong></div>
      <pre style={{ fontSize: 11, overflow: 'auto', maxHeight: 100 }}>
        {JSON.stringify(p.input, null, 2)}
      </pre>
      {decided ? (
        <div style={{ marginTop: 8, color: decided === 'approve' ? '#0a0' : '#a00' }}>{decided}d</div>
      ) : (
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <button onClick={() => decide('approve')}>Approve</button>
          <button onClick={() => decide('deny')}>Deny</button>
        </div>
      )}
    </div>
  )
}
```

`StatusChangeEvent.tsx`:

```tsx
import type { AgentEvent } from '@legion/core'

export default function StatusChangeEvent({ event }: { event: AgentEvent }) {
  const p = event.payload as { status?: string }
  return (
    <div style={{ padding: 4, fontSize: 11, color: '#666', fontStyle: 'italic' }}>
      → {p.status ?? '?'}
    </div>
  )
}
```

- [ ] **Step 2: EventsTab で集約描画**

`packages/web/src/components/sidebar-tabs/EventsTab.tsx`:

```tsx
import type { AgentEvent } from '@legion/core'
import MessageEvent from '../event-renderers/MessageEvent'
import ToolCallEvent from '../event-renderers/ToolCallEvent'
import PermissionRequestEvent from '../event-renderers/PermissionRequestEvent'
import StatusChangeEvent from '../event-renderers/StatusChangeEvent'

export default function EventsTab(props: { events: AgentEvent[]; instanceId: string }) {
  return (
    <div>
      {props.events.map((e) => {
        if (e.type === 'message') return <MessageEvent key={e.id} event={e} />
        if (e.type === 'tool_call') return <ToolCallEvent key={e.id} event={e} />
        if (e.type === 'permission_request')
          return <PermissionRequestEvent key={e.id} event={e} instanceId={props.instanceId} />
        if (e.type === 'status_change') return <StatusChangeEvent key={e.id} event={e} />
        return null
      })}
    </div>
  )
}
```

`SidebarTabs.tsx` で `{tab === 'Events' && <EventsTab ... />}` に置換。

- [ ] **Step 3: PermissionRequestEvent のテスト**

`packages/web/test/components/event-renderers/PermissionRequestEvent.test.tsx`:

```tsx
import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { render, fireEvent } from '@testing-library/react'
import PermissionRequestEvent from '../../../src/components/event-renderers/PermissionRequestEvent'

let capturedFetchArgs: any[] = []

beforeEach(() => {
  capturedFetchArgs = []
  globalThis.fetch = mock((url: string, init: any) => {
    capturedFetchArgs.push({ url, init })
    return Promise.resolve(new Response(null, { status: 204 }))
  }) as any
})

describe('PermissionRequestEvent', () => {
  test('renders Approve and Deny buttons', () => {
    const { getByText } = render(
      <PermissionRequestEvent
        instanceId="inst-1"
        event={{
          id: 'e1',
          sessionId: 's1',
          type: 'permission_request',
          payload: { approvalId: 'a1', tool: 'Edit', input: { path: '/x' } },
          timestamp: new Date(),
        }}
      />,
    )
    expect(getByText('Approve')).toBeDefined()
    expect(getByText('Deny')).toBeDefined()
  })

  test('clicking Approve POSTs to approval endpoint with decision=approve', async () => {
    const { getByText } = render(
      <PermissionRequestEvent
        instanceId="inst-1"
        event={{
          id: 'e1',
          sessionId: 's1',
          type: 'permission_request',
          payload: { approvalId: 'a1', tool: 'Edit', input: {} },
          timestamp: new Date(),
        }}
      />,
    )
    fireEvent.click(getByText('Approve'))
    await new Promise((r) => setTimeout(r, 5))
    expect(capturedFetchArgs).toHaveLength(1)
    expect(capturedFetchArgs[0].url).toBe('/instances/inst-1/approvals/a1')
    const body = JSON.parse(capturedFetchArgs[0].init.body)
    expect(body.decision).toBe('approve')
  })
})
```

- [ ] **Step 4: テスト成功確認**

```bash
bun test packages/web/test/components/event-renderers/PermissionRequestEvent.test.tsx
```

期待: 2 tests passed。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/sidebar-tabs/EventsTab.tsx packages/web/src/components/event-renderers/ packages/web/src/components/SidebarTabs.tsx packages/web/test/components/event-renderers/
git commit -m "feat(web): structured event renderers and Events tab"
```

---

## Task 9: Diff tab

選択中 Agent (Phase 1 では選択された Role node を持つ唯一の Agent Instance) の worktree diff を表示する。Phase 1 では server 側に diff endpoint が無いので、本 task で `/instances/:id/diff` を server に追加する必要がある。

**Note:** server 側に diff endpoint を a03 の追加 task として実装するべきだが、a03 はすでに完了想定。**a04 内で server 側にも変更を入れる** が、本来は a03 の補遺。「Phase 1 を動かす」ために便宜的に a04 でカバー。

**Files (server 側追加):**
- Modify: `packages/server/src/http/routes.ts`
- Create: `packages/server/src/http/handlers/diff.ts`
- Modify: `packages/runtime/src/orchestrator/instance-store.ts` (worktree path を返す getter を追加)

**Files (web 側追加):**
- Create: `packages/web/src/components/sidebar-tabs/DiffTab.tsx`
- Modify: `packages/web/src/components/SidebarTabs.tsx`

- [ ] **Step 1: server に diff endpoint を追加**

`packages/server/src/http/handlers/diff.ts`:

```ts
import type { AppRuntime } from '../../app'
import { $ } from 'bun'

export async function handleInstanceDiff(
  instanceId: string,
  ctx: AppRuntime,
): Promise<Response> {
  const list = await ctx.worktree.list(instanceId)
  const out: Array<{ agentPath: string; branch: string | null; diff: string }> = []
  for (const w of list) {
    const branch = (w.ref as { branch?: string }).branch ?? null
    if (!branch) {
      out.push({ agentPath: w.path, branch: null, diff: '' })
      continue
    }
    const inst = ctx.store.get(instanceId)
    if (!inst) return new Response('Not Found', { status: 404 })
    const diffOut = await $`git diff ${'main'}..${branch}`.cwd(ctx.options.repoPath).quiet().nothrow().text()
    out.push({ agentPath: w.path, branch, diff: diffOut })
  }
  return Response.json(out)
}
```

`routes.ts`:

```ts
const d = path.match(/^\/instances\/([^/]+)\/diff$/)
if (d) return handleInstanceDiff(d[1]!, ctx)
```

- [ ] **Step 2: web 側 DiffTab**

`packages/web/src/components/sidebar-tabs/DiffTab.tsx`:

```tsx
import { useEffect, useState } from 'react'

interface DiffEntry {
  agentPath: string
  branch: string | null
  diff: string
}

export default function DiffTab({ instanceId }: { instanceId: string }) {
  const [items, setItems] = useState<DiffEntry[] | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let alive = true
    fetch(`/instances/${encodeURIComponent(instanceId)}/diff`)
      .then((r) => r.json())
      .then((d) => alive && setItems(d))
      .catch(() => alive && setItems([]))
    return () => {
      alive = false
    }
  }, [instanceId])

  if (!items) return <div>Loading…</div>
  if (items.length === 0) return <div>No worktrees yet.</div>
  return (
    <div>
      {items.map((d) => (
        <div key={d.agentPath} style={{ marginBottom: 12 }}>
          <button
            onClick={() => setOpen((o) => ({ ...o, [d.agentPath]: !o[d.agentPath] }))}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {open[d.agentPath] ? '▼' : '▶'} {d.branch ?? '(detached)'}
          </button>
          {open[d.agentPath] && (
            <pre style={{ fontSize: 11, background: '#1e1e1e', color: '#ddd', padding: 8, overflow: 'auto' }}>
              {d.diff || '(no changes)'}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}
```

`SidebarTabs.tsx`: `{tab === 'Diff' && <DiffTab instanceId={props.instanceId} />}`

- [ ] **Step 3: typecheck**

```bash
bun run typecheck
```

- [ ] **Step 4: 簡単な動作確認**

server + web を起動して trigger → diff tab を確認。

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/http/handlers/diff.ts packages/server/src/http/routes.ts packages/web/src/components/sidebar-tabs/DiffTab.tsx packages/web/src/components/SidebarTabs.tsx
git commit -m "feat: diff endpoint + DiffTab"
```

---

## Task 10: Tasks tab (Phase 1 簡易)

Phase 1 では `AgentInstance.tasks` は orchestrator が埋めていない (Director-Worker 連携が Phase 2 のため)。プレースホルダ表示で OK。後の Phase で本物のデータを描画する。

**Files:**
- Create: `packages/web/src/components/sidebar-tabs/TasksTab.tsx`
- Modify: `packages/web/src/components/SidebarTabs.tsx`

- [ ] **Step 1: 実装**

```tsx
export default function TasksTab() {
  return (
    <div style={{ color: '#666', fontStyle: 'italic' }}>
      Tasks DAG は Director-Worker 連携 (Phase 2) で表示されます。
    </div>
  )
}
```

`SidebarTabs.tsx`: `{tab === 'Tasks' && <TasksTab />}`

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/sidebar-tabs/TasksTab.tsx packages/web/src/components/SidebarTabs.tsx
git commit -m "feat(web): Tasks tab placeholder for Phase 2"
```

---

## Task 11: API client の最小テスト

mock fetch で client の URL / body 形が崩れないことを保証。

**Files:**
- Create: `packages/web/test/api/client.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { triggerWorkflow, resolveApproval } from '../../src/api/client'

let captured: any[] = []

beforeEach(() => {
  captured = []
  globalThis.fetch = mock((url: string, init: any) => {
    captured.push({ url, init })
    return Promise.resolve(new Response(JSON.stringify({ workflowInstanceId: 'x' }), { status: 200 }))
  }) as any
})

describe('triggerWorkflow', () => {
  test('POSTs to /workflows/trigger with templateId and userPrompt', async () => {
    await triggerWorkflow('feature-implementation', 'do thing')
    expect(captured[0].url).toBe('/workflows/trigger')
    expect(captured[0].init.method).toBe('POST')
    expect(JSON.parse(captured[0].init.body)).toEqual({
      templateId: 'feature-implementation',
      userPrompt: 'do thing',
    })
  })
})

describe('resolveApproval', () => {
  test('POSTs decision=approve to the right URL', async () => {
    globalThis.fetch = mock((url: string, init: any) => {
      captured.push({ url, init })
      return Promise.resolve(new Response(null, { status: 204 }))
    }) as any
    await resolveApproval('inst-1', 'app-1', 'approve')
    expect(captured[0].url).toBe('/instances/inst-1/approvals/app-1')
    expect(JSON.parse(captured[0].init.body)).toEqual({ decision: 'approve' })
  })
})
```

- [ ] **Step 2: テスト成功確認**

```bash
bun test packages/web/test/api/client.test.ts
```

期待: 2 tests passed。

- [ ] **Step 3: Commit**

```bash
git add packages/web/test/api/client.test.ts
git commit -m "test(web): API client fetch shape coverage"
```

---

## Task 12: Manual smoke (server + web を実起動して目視確認)

- [ ] **Step 1: server を起動**

```bash
bun run --filter @legion/server start &
```

- [ ] **Step 2: web の dev サーバを起動**

```bash
bun run --filter @legion/web dev &
```

- [ ] **Step 3: ブラウザで http://localhost:5173 を開く**

確認項目:
- `/instances` が空のグリッドを表示
- 適当な template を trigger (`curl POST /workflows/trigger`) する
- `/instances` にカードが現れる
- カードクリック → `/instances/:id` の 3-panel が出る
- Canvas に Layer 1 の node graph が見える
- 右 sidebar の Overview / Events / Diff / Tasks がタブで切替可能
- Events タブに live event が流れる (WebSocket 経由)
- permission request が出たら Approve / Deny で resolve できる
- 下部 event log にも逐次ログが出る

- [ ] **Step 4: server / web を停止**

```bash
kill %1 %2
```

このタスクには commit は無し。

---

## 完了条件

- [ ] `bun run --filter @legion/web typecheck` パス
- [ ] `bun test --filter @legion/web` (InstanceCard 2 + PermissionRequestEvent 2 + client 2 = 6 cases) 緑
- [ ] manual smoke で a03 server と組み合わせた挙動が確認できる
- [ ] 全 5 ルートに到達でき、Track A 系画面の Phase 1 機能が動く

## 次の計画

[b01 Web UI Track B](2026-05-13_phase1_b01_web_template.md) に進む。b01 は Track A 完了後の最終ステップで、`/templates` 一覧と `/templates/:id` の静的 Layer 1 canvas mockup を仕上げる。

---

## 実測との突合 (実装完了後に記入)

実測コマンド例:

```bash
wc -l packages/web/src/**/*.{ts,tsx} \
     packages/web/test/**/*.{ts,tsx} \
     packages/server/src/http/handlers/diff.ts
```

突合表 (実装着手者が埋める):

| ファイル | 予測 | 実測 | 差 (±%) | 上限超過? |
| --- | ---: | ---: | ---: | --- |
| (実装後に記入) | | | | |

差が ±30% を超えた項目について原因を残す。
