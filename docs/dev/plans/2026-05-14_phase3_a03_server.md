# Phase 3 a03: Server Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 3 で runtime に入った Blackboard を server レイヤから露出する。`GET /api/instances/:id` レスポンスに `blackboardMessages` を含める。`/ws` の event-stream で `blackboard.message` 種別を broadcast する。Reviewer の decision を InstanceDetail から (Blackboard 経由で) 取り出せる状態にする。

**Architecture:** server boot で `BlackboardStore` を `ctx` に追加 (`ctx.blackboardStore`)。`DelegateToolHandler` 構築時に注入 (a01 で deps に追加済み)。route handler が `ctx.blackboardStore.listByWorkflow(id)` を呼んでレスポンスに含める。runtime → Blackboard publish が起きるたびに WS hub に `blackboard.message` event を流す。

**Tech Stack:** Bun runtime, Hono (既存 server framework)、Bun built-in WebSocket、`bun:test`、`bun:sqlite`。

**Spec reference:** [docs/dev/specs/2026-05-14_phase3_design.md](../specs/2026-05-14_phase3_design.md) § 8.4。

**Depends on:** [a01 runtime core plan](2026-05-14_phase3_a01_runtime.md) (BlackboardStore + DelegateToolHandler auto-publish)、[a02 Codex provider plan](2026-05-14_phase3_a02_codex_provider.md) (`ctx.providersByName`)。

---

## File Structure

### Modify

| Path | Change |
| --- | --- |
| `packages/server/src/app.ts` | `BlackboardStore` を `ctx` に追加、`startApp` で初期化 |
| `packages/server/src/routes/instances.ts` | `GET /api/instances/:id` レスポンスに `blackboardMessages` フィールド追加 |
| `packages/server/src/ws/event-stream.ts` | `blackboard.message` event 種別を broadcast に追加 |
| `packages/runtime/src/orchestrator/delegate-tool.ts` | Blackboard publish 後に WS broadcast 通知を発火 (callback / event emitter 経由) |
| `packages/server/test/routes/instances.test.ts` | `blackboardMessages` レスポンス test |
| `packages/server/test/ws/event-stream.test.ts` | `blackboard.message` broadcast test |

### Create (optional)

| Path | Responsibility |
| --- | --- |
| `packages/server/src/blackboard-notifier.ts` | Blackboard publish イベントを WS hub に流す薄いリスナー (新規が冗長なら app.ts 内に直書きでも可) |

---

## Pre-flight

- [ ] **a01 + a02 完了を確認**

```bash
git log --oneline -15
```

期待: a01 の 10 タスク commit + a02 の 8 タスク commit がそろっている。

- [ ] **全 test green**

```bash
bun run test
```

期待: a02 完了後の baseline (おおむね 200 pass / 2 skip / 0 fail)。

- [ ] **typecheck**

```bash
bun run typecheck
```

期待: green。

---

## Task 1: `BlackboardStore` を server `ctx` に追加

**Files:**
- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: 既存 `app.ts` の `ctx` 構築箇所を確認**

```bash
grep -n "ctx" packages/server/src/app.ts | head -20
```

期待: `ctx: { db, instanceStore, agentInstanceStore, providersByName, ... }` の構築コードが見える (a02 完了後)。

- [ ] **Step 2: `BlackboardStore` のインポートと初期化を追加**

```typescript
import { BlackboardStore } from '@legion/runtime/store/blackboard-store'

// startApp 内、agentInstanceStore.initSchema() の直後あたり:
const blackboardStore = new BlackboardStore(db)
blackboardStore.initSchema()

// ctx 構築:
const ctx = {
  // ... existing
  blackboardStore,
}
```

- [ ] **Step 3: `ctx` 型に `blackboardStore: BlackboardStore` を追加 (TypeScript 推論で十分なら省略可)**

`packages/server/src/types.ts` (もしあれば) または `app.ts` 内の `ctx` 型を更新。

- [ ] **Step 4: typecheck**

```bash
bun run typecheck
```

期待: green。

