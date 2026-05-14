# Phase 3 a01: Runtime Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 3 の runtime core を実装する。`DelegateToolOutput` の Reviewer 用フィールド追加、`blackboard_messages` SQLite store、`template-validate`、graph-walker への `reviews` エッジ認識、`role-profile` 拡張、`WorkspaceCreateInput.reviewTargetBranch`、`DelegateToolHandler` の Reviewer 分岐 + outputSchema + Blackboard auto-publish までを runtime 内に完結させる。Codex provider 本体は a02、web/server は a03/a04、E2E test は a06。

**Architecture:** Implementer が `delegate(role='reviewer', ...)` を自己 delegate すると、`DelegateToolHandler` が caller の branch を `agent_instances` から引き、`reviewTargetBranch` 付きで worktree を `--detach` で切り、target ノードの `provider` フィールドに応じて (Claude / Codex) を選んで spawn する。Reviewer の最終 assistant message は `outputSchema` で構造化された JSON で、これを parse して `{decision, feedback, notes}` を tool_result として Implementer に返す。並行して delegate start/result/decision を `blackboard_messages` に auto-publish する。

**Tech Stack:** TypeScript, Bun runtime, Bun's built-in test runner (`bun:test`), Bun's built-in SQLite (`bun:sqlite`), `ulid` for IDs. Codex SDK 自体は a02 で導入するので a01 は触らない。

**Spec reference:** [docs/dev/specs/2026-05-14_phase3_design.md](../specs/2026-05-14_phase3_design.md) §§ 4, 6.1〜6.3, 7.5。

---

## File Structure

### Create

| Path | Responsibility |
| --- | --- |
| `packages/core/src/types/blackboard.ts` | `BlackboardMessage` 型 |
| `packages/runtime/src/store/blackboard-store.ts` | `BlackboardStore` (CRUD for `blackboard_messages` table) |
| `packages/runtime/src/orchestrator/template-validate.ts` | `validateTemplate()` (拒否ルール) |
| `packages/runtime/test/store/blackboard-store.test.ts` | Store unit tests (real SQLite, no mock) |
| `packages/runtime/test/orchestrator/template-validate.test.ts` | Validator unit tests (pure function, no mock) |

### Modify

| Path | Change |
| --- | --- |
| `packages/core/src/types/delegate.ts` | `DelegateToolOutput` に `decision?`, `feedback?` 追加 (Reviewer 用) |
| `packages/core/src/types/agent-provider.ts` | `LaunchRequest` に `outputSchema?: unknown` 追加 |
| `packages/core/src/types/workflow.ts` | edge type union に `'reviews'` 追加 (既に存在する可能性あり、要確認) |
| `packages/core/src/index.ts` | 新規 export を追加 |
| `packages/runtime/src/orchestrator/graph-walker.ts` | `resolveDelegateTargets` の戻り値に `edgeType` を追加し、`reviews` エッジも返す |
| `packages/runtime/src/adapter/role-profile.ts` | Implementer に `mcp__legion__delegate` + `mcp__legion__publish` を追加、Reviewer に `mcp__legion__publish` を追加 |
| `packages/runtime/src/workspace/provider.ts` | `WorkspaceCreateInput` に `reviewTargetBranch?: string` 追加 |
| `packages/runtime/src/workspace/local-worktree-provider.ts` | Reviewer 分岐で `reviewTargetBranch ?? baseCommitSha` を使う |
| `packages/runtime/src/orchestrator/delegate-tool.ts` | Reviewer 分岐 + `reviewTargetBranch` 解決 + `outputSchema` 注入 + decision JSON parse + Blackboard auto-publish |
| `packages/runtime/package.json` | 新規 subpath exports (`./store/blackboard-store`, `./orchestrator/template-validate`) |
| `packages/runtime/test/orchestrator/graph-walker.test.ts` | `resolveDelegateTargets` の `edgeType='reviews'` ケース追加 |
| `packages/runtime/test/adapter/role-profile.test.ts` | publish/delegate ツール追加の assertion |
| `packages/runtime/test/workspace/local-worktree-provider.test.ts` | `reviewTargetBranch` 分岐の test (要 real git in temp repo) |
| `packages/runtime/test/orchestrator/delegate-tool.test.ts` | Reviewer 分岐、decision parsing、Blackboard publish の test (mock provider) |

---

## Pre-flight

- [ ] **作業ツリーが clean であることを確認**

```bash
git status
```

期待: `nothing to commit, working tree clean`。dirty なら stash か resolve してから始める。

- [ ] **baseline test が green であることを確認**

```bash
bun run test
```

期待: `169 pass / 2 skip / 0 fail` (Phase 2 narrow 完了時のスナップショット)。違っていたら原因を調べてから着手する。

- [ ] **typecheck が green であることを確認**

```bash
bun run typecheck
```

期待: 全 5 パッケージで error なし。

---

## Task 1: Core types を拡張

**Files:**
- Modify: `packages/core/src/types/delegate.ts`
- Modify: `packages/core/src/types/agent-provider.ts`
- Modify: `packages/core/src/types/workflow.ts`
- Create: `packages/core/src/types/blackboard.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 既存の `delegate.ts` を読んで `DelegateToolOutput` の現状を確認**

```bash
cat packages/core/src/types/delegate.ts
```

期待: Phase 2 narrow で定義された `{ agentInstanceId, branchName, status, summary, error }` がある。

- [ ] **Step 2: `delegate.ts` を編集して Reviewer 用フィールドを追加**

`packages/core/src/types/delegate.ts`:

```typescript
// D-037, D-038, D-053: Director / Implementer の custom tool。
// Phase 3 で Reviewer 向け decision/feedback を追加 (D-050)。
// 同期 blocking で spawned agent の完了まで戻らない。

export interface DelegateToolInput {
  /** Role to spawn. Phase 3 は 'implementer' (Director→Implementer) と 'reviewer' (Implementer→Reviewer) を受理。 */
  role: string
  /** Self-contained prompt for the spawned agent. spawned agent は original user prompt を見ない。 */
  prompt: string
  /** Optional one-line rationale. event log にのみ書く。 */
  rationale?: string
}

export interface DelegateToolOutput {
  /** The spawned AgentInstance.id. */
  agentInstanceId: string
  /** Reviewer の場合: review 対象 branch (= caller の branch)。Implementer の場合: Implementer が commit した branch。 */
  branchName: string
  /** 'completed' = session ended normally; 'failed' = provider threw. */
  status: 'completed' | 'failed'
  /** Reviewer のみセット。outputSchema で構造化された JSON から抽出。 */
  decision?: 'approve' | 'request-changes' | 'reject'
  /** decision='request-changes' のときの修正指示。Reviewer のみセット。 */
  feedback?: string
  /** Last assistant message from the spawned agent, truncated to ~500 chars. Reviewer の場合は decision を含む raw JSON ではなく自由記述部分。 */
  summary: string
  /** status='failed' のときのみ。 */
  error?: string
}
```

- [ ] **Step 3: 既存の `agent-provider.ts` を読んで `LaunchRequest` の現状を確認**

```bash
cat packages/core/src/types/agent-provider.ts
```

期待: Phase 2 narrow で `mcpServers?` が追加された形がある。

- [ ] **Step 4: `agent-provider.ts` の `LaunchRequest` に `outputSchema?` を追加**

`LaunchRequest` interface 内に 1 フィールド追加:

```typescript
export interface LaunchRequest {
  // ... existing fields (workdir, role, initialPrompt, model?, env?, mcpServers?)
  /** Phase 3: provider が structured output をサポートする場合に渡す JSON Schema。 */
  outputSchema?: unknown
}
```

- [ ] **Step 5: 既存の `workflow.ts` を読んで edge type union を確認**

```bash
cat packages/core/src/types/workflow.ts | head -60
```

`edges[].type` の union が `'triggers' | 'delegates' | 'publishes' | 'subscribes' | 'reviews' | 'synthesizes'` を含むはず (D-015 の段階で定義済の可能性)。含まれていない場合のみ次のステップを実行する。

- [ ] **Step 6: 必要なら `workflow.ts` の edge type union に `'reviews'` を追加**

(D-015 で定義済なら no-op)

```typescript
export type EdgeType =
  | 'triggers'
  | 'delegates'
  | 'publishes'
  | 'subscribes'
  | 'reviews'        // ★ Phase 3 で runtime 実体化
  | 'synthesizes'
```

- [ ] **Step 7: `blackboard.ts` 新規ファイル作成**

`packages/core/src/types/blackboard.ts`:

```typescript
// Phase 3 (D-049): Blackboard auto-publish + agent publish ツール用の message 型。
// publishes エッジで宣言された topic (user-defined) と runtime auto-publish (system.*) の両方を表す。

export interface BlackboardMessage {
  /** ULID. */
  id: string
  /** 関連付けされた workflow instance。 */
  workflowInstanceId: string
  /** topic 名。system 系は 'system.' プレフィックス (system.delegate.start, system.delegate.result, system.review.decision)、ユーザー定義は任意文字列。 */
  topic: string
  /** publish した agent_instance.id。runtime auto-publish の場合 null。 */
  publisherAgentId: string | null
  /** JSON.parse 可能な任意の payload。 */
  payload: unknown
  /** UNIX epoch milliseconds。 */
  publishedAt: number
}
```

- [ ] **Step 8: `packages/core/src/index.ts` に新規 export を追加**

```typescript
// 既存 exports の末尾あたりに追加
export * from './types/blackboard'
```

`./types/delegate`, `./types/agent-provider`, `./types/workflow` は既存 export 経由で型拡張が反映される。

- [ ] **Step 9: typecheck を実行**

```bash
bun run typecheck
```

期待: green。`DelegateToolOutput`, `LaunchRequest.outputSchema`, `BlackboardMessage`, `EdgeType` の参照が解決する。

- [ ] **Step 10: commit**

```bash
git add packages/core/src/types/delegate.ts \
        packages/core/src/types/agent-provider.ts \
        packages/core/src/types/workflow.ts \
        packages/core/src/types/blackboard.ts \
        packages/core/src/index.ts
git commit -m "feat(core): add Phase 3 types (BlackboardMessage, decision/feedback, outputSchema)"
```

---

## Task 2: `BlackboardStore` 実装 (TDD, real SQLite)

**Files:**
- Create: `packages/runtime/test/store/blackboard-store.test.ts`
- Create: `packages/runtime/src/store/blackboard-store.ts`

**Mock policy note:** このタスクには mock を使わない (real SQLite in-memory)。CLAUDE.md "Test Policy" の規約適用なし。

- [ ] **Step 1: failing test を書く (insert + listByWorkflow)**

`packages/runtime/test/store/blackboard-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { ulid } from 'ulid'
import { BlackboardStore } from '../../src/store/blackboard-store'

function setupDb(): Database {
  const db = new Database(':memory:')
  // workflow_instances が FK 参照を要求する場合のスタブ
  db.run(`CREATE TABLE workflow_instances (id TEXT PRIMARY KEY)`)
  return db
}

describe('BlackboardStore', () => {
  let db: Database
  let store: BlackboardStore

  beforeEach(() => {
    db = setupDb()
    store = new BlackboardStore(db)
    store.initSchema()
  })

  it('insert + listByWorkflow returns inserted rows ordered by publishedAt', () => {
    const wfId = ulid()
    db.run('INSERT INTO workflow_instances (id) VALUES (?)', [wfId])

    const m1 = {
      id: ulid(),
      workflowInstanceId: wfId,
      topic: 'system.delegate.start',
      publisherAgentId: null,
      payload: { role: 'implementer' },
      publishedAt: 1000,
    }
    const m2 = {
      id: ulid(),
      workflowInstanceId: wfId,
      topic: 'user.foo',
      publisherAgentId: 'agent-1',
      payload: { value: 42 },
      publishedAt: 2000,
    }

    store.insert(m1)
    store.insert(m2)

    const rows = store.listByWorkflow(wfId)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ topic: 'system.delegate.start', publishedAt: 1000 })
    expect(rows[1]).toMatchObject({ topic: 'user.foo', publishedAt: 2000 })
    expect(rows[1].payload).toEqual({ value: 42 })
  })
})
```

- [ ] **Step 2: test 実行で失敗を確認**

```bash
bun run test packages/runtime/test/store/blackboard-store.test.ts
```

期待: FAIL with `Cannot find module '../../src/store/blackboard-store'`。

- [ ] **Step 3: BlackboardStore の最小実装**

`packages/runtime/src/store/blackboard-store.ts`:

```typescript
import type { Database } from 'bun:sqlite'
import type { BlackboardMessage } from '@legion/core'

export class BlackboardStore {
  constructor(private readonly db: Database) {}

  initSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS blackboard_messages (
        id                   TEXT PRIMARY KEY,
        workflow_instance_id TEXT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
        topic                TEXT NOT NULL,
        publisher_agent_id   TEXT,
        payload              TEXT NOT NULL,
        published_at         INTEGER NOT NULL
      )
    `)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_blackboard_workflow ON blackboard_messages(workflow_instance_id)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_blackboard_topic    ON blackboard_messages(workflow_instance_id, topic)`)
  }

  insert(msg: BlackboardMessage): void {
    this.db.run(
      `INSERT INTO blackboard_messages (id, workflow_instance_id, topic, publisher_agent_id, payload, published_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [msg.id, msg.workflowInstanceId, msg.topic, msg.publisherAgentId, JSON.stringify(msg.payload), msg.publishedAt],
    )
  }

  listByWorkflow(
    workflowInstanceId: string,
    opts: { topic?: string; afterSeq?: number; limit?: number } = {},
  ): BlackboardMessage[] {
    const { topic, limit = 1000 } = opts
    const sql = topic
      ? `SELECT id, workflow_instance_id, topic, publisher_agent_id, payload, published_at
         FROM blackboard_messages
         WHERE workflow_instance_id = ? AND topic = ?
         ORDER BY published_at ASC
         LIMIT ?`
      : `SELECT id, workflow_instance_id, topic, publisher_agent_id, payload, published_at
         FROM blackboard_messages
         WHERE workflow_instance_id = ?
         ORDER BY published_at ASC
         LIMIT ?`
    const params = topic ? [workflowInstanceId, topic, limit] : [workflowInstanceId, limit]
    const rows = this.db.query(sql).all(...params) as Array<{
      id: string
      workflow_instance_id: string
      topic: string
      publisher_agent_id: string | null
      payload: string
      published_at: number
    }>
    return rows.map((r) => ({
      id: r.id,
      workflowInstanceId: r.workflow_instance_id,
      topic: r.topic,
      publisherAgentId: r.publisher_agent_id,
      payload: JSON.parse(r.payload),
      publishedAt: r.published_at,
    }))
  }

  byId(id: string): BlackboardMessage | undefined {
    const row = this.db
      .query(
        `SELECT id, workflow_instance_id, topic, publisher_agent_id, payload, published_at
         FROM blackboard_messages WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string
          workflow_instance_id: string
          topic: string
          publisher_agent_id: string | null
          payload: string
          published_at: number
        }
      | undefined
    if (!row) return undefined
    return {
      id: row.id,
      workflowInstanceId: row.workflow_instance_id,
      topic: row.topic,
      publisherAgentId: row.publisher_agent_id,
      payload: JSON.parse(row.payload),
      publishedAt: row.published_at,
    }
  }
}
```

- [ ] **Step 4: test 実行で pass を確認**

```bash
bun run test packages/runtime/test/store/blackboard-store.test.ts
```

期待: 1 pass / 0 fail。

- [ ] **Step 5: topic filter / byId の test を追加**

`blackboard-store.test.ts` に追加:

```typescript
  it('listByWorkflow with topic filter returns only matching rows', () => {
    const wfId = ulid()
    db.run('INSERT INTO workflow_instances (id) VALUES (?)', [wfId])

    store.insert({ id: ulid(), workflowInstanceId: wfId, topic: 'system.delegate.start', publisherAgentId: null, payload: {}, publishedAt: 1000 })
    store.insert({ id: ulid(), workflowInstanceId: wfId, topic: 'user.foo', publisherAgentId: null, payload: {}, publishedAt: 2000 })
    store.insert({ id: ulid(), workflowInstanceId: wfId, topic: 'system.delegate.result', publisherAgentId: null, payload: {}, publishedAt: 3000 })

    const sys = store.listByWorkflow(wfId, { topic: 'system.delegate.start' })
    expect(sys).toHaveLength(1)
    expect(sys[0].topic).toBe('system.delegate.start')
  })

  it('byId returns the inserted row, or undefined for unknown id', () => {
    const wfId = ulid()
    db.run('INSERT INTO workflow_instances (id) VALUES (?)', [wfId])
    const id = ulid()
    store.insert({ id, workflowInstanceId: wfId, topic: 'x', publisherAgentId: null, payload: { ok: true }, publishedAt: 100 })

    expect(store.byId(id)?.payload).toEqual({ ok: true })
    expect(store.byId(ulid())).toBeUndefined()
  })

  it('CASCADE delete: removing workflow_instance row removes its blackboard rows', () => {
    const wfId = ulid()
    db.run('INSERT INTO workflow_instances (id) VALUES (?)', [wfId])
    store.insert({ id: ulid(), workflowInstanceId: wfId, topic: 'x', publisherAgentId: null, payload: {}, publishedAt: 1 })
    db.run('PRAGMA foreign_keys = ON')
    db.run('DELETE FROM workflow_instances WHERE id = ?', [wfId])
    expect(store.listByWorkflow(wfId)).toHaveLength(0)
  })