- [ ] **Step 5: 既存 server test が壊れていないことを確認**

```bash
bun run test packages/server/test
```

期待: 既存 test 全 pass。

- [ ] **Step 6: commit**

```bash
git add packages/server/src/app.ts
git commit -m "feat(server): wire BlackboardStore into app context"
```

---

## Task 2: `GET /api/instances/:id` レスポンスに `blackboardMessages` を含める

**Files:**
- Modify: `packages/server/src/routes/instances.ts`
- Modify: `packages/server/test/routes/instances.test.ts`

- [ ] **Step 1: 既存 `instances.ts` route handler の現状を確認**

```bash
cat packages/server/src/routes/instances.ts | head -80
```

期待: `app.get('/api/instances/:id', ...)` ハンドラが `instance + agentInstances` を返している (Phase 2 narrow 完了形)。

- [ ] **Step 2: failing test を追加**

`packages/server/test/routes/instances.test.ts` に追加:

```typescript
import { describe, it, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { ulid } from 'ulid'
import { createTestApp } from '../helpers/test-app'  // 既存 helper を想定

describe('GET /api/instances/:id (Phase 3: blackboardMessages)', () => {
  let app: ReturnType<typeof createTestApp>
  let db: Database
  let wfId: string

  beforeEach(() => {
    ;({ app, db } = createTestApp())
    wfId = ulid()
    db.run('INSERT INTO workflow_instances (id, status, template_id, base_commit_sha) VALUES (?, ?, ?, ?)',
      [wfId, 'running', 'tmpl-1', 'sha'])
  })

  it('returns blackboardMessages array (empty when nothing published)', async () => {
    const res = await app.request(`/api/instances/${wfId}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.blackboardMessages).toEqual([])
  })

  it('returns blackboardMessages ordered by published_at', async () => {
    db.run(`INSERT INTO blackboard_messages (id, workflow_instance_id, topic, publisher_agent_id, payload, published_at)
            VALUES (?, ?, ?, NULL, ?, ?)`,
      [ulid(), wfId, 'system.delegate.start', JSON.stringify({ role: 'implementer' }), 1000])
    db.run(`INSERT INTO blackboard_messages (id, workflow_instance_id, topic, publisher_agent_id, payload, published_at)
            VALUES (?, ?, ?, NULL, ?, ?)`,
      [ulid(), wfId, 'system.review.decision', JSON.stringify({ decision: 'approve' }), 2000])

    const res = await app.request(`/api/instances/${wfId}`)
    const body = await res.json()
    expect(body.blackboardMessages).toHaveLength(2)
    expect(body.blackboardMessages[0].topic).toBe('system.delegate.start')
    expect(body.blackboardMessages[1].topic).toBe('system.review.decision')
    expect(body.blackboardMessages[1].payload).toEqual({ decision: 'approve' })
  })

  it('honors ?topicPrefix=system. filter (query parameter)', async () => {
    db.run(`INSERT INTO blackboard_messages (id, workflow_instance_id, topic, publisher_agent_id, payload, published_at)
            VALUES (?, ?, ?, NULL, ?, ?)`,
      [ulid(), wfId, 'system.delegate.start', JSON.stringify({}), 1000])
    db.run(`INSERT INTO blackboard_messages (id, workflow_instance_id, topic, publisher_agent_id, payload, published_at)
            VALUES (?, ?, ?, NULL, ?, ?)`,
      [ulid(), wfId, 'user.foo', JSON.stringify({}), 2000])

    const res = await app.request(`/api/instances/${wfId}?topicPrefix=system.`)
    const body = await res.json()
    expect(body.blackboardMessages.map((m: any) => m.topic)).toEqual(['system.delegate.start'])
  })
})
```

- [ ] **Step 3: test 実行で失敗を確認**

```bash
bun run test packages/server/test/routes/instances.test.ts
```

期待: `blackboardMessages` フィールドが undefined で FAIL。

- [ ] **Step 4: `instances.ts` route handler を改修**

```typescript
app.get('/api/instances/:id', (c) => {
  const id = c.req.param('id')
  const topicPrefix = c.req.query('topicPrefix')
  const limit = parseInt(c.req.query('limit') ?? '200', 10)

  const instance = ctx.instanceStore.get(id)
  if (!instance) return c.json({ error: 'not found' }, 404)

  const agentInstances = ctx.agentInstanceStore.listByWorkflow(id)
  let blackboardMessages = ctx.blackboardStore.listByWorkflow(id, { limit })
  if (topicPrefix) {
    blackboardMessages = blackboardMessages.filter((m) => m.topic.startsWith(topicPrefix))
  }

  return c.json({
    ...instance,
    agentInstances,
    blackboardMessages,
  })
})
```

(`topicPrefix` filter は `BlackboardStore.listByWorkflow` の `topic` パラメータが完全一致しか取らない場合の workaround として route 層で適用する。完全一致でよければ store に渡してもよい。)

- [ ] **Step 5: test 実行で pass を確認**

```bash
bun run test packages/server/test/routes/instances.test.ts
```

期待: 3 件全 pass。

- [ ] **Step 6: commit**

```bash
git add packages/server/src/routes/instances.ts \
        packages/server/test/routes/instances.test.ts