```

- [ ] **Step 6: 全 test 実行で pass を確認**

```bash
bun run test packages/runtime/test/store/blackboard-store.test.ts
```

期待: 4 pass / 0 fail。

- [ ] **Step 7: commit**

```bash
git add packages/runtime/src/store/blackboard-store.ts \
        packages/runtime/test/store/blackboard-store.test.ts
git commit -m "feat(runtime): add BlackboardStore with SQLite-backed CRUD"
```

---

## Task 3: `template-validate` 実装 (TDD, pure function)

**Files:**
- Create: `packages/runtime/test/orchestrator/template-validate.test.ts`
- Create: `packages/runtime/src/orchestrator/template-validate.ts`

**Mock policy note:** pure function なので mock 不要。

- [ ] **Step 1: failing test を書く (拒否ルール 4 件 + warn-only 1 件)**

`packages/runtime/test/orchestrator/template-validate.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { validateTemplate } from '../../src/orchestrator/template-validate'
import type { WorkflowTemplate } from '@legion/core'

const REGISTERED = new Set(['claude-code', 'codex'])

const baseNodes = [
  { id: 'trigger', type: 'trigger', kind: 'manual' },
  { id: 'director', type: 'role', role: 'director', provider: 'claude-code', lifetime: 'per-workflow' },
  { id: 'implementer', type: 'role', role: 'implementer', provider: 'claude-code', lifetime: 'per-task' },
  { id: 'reviewer', type: 'role', role: 'reviewer', provider: 'codex', lifetime: 'per-task' },
] as const

describe('validateTemplate', () => {
  it('accepts a valid Phase 3 template', () => {
    const tmpl: WorkflowTemplate = {
      id: 't',
      name: 't',
      description: '',
      nodes: [...baseNodes],
      edges: [
        { from: 'trigger', to: 'director', type: 'triggers' },
        { from: 'director', to: 'implementer', type: 'delegates' },
        { from: 'implementer', to: 'reviewer', type: 'reviews' },
      ],
    }
    const result = validateTemplate(tmpl, REGISTERED)
    expect(result.errors).toEqual([])
  })

  it('rejects role node without provider field', () => {
    const tmpl: WorkflowTemplate = {
      id: 't', name: 't', description: '',
      nodes: [
        { id: 'trigger', type: 'trigger', kind: 'manual' },
        { id: 'director', type: 'role', role: 'director', lifetime: 'per-workflow' } as any,
      ],
      edges: [{ from: 'trigger', to: 'director', type: 'triggers' }],
    }
    const result = validateTemplate(tmpl, REGISTERED)
    expect(result.errors.some((e) => e.includes('provider'))).toBe(true)
  })

  it('rejects unknown provider name', () => {
    const tmpl: WorkflowTemplate = {
      id: 't', name: 't', description: '',
      nodes: [
        { id: 'trigger', type: 'trigger', kind: 'manual' },
        { id: 'director', type: 'role', role: 'director', provider: 'gemini', lifetime: 'per-workflow' },
      ],
      edges: [{ from: 'trigger', to: 'director', type: 'triggers' }],
    }
    const result = validateTemplate(tmpl, REGISTERED)
    expect(result.errors.some((e) => e.includes('gemini'))).toBe(true)
  })

  it('rejects provider=codex on director or implementer role', () => {
    const tmpl: WorkflowTemplate = {
      id: 't', name: 't', description: '',
      nodes: [
        { id: 'trigger', type: 'trigger', kind: 'manual' },
        { id: 'director', type: 'role', role: 'director', provider: 'codex', lifetime: 'per-workflow' },
      ],
      edges: [{ from: 'trigger', to: 'director', type: 'triggers' }],
    }
    const result = validateTemplate(tmpl, REGISTERED)
    expect(result.errors.some((e) => e.includes('codex') && e.includes('director'))).toBe(true)
  })

  it('rejects reviews edge whose target is not a reviewer role', () => {
    const tmpl: WorkflowTemplate = {
      id: 't', name: 't', description: '',
      nodes: [...baseNodes],
      edges: [
        { from: 'trigger', to: 'director', type: 'triggers' },
        { from: 'director', to: 'implementer', type: 'delegates' },
        { from: 'implementer', to: 'implementer', type: 'reviews' },  // 自己 review (Phase 3 では不可)
      ],
    }
    const result = validateTemplate(tmpl, REGISTERED)
    expect(result.errors.some((e) => e.includes('reviews'))).toBe(true)
  })

  it('rejects publishes edge whose target is not a blackboard node', () => {
    const tmpl: WorkflowTemplate = {
      id: 't', name: 't', description: '',
      nodes: [...baseNodes],
      edges: [
        { from: 'trigger', to: 'director', type: 'triggers' },
        { from: 'reviewer', to: 'implementer', type: 'publishes' },  // target が role なので NG
      ],
    }
    const result = validateTemplate(tmpl, REGISTERED)
    expect(result.errors.some((e) => e.includes('publishes'))).toBe(true)
  })

  it('emits warning (not error) for subscribes / synthesizes edges', () => {
    const tmpl: WorkflowTemplate = {
      id: 't', name: 't', description: '',
      nodes: [
        ...baseNodes,
        { id: 'bb', type: 'blackboard', schema: {} },
      ] as any,
      edges: [
        { from: 'trigger', to: 'director', type: 'triggers' },
        { from: 'reviewer', to: 'bb', type: 'publishes' },
        { from: 'bb', to: 'implementer', type: 'subscribes' },
      ],
    }
    const result = validateTemplate(tmpl, REGISTERED)
    expect(result.errors).toEqual([])
    expect(result.warnings.some((w) => w.includes('subscribes'))).toBe(true)
  })
})
```

- [ ] **Step 2: test 実行で失敗を確認**

```bash
bun run test packages/runtime/test/orchestrator/template-validate.test.ts
```

期待: FAIL (`Cannot find module ...template-validate`)。

- [ ] **Step 3: `validateTemplate` 実装**

`packages/runtime/src/orchestrator/template-validate.ts`:

```typescript
import type { WorkflowTemplate, WorkflowNode } from '@legion/core'

export interface TemplateValidationResult {
  errors: string[]
  warnings: string[]
}

const DEFERRED_EDGE_TYPES = new Set(['subscribes', 'synthesizes'])

export function validateTemplate(
  template: WorkflowTemplate,
  registeredProviders: Set<string>,
): TemplateValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const nodesById = new Map(template.nodes.map((n) => [n.id, n]))

  for (const node of template.nodes) {
    if (node.type === 'role') {
      const provider = (node as { provider?: string }).provider
      if (!provider) {
        errors.push(`role node '${node.id}' must declare a 'provider' field`)
        continue
      }
      if (!registeredProviders.has(provider)) {
        errors.push(`role node '${node.id}' uses unknown provider '${provider}' (registered: ${[...registeredProviders].join(', ')})`)
      }
      const role = (node as { role?: string }).role
      if (provider === 'codex' && (role === 'director' || role === 'implementer')) {
        errors.push(`provider=codex is not allowed for role '${role}' (Phase 3 制約; codex は reviewer 専用)`)
      }
    }
  }

  for (const edge of template.edges) {
    if (edge.type === 'reviews') {
      const target = nodesById.get(edge.to)
      const targetRole = (target as { role?: string } | undefined)?.role
      if (targetRole !== 'reviewer') {
        errors.push(`reviews edge target '${edge.to}' must be a reviewer role node (got: ${targetRole ?? 'unknown'})`)
      }
    }
    if (edge.type === 'publishes') {
      const target = nodesById.get(edge.to)
      if ((target as WorkflowNode | undefined)?.type !== 'blackboard') {
        errors.push(`publishes edge target '${edge.to}' must be a blackboard node`)
      }
    }
    if (DEFERRED_EDGE_TYPES.has(edge.type)) {
      warnings.push(`edge type '${edge.type}' (${edge.from}→${edge.to}) is deferred to Phase 4 and will be ignored at runtime`)
    }
  }

  return { errors, warnings }
}
```

- [ ] **Step 4: test 実行で pass を確認**

```bash
bun run test packages/runtime/test/orchestrator/template-validate.test.ts
```

期待: 7 pass / 0 fail。

- [ ] **Step 5: commit**

```bash
git add packages/runtime/src/orchestrator/template-validate.ts \
        packages/runtime/test/orchestrator/template-validate.test.ts
git commit -m "feat(runtime): add validateTemplate for Phase 3 reject rules"
```

---

## Task 4: `graph-walker` の `reviews` エッジ認識

**Files:**
- Modify: `packages/runtime/src/orchestrator/graph-walker.ts`
- Modify: `packages/runtime/test/orchestrator/graph-walker.test.ts`

**Mock policy note:** pure function なので mock 不要。

- [ ] **Step 1: 既存実装を読む**

```bash
cat packages/runtime/src/orchestrator/graph-walker.ts
```

期待: `resolveDelegateTargets(template, fromRoleNodeId)` が `{ roleNodeId, roleName }[]` を返す Phase 2 実装。

- [ ] **Step 2: failing test を追加**

`packages/runtime/test/orchestrator/graph-walker.test.ts` の末尾に追加:

```typescript
describe('resolveDelegateTargets (Phase 3: reviews edge)', () => {
  it('returns edgeType=delegates for direct delegates edges (Phase 2 compat)', () => {
    const tmpl: WorkflowTemplate = {
      id: 't', name: 't', description: '',
      nodes: [
        { id: 'director', type: 'role', role: 'director', provider: 'claude-code', lifetime: 'per-workflow' },
        { id: 'implementer', type: 'role', role: 'implementer', provider: 'claude-code', lifetime: 'per-task' },
      ] as any,
      edges: [{ from: 'director', to: 'implementer', type: 'delegates' }],
    }
    const targets = resolveDelegateTargets(tmpl, 'director')
    expect(targets).toEqual([{ roleNodeId: 'implementer', roleName: 'implementer', edgeType: 'delegates' }])
  })

  it('returns edgeType=reviews for reviews edges', () => {
    const tmpl: WorkflowTemplate = {
      id: 't', name: 't', description: '',
      nodes: [
        { id: 'implementer', type: 'role', role: 'implementer', provider: 'claude-code', lifetime: 'per-task' },
        { id: 'reviewer', type: 'role', role: 'reviewer', provider: 'codex', lifetime: 'per-task' },
      ] as any,
      edges: [{ from: 'implementer', to: 'reviewer', type: 'reviews' }],
    }
    const targets = resolveDelegateTargets(tmpl, 'implementer')
    expect(targets).toEqual([{ roleNodeId: 'reviewer', roleName: 'reviewer', edgeType: 'reviews' }])
  })

  it('returns both delegates and reviews targets when both are defined', () => {
    const tmpl: WorkflowTemplate = {
      id: 't', name: 't', description: '',
      nodes: [
        { id: 'a', type: 'role', role: 'a', provider: 'claude-code', lifetime: 'per-task' },
        { id: 'b', type: 'role', role: 'b', provider: 'claude-code', lifetime: 'per-task' },
        { id: 'c', type: 'role', role: 'c', provider: 'codex', lifetime: 'per-task' },
      ] as any,
      edges: [
        { from: 'a', to: 'b', type: 'delegates' },
        { from: 'a', to: 'c', type: 'reviews' },
      ],
    }
    const targets = resolveDelegateTargets(tmpl, 'a')
    expect(targets).toHaveLength(2)
    expect(targets).toContainEqual({ roleNodeId: 'b', roleName: 'b', edgeType: 'delegates' })
    expect(targets).toContainEqual({ roleNodeId: 'c', roleName: 'c', edgeType: 'reviews' })
  })
})
```

import 文に `WorkflowTemplate` を追加。

- [ ] **Step 3: test 実行で失敗を確認 (型エラーまたは empty 結果)**

```bash
bun run test packages/runtime/test/orchestrator/graph-walker.test.ts
```

期待: FAIL (`edgeType` field missing or `reviews` edge ignored)。

- [ ] **Step 4: `graph-walker.ts` を編集**

`resolveDelegateTargets` の戻り値型と本体を改修:

```typescript
export interface DelegateTarget {
  roleNodeId: string
  roleName: string
  edgeType: 'delegates' | 'reviews'
}

export function resolveDelegateTargets(
  template: WorkflowTemplate,
  fromRoleNodeId: string,
): DelegateTarget[] {
  const out: DelegateTarget[] = []
  for (const edge of template.edges) {
    if (edge.from !== fromRoleNodeId) continue
    if (edge.type !== 'delegates' && edge.type !== 'reviews') continue
    const target = template.nodes.find((n) => n.id === edge.to)
    if (!target || target.type !== 'role') continue
    const roleName = (target as { role: string }).role
    out.push({ roleNodeId: edge.to, roleName, edgeType: edge.type })
  }
  return out
}
```

(既存呼び出し側 = `delegate-tool.ts` の signature 互換性は Task 7-9 で対応する。Task 4 単独では caller 側に `edgeType` 追加で type error が出るかもしれないが、Task 7 で同 PR 内に解決する想定。`bun run typecheck` が full pass する gate は Task 10。)

- [ ] **Step 5: test 実行で pass を確認**

```bash
bun run test packages/runtime/test/orchestrator/graph-walker.test.ts
```

期待: graph-walker test 全 pass。

- [ ] **Step 6: commit**

```bash
git add packages/runtime/src/orchestrator/graph-walker.ts \
        packages/runtime/test/orchestrator/graph-walker.test.ts
git commit -m "feat(runtime): resolveDelegateTargets recognizes reviews edges"
```

---

## Task 5: `role-profile` 拡張 (Implementer に delegate + publish、Reviewer に publish)

**Files:**
- Modify: `packages/runtime/src/adapter/role-profile.ts`
- Modify: `packages/runtime/test/adapter/role-profile.test.ts`

- [ ] **Step 1: 既存の `role-profile.ts` を読む**

```bash
cat packages/runtime/src/adapter/role-profile.ts
```

期待: Phase 2 narrow で `director: [...READ_TOOLS, 'mcp__legion__delegate']`、`implementer: [...EDIT_TOOLS, IMPLEMENTER_BASH_WHITELIST, 'Bash(git add*)', 'Bash(git commit*)', 'Bash(git status*)', 'Bash(git diff*)']`、`reviewer: READ_TOOLS` がある。

- [ ] **Step 2: failing test を更新**

`packages/runtime/test/adapter/role-profile.test.ts` に追加または既存 it を更新:

```typescript
it('director profile includes mcp__legion__delegate and mcp__legion__publish', () => {
  const tools = defaultAllowedToolsFor('director')
  expect(tools).toContain('mcp__legion__delegate')
  expect(tools).toContain('mcp__legion__publish')
})