git commit -m "feat(server): include blackboardMessages in GET /api/instances/:id"
```

---

## Task 3: WS `blackboard.message` event broadcast

**Files:**
- Modify: `packages/runtime/src/orchestrator/delegate-tool.ts`
- Modify: `packages/server/src/ws/event-stream.ts`
- Modify: `packages/server/test/ws/event-stream.test.ts`
- Modify: `packages/server/src/app.ts` (notifier 配線)

Phase 2 narrow の event-stream は `agent_event` 種別を broadcast する形になっているはず。`blackboard.message` も同じ hub に流す。

- [ ] **Step 1: 既存 `event-stream.ts` の broadcast pattern を確認**

```bash
cat packages/server/src/ws/event-stream.ts | head -60
```

期待: WS hub (Subscription manager) と `broadcast(workflowInstanceId, event)` 関数がある。

- [ ] **Step 2: failing test を追加 (`event-stream.test.ts`)**

```typescript
it('broadcasts blackboard.message event when a new BlackboardMessage is inserted (Phase 3)', async () => {
  const { hub, ctx } = setupHub()
  const received: any[] = []
  hub.subscribe('wf-1', (ev) => received.push(ev))

  // act: blackboard に insert + notifier 発火
  const msg = {
    id: ulid(),
    workflowInstanceId: 'wf-1',
    topic: 'system.delegate.start',
    publisherAgentId: null,
    payload: { role: 'reviewer' },
    publishedAt: 12345,
  }
  ctx.blackboardStore.insert(msg)
  ctx.blackboardNotifier.notify(msg)  // 新規 notifier API

  // assert
  await flushMicrotasks()
  expect(received).toHaveLength(1)
  expect(received[0]).toMatchObject({
    type: 'blackboard.message',
    workflowInstanceId: 'wf-1',
    payload: { topic: 'system.delegate.start', publisherAgentId: null, decisionPayload: { role: 'reviewer' } },
  })
})
```

(具体 API 名は実装と合わせて調整。`flushMicrotasks` は test helper として `await Promise.resolve()` 数回でもよい。)

- [ ] **Step 3: test 実行で失敗を確認**

```bash
bun run test packages/server/test/ws/event-stream.test.ts
```

期待: `blackboardNotifier` が存在しないか、event が broadcast されず FAIL。

- [ ] **Step 4: notifier (新規) を作るか、event-stream 内に統合**

選択肢:

- (a) 新規ファイル `packages/server/src/blackboard-notifier.ts` を作り、`BlackboardStore` の wrapper にする。`insert()` 時に hub.broadcast を呼ぶ。
- (b) `BlackboardStore` 自体に `EventEmitter` を持たせて `event-stream.ts` から購読。
- (c) `DelegateToolHandler` の Blackboard publish 時に hub に直接 broadcast (server 側に runtime が依存する向きが逆だが、callback 注入で逆にできる)。

**推奨は (c)**: `DelegateToolHandler.deps` に optional な `onBlackboardPublish?: (msg: BlackboardMessage) => void` を足す。server 側で hub への broadcast 関数を inject。store 自体は pure に保つ。

`packages/runtime/src/orchestrator/delegate-tool.ts`:

```typescript
class DelegateToolHandler {
  constructor(private deps: {
    // ... existing
    onBlackboardPublish?: (msg: BlackboardMessage) => void
  }) {}