it('implementer profile includes mcp__legion__delegate and mcp__legion__publish (Phase 3)', () => {
  const tools = defaultAllowedToolsFor('implementer')
  expect(tools).toContain('mcp__legion__delegate')
  expect(tools).toContain('mcp__legion__publish')
  // Phase 2 narrow で追加された Bash(git*) も維持
  expect(tools).toContain('Bash(git add*)')
  expect(tools).toContain('Bash(git commit*)')
})

it('reviewer profile is read-only plus mcp__legion__publish (no delegate)', () => {
  const tools = defaultAllowedToolsFor('reviewer')
  expect(tools).toContain('mcp__legion__publish')
  expect(tools).not.toContain('mcp__legion__delegate')
  expect(tools).not.toContain('Edit')
})
```

- [ ] **Step 3: test 実行で失敗を確認**

```bash
bun run test packages/runtime/test/adapter/role-profile.test.ts
```

期待: implementer の delegate / publish と reviewer の publish が含まれず FAIL。

- [ ] **Step 4: `role-profile.ts` を編集**

```typescript
const PROFILES: Record<string, readonly string[]> = {
  director: [...READ_TOOLS, 'mcp__legion__delegate', 'mcp__legion__publish'],
  implementer: [
    ...EDIT_TOOLS,
    ...IMPLEMENTER_BASH_WHITELIST,
    'Bash(git add*)',
    'Bash(git commit*)',
    'Bash(git status*)',
    'Bash(git diff*)',
    'mcp__legion__delegate',   // Phase 3: 自己 delegate (role='reviewer' のみ runtime で制限)
    'mcp__legion__publish',    // Phase 3: Blackboard publish
  ],
  reviewer: [
    ...READ_TOOLS,
    'mcp__legion__publish',    // Phase 3: Reviewer も publish 可能 (subscribe は Phase 4)
  ],
}
```

- [ ] **Step 5: test 実行で pass を確認**

```bash
bun run test packages/runtime/test/adapter/role-profile.test.ts
```

期待: 全 test pass。

- [ ] **Step 6: commit**

```bash
git add packages/runtime/src/adapter/role-profile.ts \
        packages/runtime/test/adapter/role-profile.test.ts
git commit -m "feat(runtime): extend role profiles for Phase 3 (delegate/publish)"
```

---

## Task 6: `WorkspaceCreateInput.reviewTargetBranch` と `LocalWorktreeProvider` 拡張

**Files:**
- Modify: `packages/runtime/src/workspace/provider.ts`
- Modify: `packages/runtime/src/workspace/local-worktree-provider.ts`
- Modify: `packages/runtime/test/workspace/local-worktree-provider.test.ts`

**Mock policy note:** `local-worktree-provider.test.ts` は real git in temp repo を使う既存 pattern を継続。`$` shell の mock は使わない (real subprocess で十分軽い)。

- [ ] **Step 1: 既存 `provider.ts` を読む**

```bash
cat packages/runtime/src/workspace/provider.ts
```

期待: `WorkspaceCreateInput { workflowInstanceId, agentInstanceId, role, seq, baseCommitSha }` がある。

- [ ] **Step 2: `provider.ts` の `WorkspaceCreateInput` に `reviewTargetBranch?` 追加**

```typescript
export interface WorkspaceCreateInput {
  workflowInstanceId: string
  agentInstanceId: string
  role: string
  seq: number
  baseCommitSha: string
  /** Phase 3 (D-052): role='reviewer' のとき、detach 先を baseCommitSha ではなくこの branch tip にする。 */
  reviewTargetBranch?: string
}
```

- [ ] **Step 3: 既存 `local-worktree-provider.test.ts` を読む**

```bash
cat packages/runtime/test/workspace/local-worktree-provider.test.ts | head -60
```

期待: temp repo を作って `create()` / `destroy()` を testing する pattern が既にある。

- [ ] **Step 4: failing test を追加 (reviewTargetBranch 分岐)**

`local-worktree-provider.test.ts` に追加:

```typescript
it('creates reviewer worktree detached at reviewTargetBranch when provided (Phase 3)', async () => {
  // setup: temp repo with two commits on a feature branch
  const repo = await makeTempRepo()
  await $`git -C ${repo.path} checkout -b feature/x`.quiet()
  await Bun.write(`${repo.path}/edit.txt`, 'change')
  await $`git -C ${repo.path} add -A`.quiet()
  await $`git -C ${repo.path} commit -m "feature change"`.quiet()
  const featureTip = (await $`git -C ${repo.path} rev-parse feature/x`.text()).trim()
  await $`git -C ${repo.path} checkout main`.quiet()
  const mainSha = (await $`git -C ${repo.path} rev-parse HEAD`.text()).trim()

  const provider = new LocalWorktreeProvider({ repoPath: repo.path, baseDir: repo.baseDir })

  const desc = await provider.create({
    workflowInstanceId: 'wf-1',
    agentInstanceId: 'agent-1',
    role: 'reviewer',
    seq: 1,
    baseCommitSha: mainSha,
    reviewTargetBranch: 'feature/x',
  })

  // worktree HEAD は feature/x の tip と一致するはず (baseCommitSha=main ではない)
  const head = (await $`git -C ${desc.path} rev-parse HEAD`.text()).trim()
  expect(head).toBe(featureTip)
  expect(head).not.toBe(mainSha)

  await provider.destroy(desc)
  await repo.cleanup()
})

it('falls back to baseCommitSha for reviewer when reviewTargetBranch is undefined (Phase 2 behavior)', async () => {
  const repo = await makeTempRepo()
  const baseSha = (await $`git -C ${repo.path} rev-parse HEAD`.text()).trim()
  const provider = new LocalWorktreeProvider({ repoPath: repo.path, baseDir: repo.baseDir })

  const desc = await provider.create({
    workflowInstanceId: 'wf-1',
    agentInstanceId: 'agent-1',
    role: 'reviewer',
    seq: 1,
    baseCommitSha: baseSha,
    // reviewTargetBranch を指定しない
  })

  const head = (await $`git -C ${desc.path} rev-parse HEAD`.text()).trim()
  expect(head).toBe(baseSha)

  await provider.destroy(desc)
  await repo.cleanup()
})
```

`makeTempRepo` は既存 fixture helper を流用する想定 (既存 test ファイル内に同等のものがあるはず)。

- [ ] **Step 5: test 実行で失敗を確認**

```bash
bun run test packages/runtime/test/workspace/local-worktree-provider.test.ts
```

期待: 1 つ目の test で featureTip ≠ mainSha だが provider は mainSha で detach するので FAIL。

- [ ] **Step 6: `local-worktree-provider.ts` を編集**

`DETACHED_ROLES` 分岐内の `commit` 決定を改修:

```typescript
if (DETACHED_ROLES.has(input.role)) {
  const target = input.reviewTargetBranch ?? input.baseCommitSha
  await worktreeAdd(this.opts.repoPath, {
    path,
    commit: target,
    detach: true,
  })
  return { ref: { kind: 'owned', path }, path }
}
```

- [ ] **Step 7: test 実行で pass を確認**

```bash
bun run test packages/runtime/test/workspace/local-worktree-provider.test.ts
```

期待: 全 test pass。

- [ ] **Step 8: commit**

```bash
git add packages/runtime/src/workspace/provider.ts \
        packages/runtime/src/workspace/local-worktree-provider.ts \
        packages/runtime/test/workspace/local-worktree-provider.test.ts