  // handle() 内の 3 箇所 (start/result/decision) の insert 直後に:
  private publishBlackboard(msg: BlackboardMessage): void {
    this.deps.blackboardStore.insert(msg)
    this.deps.onBlackboardPublish?.(msg)
  }
}
```

`a01 Task 9` で書いた 3 箇所の `blackboardStore.insert(...)` を全部 `publishBlackboard(...)` 経由に変える。

- [ ] **Step 5: server 側 `app.ts` で callback を inject**

```typescript
// trigger.ts での DelegateToolHandler 構築箇所で:
const handler = new DelegateToolHandler({
  // ... existing
  onBlackboardPublish: (msg) => {
    hub.broadcast(msg.workflowInstanceId, {
      type: 'blackboard.message',
      workflowInstanceId: msg.workflowInstanceId,
      payload: {
        id: msg.id,
        topic: msg.topic,
        publisherAgentId: msg.publisherAgentId,
        payload: msg.payload,
        publishedAt: msg.publishedAt,
      },
    })
  },
})
```

(配線箇所は実装次第。`packages/runtime/src/orchestrator/trigger.ts` が DelegateToolHandler を生成する場合は、trigger.ts に hub 引き渡しが必要。server boot 時に hub と blackboardStore を組み合わせた notifier closure を作って ctx に置き、trigger.ts はそれを `deps` に詰めるのが自然。)

- [ ] **Step 6: test 実行で pass を確認**

```bash
bun run test packages/server/test/ws/event-stream.test.ts
bun run test packages/runtime/test/orchestrator/delegate-tool.test.ts
```

期待: 両方 green。a01 で書いた DelegateToolHandler の Blackboard test も引き続き green。

- [ ] **Step 7: commit**

```bash
git add packages/runtime/src/orchestrator/delegate-tool.ts \
        packages/server/src/app.ts \
        packages/server/src/ws/event-stream.ts \
        packages/server/test/ws/event-stream.test.ts
git commit -m "feat(server): broadcast blackboard.message events via WS hub"
```

---

## Task 4: 全体 verification

- [ ] **Step 1: full typecheck**

```bash
bun run typecheck
```

期待: 全 5 パッケージ green。

- [ ] **Step 2: full test suite**

```bash
bun run test
```

期待: a02 baseline + ~6 件 (instances 3 + ws 1 + あれば追加) で 0 fail。

- [ ] **Step 3: 既存 Phase 2 real-SDK delegate-flow が引き続き green (auth ありなら)**

```bash
# Windows
$env:CLAUDE_CODE_OAUTH_TOKEN = "sk-ant-oat01-..."; bun run test packages/runtime/test/integration/delegate-flow.integration.test.ts
```

期待: 38.7s で green。Phase 3 で server 側の API を拡張したが、Implementer delegate path の挙動は壊れていない。

---

## Done criteria

a03 完了時点で:

- `GET /api/instances/:id` レスポンスに `blackboardMessages` フィールドが含まれる (空 array でも OK)
- `?topicPrefix=` クエリ filter が動く
- WS に `blackboard.message` event 種別が broadcast される
- `bun run test`: green、~6 件追加
- `bun run typecheck`: green
- 既存 Phase 2 delegate-flow integration test が auth ありで green (regression なし)

次の a04 では web UI を Blackboard タブ・Overview の decision 表示・EventLogPane の Blackboard 重畳に拡張する。a03 でデータ経路が揃っているので a04 は表示層に集中できる。