git commit -m "feat(runtime): reviewer worktree honors reviewTargetBranch (Concern #3)"
```

---

## Task 7: `DelegateToolHandler` — reviews エッジ + `reviewTargetBranch` 自動解決

**Files:**
- Modify: `packages/runtime/src/orchestrator/delegate-tool.ts`
- Modify: `packages/runtime/test/orchestrator/delegate-tool.test.ts`

**Mock policy note:** `DelegateToolHandler` の unit test は `AgentProvider` と `WorktreeManager` を mock する。Mock の **contract test は Phase 2 既存の `delegate-flow.integration.test.ts` と Phase 3 a06 の `delegate-flow-review.integration.test.ts`**。各 mock fixture には CLAUDE.md 規約の 4 項目ヘッダコメントを付ける。

- [ ] **Step 1: 既存 `delegate-tool.ts` を読む**

```bash
cat packages/runtime/src/orchestrator/delegate-tool.ts
```

Phase 2 narrow で `DelegateToolHandler.handle(input)` が role 検証 → `resolveDelegateTargets` → agent_instances INSERT → worktree create → provider.launch → drainstream → agent_instances UPDATE → return tool_result までを行う ~140 行の実装になっているはず。

- [ ] **Step 2: 既存 `delegate-tool.test.ts` を読み、mock fixture の形を確認**

```bash
cat packages/runtime/test/orchestrator/delegate-tool.test.ts | head -80
```

期待: `AgentProvider` を mock し、`launch()` が固定 `SessionHandle` を返し、`stream()` が固定 event 列を返す pattern。

- [ ] **Step 3: 既存 mock の冒頭に CLAUDE.md 規約のヘッダコメントを追加**

`delegate-tool.test.ts` の mock 定義部に追加:

```typescript
// Mock: AgentProvider for DelegateToolHandler unit tests
// representing:    @legion/core AgentProvider interface (legion internal protocol)
// verified on:     2026-05-14, by review of packages/core/src/types/agent-provider.ts
// invalidated when: AgentProvider interface adds new methods or changes capabilities shape
// contract test:   packages/runtime/test/integration/delegate-flow.integration.test.ts (Phase 2),
//                  packages/runtime/test/integration/delegate-flow-review.integration.test.ts (Phase 3 a06)
function createMockProvider(...): AgentProvider { /* existing impl */ }
```

```typescript
// Mock: WorktreeManager for DelegateToolHandler unit tests
// representing:    @legion/runtime WorktreeManager (legion internal class)
// verified on:     2026-05-14, by review of packages/runtime/src/workspace/local-worktree-provider.ts
// invalidated when: WorktreeManager.create() signature changes (esp. WorkspaceCreateInput shape)
// contract test:   packages/runtime/test/workspace/local-worktree-provider.test.ts (real git)
function createMockWorktreeManager(...) { /* existing impl */ }
```

- [ ] **Step 4: failing test を追加 (reviews edge + reviewTargetBranch 解決)**

```typescript
it('resolves reviewTargetBranch from caller agent_instance when edge type is reviews', async () => {
  // setup: agent_instances に Implementer (caller) を 1 行入れる
  const implId = ulid()
  agentInstanceStore.insert({
    id: implId,
    workflowInstanceId: 'wf-1',
    roleNodeId: 'implementer',
    sessionId: 'sess-implementer',
    parentAgentInstanceId: 'director-id',
    spawnEdgeId: 'director→implementer',
    status: 'running',
    workspaceKind: 'owned',
    workspacePath: '/tmp/wt1',
    branchName: 'legion/wf-1/impl-1',
    startedAt: new Date(),
  })

  const worktreeMgr = createMockWorktreeManager()
  const handler = new DelegateToolHandler({
    workflowInstanceId: 'wf-1',
    parentAgentInstanceId: implId,
    parentSessionId: 'sess-implementer',
    agentInstanceStore,
    worktreeManager: worktreeMgr,
    provider: createMockProvider({ summary: 'reviewed' }),
    eventLog: stubEventLog(),
    template: templateWithReviewsEdge(),
    baseCommitSha: 'base-sha',
  })

  await handler.handle({ role: 'reviewer', prompt: 'review please' })

  // worktreeMgr.create が呼ばれた input を assert
  expect(worktreeMgr.lastCreateInput).toMatchObject({
    role: 'reviewer',
    reviewTargetBranch: 'legion/wf-1/impl-1',  // caller の branch
    baseCommitSha: 'base-sha',
  })
})
```

`templateWithReviewsEdge()` は test fixture helper として:

```typescript
function templateWithReviewsEdge(): WorkflowTemplate {
  return {
    id: 't', name: 't', description: '',
    nodes: [
      { id: 'implementer', type: 'role', role: 'implementer', provider: 'claude-code', lifetime: 'per-task' },
      { id: 'reviewer', type: 'role', role: 'reviewer', provider: 'codex', lifetime: 'per-task' },
    ] as any,
    edges: [{ from: 'implementer', to: 'reviewer', type: 'reviews' }],
  }
}
```

`createMockWorktreeManager` は `lastCreateInput` フィールドを公開するように改修:

```typescript
function createMockWorktreeManager() {
  return {
    lastCreateInput: undefined as WorkspaceCreateInput | undefined,
    async create(input: WorkspaceCreateInput) {
      this.lastCreateInput = input
      return { ref: { kind: 'owned', path: '/tmp/mock-wt' }, path: '/tmp/mock-wt' }
    },
    async destroy() {},
  }
}
```

- [ ] **Step 5: test 実行で失敗を確認**

```bash
bun run test packages/runtime/test/orchestrator/delegate-tool.test.ts
```

期待: `reviewTargetBranch` が undefined で FAIL (Phase 2 実装はそもそも edges='reviews' を認識しない)。

- [ ] **Step 6: `delegate-tool.ts` を編集 (reviews edge 分岐 + reviewTargetBranch 解決)**

```typescript
async handle(input: DelegateToolInput): Promise<DelegateToolOutput> {
  // 1. role validation against template edges
  const targets = resolveDelegateTargets(this.deps.template, this.callerRoleNodeId())
  const target = targets.find((t) => t.roleName === input.role)
  if (!target) {
    throw new Error(`delegate: role '${input.role}' is not reachable from '${this.callerRoleNodeId()}'`)
  }

  // 2. resolve reviewTargetBranch when edge is 'reviews'
  let reviewTargetBranch: string | undefined
  if (target.edgeType === 'reviews') {
    const caller = this.deps.agentInstanceStore.bySessionId(this.deps.parentSessionId)
    if (!caller?.branchName) {
      throw new Error(`delegate(reviews): caller agent has no branchName (caller sessionId=${this.deps.parentSessionId})`)
    }
    reviewTargetBranch = caller.branchName
  }

  // 3. agent_instances INSERT for the spawned agent
  const newId = ulid()
  this.deps.agentInstanceStore.insert({
    id: newId,
    workflowInstanceId: this.deps.workflowInstanceId,
    roleNodeId: target.roleNodeId,
    sessionId: '', // 後で UPDATE (provider.launch の戻り値)
    parentAgentInstanceId: this.deps.parentAgentInstanceId,
    spawnEdgeId: `${this.callerRoleNodeId()}→${target.roleNodeId}`,
    status: 'starting',
    workspaceKind: 'owned',
    workspacePath: '',  // 後で UPDATE
    branchName: target.edgeType === 'reviews' ? reviewTargetBranch : undefined, // Reviewer は --detach なので caller の branch を流用
    startedAt: new Date(),
  })

  // 4. worktree create
  const seq = this.deps.agentInstanceStore.listByWorkflow(this.deps.workflowInstanceId).filter((r) => r.roleNodeId === target.roleNodeId).length
  const desc = await this.deps.worktreeManager.create({
    workflowInstanceId: this.deps.workflowInstanceId,
    agentInstanceId: newId,
    role: target.roleName,
    seq,
    baseCommitSha: this.deps.baseCommitSha,
    reviewTargetBranch,  // ★ Phase 3
  })

  // 5. branchName を Implementer 系の場合のみ desc.ref.branch から確定
  if (target.edgeType === 'delegates' && desc.ref.kind === 'owned' && desc.ref.branch) {
    this.deps.agentInstanceStore.updateBranchName(newId, desc.ref.branch)
  }

  // 6. provider.launch (provider 動的選択は Task 8 で扱う; 一旦 this.deps.provider のまま)
  const session = await this.deps.provider.launch({
    workdir: desc.path,
    role: target.roleName,
    initialPrompt: buildInitialPrompt(target.roleName, input.prompt),
    // outputSchema は Task 8 で追加
  })

  this.deps.agentInstanceStore.updateSessionId(newId, session.sessionId)
  this.deps.agentInstanceStore.updateWorkspacePath(newId, desc.path)
  this.deps.agentInstanceStore.updateStatus(newId, 'running')

  // 7. drainstream → event log
  let lastAssistant = ''
  for await (const ev of this.deps.provider.stream(session.sessionId)) {
    this.deps.eventLog.append({ ...ev, workflowInstanceId: this.deps.workflowInstanceId, agentInstanceId: newId })
    if (ev.type === 'assistant_message') lastAssistant = String((ev.payload as { content?: string }).content ?? '')
    if (ev.type === 'session_end') break
  }

  // 8. agent_instances UPDATE
  this.deps.agentInstanceStore.updateStatus(newId, 'completed')
  this.deps.agentInstanceStore.setEndedAt(newId, new Date())

  // 9. build output (decision parsing は Task 8、Blackboard publish は Task 9)
  return {
    agentInstanceId: newId,
    branchName: reviewTargetBranch ?? this.deps.agentInstanceStore.byId(newId)?.branchName ?? '',
    status: 'completed',
    summary: lastAssistant.slice(0, 500),
  }
}
```

(`agent-instance-store.ts` に `updateBranchName`, `updateSessionId`, `updateWorkspacePath` が無い場合は Phase 2 narrow 実装に依存。無ければ追加が必要。詳細は Phase 2 a01 plan §Task 3 を参照。)

- [ ] **Step 7: test 実行で pass を確認**

```bash
bun run test packages/runtime/test/orchestrator/delegate-tool.test.ts
```

期待: Step 4 で書いた reviews edge test が pass。

- [ ] **Step 8: commit**

```bash
git add packages/runtime/src/orchestrator/delegate-tool.ts \
        packages/runtime/test/orchestrator/delegate-tool.test.ts
git commit -m "feat(runtime): DelegateToolHandler resolves reviewTargetBranch for reviews edges"
```

---

## Task 8: `DelegateToolHandler` — `outputSchema` 注入 + decision JSON parse

**Files:**
- Modify: `packages/runtime/src/orchestrator/delegate-tool.ts`
- Modify: `packages/runtime/test/orchestrator/delegate-tool.test.ts`

- [ ] **Step 1: review schema 定数を追加するファイルを決める**

`packages/runtime/src/orchestrator/delegate-tool.ts` の冒頭にローカル定数として置く:

```typescript
const REVIEW_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    decision: { type: 'string', enum: ['approve', 'request-changes', 'reject'] },
    feedback: { type: 'string' },
    notes:    { type: 'string' },
  },
  required: ['decision'],
} as const
```

- [ ] **Step 2: failing test を追加 (outputSchema 注入)**

```typescript
it('passes outputSchema to provider.launch when delegating to reviewer', async () => {
  // setup: 上の reviewer test と同じセットアップ + provider mock を capturing 版に差し替え
  const provider = createCapturingProvider({ summary: '{"decision":"approve","feedback":"","notes":"LGTM"}' })
  const handler = new DelegateToolHandler({
    /* same as previous test */,
    provider,
  })

  await handler.handle({ role: 'reviewer', prompt: 'review please' })

  expect(provider.lastLaunchRequest).toBeDefined()
  expect(provider.lastLaunchRequest!.outputSchema).toBeDefined()
  expect((provider.lastLaunchRequest!.outputSchema as any).required).toContain('decision')
})

it('parses decision/feedback/notes from final assistant_message when role=reviewer', async () => {
  const provider = createCapturingProvider({
    summary: 'free-form notes\n\n```json\n{"decision":"request-changes","feedback":"fix the typo","notes":"some context"}\n```',
  })
  const handler = new DelegateToolHandler({ /* same */, provider })

  const out = await handler.handle({ role: 'reviewer', prompt: '...' })

  expect(out.decision).toBe('request-changes')
  expect(out.feedback).toBe('fix the typo')
  expect(out.summary).not.toContain('```json')  // raw JSON は summary に含めない
})

it('handles malformed JSON gracefully (decision=undefined, status=completed)', async () => {
  const provider = createCapturingProvider({ summary: 'not even json' })
  const handler = new DelegateToolHandler({ /* same */, provider })

  const out = await handler.handle({ role: 'reviewer', prompt: '...' })

  expect(out.decision).toBeUndefined()
  expect(out.status).toBe('completed')
  expect(out.summary).toBe('not even json')
})
```

`createCapturingProvider` は mock provider を拡張して `lastLaunchRequest` を捕捉:

```typescript
function createCapturingProvider(opts: { summary: string }): AgentProvider & { lastLaunchRequest?: LaunchRequest } {
  const base = createMockProvider({ summary: opts.summary })
  return {
    ...base,
    lastLaunchRequest: undefined,
    async launch(req: LaunchRequest) {
      ;(this as any).lastLaunchRequest = req
      return base.launch(req)
    },
  }
}
```

- [ ] **Step 3: test 実行で失敗を確認**

```bash
bun run test packages/runtime/test/orchestrator/delegate-tool.test.ts
```

期待: outputSchema が undefined、decision parse 未実装で FAIL。

- [ ] **Step 4: `delegate-tool.ts` を編集 — `outputSchema` 注入 + decision parse**

Task 7 で書いた `provider.launch({...})` 呼び出しを拡張:

```typescript
const session = await this.deps.provider.launch({
  workdir: desc.path,
  role: target.roleName,
  initialPrompt: buildInitialPrompt(target.roleName, input.prompt),
  outputSchema: target.edgeType === 'reviews' ? REVIEW_OUTPUT_SCHEMA : undefined,
})
```

decision parse 関数を追加 (private method または module-local function):

```typescript
interface ReviewPayload {
  decision: 'approve' | 'request-changes' | 'reject'
  feedback?: string
  notes?: string
}

function parseReviewerOutput(rawAssistantMessage: string): { payload?: ReviewPayload; freeFormSummary: string } {
  // 戦略 1: 全体が JSON
  const trimmed = rawAssistantMessage.trim()
  try {
    const obj = JSON.parse(trimmed) as ReviewPayload
    if (obj.decision) {
      return { payload: obj, freeFormSummary: obj.notes ?? '' }
    }
  } catch {}

  // 戦略 2: ```json fenced block を抽出 (outputSchema 不適用時の fallback)
  const fenceMatch = rawAssistantMessage.match(/```json\s*([\s\S]*?)```/i)
  if (fenceMatch) {
    try {
      const obj = JSON.parse(fenceMatch[1]) as ReviewPayload
      if (obj.decision) {
        const before = rawAssistantMessage.slice(0, fenceMatch.index ?? 0).trim()
        return { payload: obj, freeFormSummary: before }
      }
    } catch {}
  }

  return { freeFormSummary: rawAssistantMessage }
}
```

Step 7 の `return` 部を改修:

```typescript
if (target.edgeType === 'reviews') {
  const parsed = parseReviewerOutput(lastAssistant)
  return {
    agentInstanceId: newId,
    branchName: reviewTargetBranch ?? '',
    status: 'completed',
    decision: parsed.payload?.decision,
    feedback: parsed.payload?.feedback,
    summary: parsed.freeFormSummary.slice(0, 500),
  }
}

return {
  agentInstanceId: newId,
  branchName: this.deps.agentInstanceStore.byId(newId)?.branchName ?? '',
  status: 'completed',
  summary: lastAssistant.slice(0, 500),
}
```

- [ ] **Step 5: test 実行で pass を確認**

```bash
bun run test packages/runtime/test/orchestrator/delegate-tool.test.ts
```

期待: Step 2 の 3 test 全 pass。

- [ ] **Step 6: commit**

```bash
git add packages/runtime/src/orchestrator/delegate-tool.ts \
        packages/runtime/test/orchestrator/delegate-tool.test.ts
git commit -m "feat(runtime): DelegateToolHandler injects outputSchema and parses Reviewer decision"
```

---

## Task 9: `DelegateToolHandler` — Blackboard auto-publish

**Files:**
- Modify: `packages/runtime/src/orchestrator/delegate-tool.ts`
- Modify: `packages/runtime/test/orchestrator/delegate-tool.test.ts`

- [ ] **Step 1: `DelegateToolHandler` のコンストラクタ deps に `blackboardStore` を追加**

```typescript
class DelegateToolHandler {
  constructor(private deps: {
    // ... existing
    blackboardStore: BlackboardStore   // ★ Phase 3
  }) {}
}
```

- [ ] **Step 2: failing test を追加 (auto-publish at start/result/decision)**

```typescript
it('auto-publishes system.delegate.start before launching, and result/decision on completion', async () => {
  const db = new Database(':memory:')
  db.run(`CREATE TABLE workflow_instances (id TEXT PRIMARY KEY)`)
  db.run(`INSERT INTO workflow_instances (id) VALUES ('wf-1')`)
  const blackboard = new BlackboardStore(db)
  blackboard.initSchema()

  const provider = createCapturingProvider({
    summary: '{"decision":"approve","feedback":"","notes":""}',
  })
  const handler = new DelegateToolHandler({
    /* existing deps */,
    blackboardStore: blackboard,
    provider,
  })

  await handler.handle({ role: 'reviewer', prompt: '...' })

  const msgs = blackboard.listByWorkflow('wf-1')
  expect(msgs.map((m) => m.topic)).toContain('system.delegate.start')
  expect(msgs.map((m) => m.topic)).toContain('system.delegate.result')
  expect(msgs.map((m) => m.topic)).toContain('system.review.decision')

  const decisionMsg = msgs.find((m) => m.topic === 'system.review.decision')
  expect((decisionMsg!.payload as any).decision).toBe('approve')
})

it('auto-publishes only delegate.start/result (no review.decision) when role=implementer', async () => {
  /* similar setup but role='implementer', no decision topic expected */
})
```

- [ ] **Step 3: test 実行で失敗を確認**

```bash
bun run test packages/runtime/test/orchestrator/delegate-tool.test.ts
```

期待: blackboardStore に message が入らず FAIL。

- [ ] **Step 4: `delegate-tool.ts` の `handle()` に 3 publish 呼び出しを挿入**

```typescript
import { ulid } from 'ulid'
import type { BlackboardMessage } from '@legion/core'

// 3 箇所に publish を埋め込む

// (a) provider.launch の直前
this.deps.blackboardStore.insert({
  id: ulid(),
  workflowInstanceId: this.deps.workflowInstanceId,
  topic: 'system.delegate.start',
  publisherAgentId: null,
  payload: { fromAgentInstanceId: this.deps.parentAgentInstanceId, toAgentInstanceId: newId, role: target.roleName, edgeType: target.edgeType, prompt: input.prompt.slice(0, 200) },
  publishedAt: Date.now(),
})

// (b) drainstream 後、return の直前
this.deps.blackboardStore.insert({
  id: ulid(),
  workflowInstanceId: this.deps.workflowInstanceId,
  topic: 'system.delegate.result',
  publisherAgentId: null,
  payload: { agentInstanceId: newId, role: target.roleName, status: 'completed', summary: lastAssistant.slice(0, 200) },
  publishedAt: Date.now(),
})

// (c) Reviewer の場合のみ、decision を抜粋した別 topic
if (target.edgeType === 'reviews') {
  const parsed = parseReviewerOutput(lastAssistant)  // 既に Task 8 で計算済の場合は変数共有
  if (parsed.payload) {
    this.deps.blackboardStore.insert({
      id: ulid(),
      workflowInstanceId: this.deps.workflowInstanceId,
      topic: 'system.review.decision',
      publisherAgentId: null,
      payload: { agentInstanceId: newId, decision: parsed.payload.decision, feedback: parsed.payload.feedback ?? null },
      publishedAt: Date.now(),
    })
  }
}
```

- [ ] **Step 5: test 実行で pass を確認**

```bash
bun run test packages/runtime/test/orchestrator/delegate-tool.test.ts
```

期待: Step 2 の auto-publish test pass。

- [ ] **Step 6: 既存 Phase 2 test との互換性を確認 (deps に blackboardStore が増えたので)**

```bash
bun run test packages/runtime/test/orchestrator/delegate-tool.test.ts
```

期待: 既存 Implementer delegate test も全部 pass。Phase 2 の test fixture が blackboardStore を渡していない箇所があれば、test fixture を共通 helper にして blackboardStore を default で in-memory に注入する形に整理。

- [ ] **Step 7: commit**

```bash
git add packages/runtime/src/orchestrator/delegate-tool.ts \
        packages/runtime/test/orchestrator/delegate-tool.test.ts
git commit -m "feat(runtime): DelegateToolHandler auto-publishes to Blackboard"
```

---

## Task 10: Package exports と全体 verification

**Files:**
- Modify: `packages/runtime/package.json`

- [ ] **Step 1: `packages/runtime/package.json` の `exports` セクションに新規 subpath を追加**

```json
{
  "exports": {
    "./store/blackboard-store": "./src/store/blackboard-store.ts",
    "./orchestrator/template-validate": "./src/orchestrator/template-validate.ts",
    // ... existing
  }
}
```

(I-5 の議論は別タスクなので、今は curate せずに追加。)

- [ ] **Step 2: full typecheck**

```bash
bun run typecheck
```

期待: 全 5 パッケージ green。

- [ ] **Step 3: full test suite**

```bash
bun run test
```

期待: Phase 2 baseline 169 pass / 2 skip / 0 fail から、新規 test (約 20 件) が加わって 189 pass + 2 skip 程度。0 fail。

- [ ] **Step 4: 既存 contract test (real git) が引き続き green**

```bash
bun run test packages/runtime/test/workspace/git.test.ts
```

期待: green (LocalWorktreeProvider mock の contract test、Task 6 で書いた `reviewTargetBranch` 分岐とは独立)。

- [ ] **Step 5: 既存 contract test (Phase 2 real-SDK delegate-flow) が引き続き green (auth ありの場合)**

```bash
CLAUDE_CODE_OAUTH_TOKEN=<...> bun run test packages/runtime/test/integration/delegate-flow.integration.test.ts
```

期待: auth ありなら 38.7s で green、auth 無しなら skip。Phase 3 で DelegateToolHandler を変更したが、Implementer delegate path の挙動は壊れていないことを確認。

- [ ] **Step 6: commit (exports のみの場合)**

```bash
git add packages/runtime/package.json
git commit -m "chore(runtime): export blackboard-store and template-validate subpaths"
```

---

## Done criteria

a01 完了時点で:

- `bun run test`: 全 test green、新規 ~20 件追加
- `bun run typecheck`: green
- 新規ファイル: `blackboard.ts`, `blackboard-store.ts`, `template-validate.ts`, それぞれの test
- 拡張ファイル: `delegate.ts`, `agent-provider.ts`, `workflow.ts`, `delegate-tool.ts`, `local-worktree-provider.ts`, `provider.ts` (workspace), `graph-walker.ts`, `role-profile.ts`, `index.ts`, `package.json`
- 既存 Phase 2 real-SDK integration test が auth あり環境で引き続き green (Phase 2 narrow path が壊れていないこと)
- 各 mock fixture に CLAUDE.md 規約のヘッダコメント (representing / verified on / invalidated when / contract test) が付与済み

a02 で Codex provider を作り、a03 で server、a04 で web、a05 で workflow YAML + prompts、a06 で E2E + contract test (Codex 含む) という流れ。
