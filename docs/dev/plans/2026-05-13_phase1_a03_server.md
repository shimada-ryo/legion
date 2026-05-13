# Phase 1 / a03: Event Log + Server 実装計画

> **エージェント worker 向け:** 必須 sub-skill: `superpowers:subagent-driven-development` (推奨) または `superpowers:executing-plans`。Steps は checkbox で進捗管理。

**Goal:** Phase 1 spec §7 に従って、(1) SQLite-backed の event log、(2) Workflow Template loader、(3) WorkflowInstance を一発 trigger できる最小オーケストレータ、(4) Bun の HTTP/WS サーバ (default port 5500、D-030) を実装する。

**Architecture:** event log は `packages/runtime/src/eventlog/` に SQLite テーブル (append-only) を 1 つ持ち、`AgentEvent` (a02 で確定) を保存する。Template loader は `workflows/*.yaml` を読み込み `WorkflowTemplate` に変換。Orchestrator は Phase 1 簡略版: trigger 時に Template の最初の Role node を 1 つ spawn し、その session の event を event log に書く (D-021/D-022 で Phase 1 は Director-Worker 連携を見送り)。Server は `packages/server/` に置き、`Bun.serve` で HTTP + WebSocket を併設する。

**Tech Stack:** TypeScript / Bun 1.3.14 / `bun:sqlite` (組み込み) / `Bun.serve` HTTP+WS / a01 の `LocalWorktreeProvider` / a02 の `ClaudeCodeAgentSDKProvider` / `yaml` / `ulidx`

**Spec reference:** [../specs/2026-05-13_phase1_design.md](../specs/2026-05-13_phase1_design.md) §3, §5, §7
**Decisions reference:** D-003, D-018, D-019, D-027, D-030, D-032
**Dependency on:** [a01](2026-05-13_phase1_a01_worktree.md), [a02](2026-05-13_phase1_a02_adapter.md)

---

## File Structure

新規作成:

- `packages/runtime/src/eventlog/schema.ts` — SQLite テーブル DDL
- `packages/runtime/src/eventlog/writer.ts` — `EventLogWriter` (append)
- `packages/runtime/src/eventlog/reader.ts` — `EventLogReader` (history / live tail)
- `packages/runtime/src/template/loader.ts` — `loadWorkflowTemplate` (YAML → `WorkflowTemplate`)
- `packages/runtime/src/template/registry.ts` — `TemplateRegistry` (workflows/ ディレクトリスキャン)
- `packages/runtime/src/orchestrator/instance-store.ts` — `WorkflowInstance` の in-memory store + SQLite 永続化
- `packages/runtime/src/orchestrator/spawn-agent.ts` — 単一 Role spawn ロジック (Phase 1 簡略)
- `packages/runtime/src/orchestrator/trigger.ts` — `triggerWorkflow` 関数
- `packages/server/src/index.ts` — エントリ (entry)
- `packages/server/src/http/routes.ts` — HTTP ルーティング (URL dispatch)
- `packages/server/src/http/handlers/templates.ts`
- `packages/server/src/http/handlers/instances.ts`
- `packages/server/src/http/handlers/approvals.ts`
- `packages/server/src/ws/event-stream.ts` — WebSocket イベント push
- `packages/server/src/app.ts` — サーバ起動 factory
- `packages/server/bin/start.ts` — `bun run start` のエントリ
- `packages/runtime/test/eventlog/writer.test.ts`
- `packages/runtime/test/eventlog/reader.test.ts`
- `packages/runtime/test/template/loader.test.ts`
- `packages/runtime/test/orchestrator/trigger.test.ts`
- `packages/server/test/app.test.ts`
- `packages/server/test/handlers/templates.test.ts`
- `packages/server/test/handlers/instances.test.ts`
- `packages/server/test/handlers/approvals.test.ts`
- `packages/server/test/ws/event-stream.test.ts`

修正:

- `packages/server/package.json` — test script / yaml 依存
- `packages/server/tsconfig.json` — test include

---

## Task 1: SQLite event log のスキーマと writer

**Files:**
- Create: `packages/runtime/src/eventlog/schema.ts`
- Create: `packages/runtime/src/eventlog/writer.ts`
- Create: `packages/runtime/test/eventlog/writer.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { initEventLogSchema } from '@legion/runtime/eventlog/schema'
import { EventLogWriter } from '@legion/runtime/eventlog/writer'
import type { AgentEvent } from '@legion/core'

let db: Database

beforeEach(() => {
  db = new Database(':memory:')
  initEventLogSchema(db)
})

afterEach(() => {
  db.close()
})

describe('EventLogWriter', () => {
  test('append stores an AgentEvent and assigns a monotonic seq', () => {
    const writer = new EventLogWriter(db)
    const evt: AgentEvent = {
      id: '01H000000000000000000000A1',
      sessionId: 'sess-1',
      type: 'message',
      payload: { text: 'hello' },
      timestamp: new Date('2026-05-13T12:00:00Z'),
    }
    const seq = writer.append('wf-instance-1', evt)
    expect(seq).toBe(1)
    const seq2 = writer.append('wf-instance-1', { ...evt, id: '01H000000000000000000000A2' })
    expect(seq2).toBe(2)
  })

  test('different workflow instances get independent rows but shared seq counter (global)', () => {
    const writer = new EventLogWriter(db)
    const e1: AgentEvent = {
      id: '01H000000000000000000000B1',
      sessionId: 's',
      type: 'message',
      payload: null,
      timestamp: new Date(),
    }
    const e2: AgentEvent = { ...e1, id: '01H000000000000000000000B2' }
    const s1 = writer.append('wf-1', e1)
    const s2 = writer.append('wf-2', e2)
    expect(s2).toBe(s1 + 1)
  })

  test('payload is stored as JSON', () => {
    const writer = new EventLogWriter(db)
    writer.append('wf-x', {
      id: '01H000000000000000000000C1',
      sessionId: 's',
      type: 'tool_call',
      payload: { name: 'Read', input: { path: '/x' } },
      timestamp: new Date(),
    })
    const row = db
      .query<{ payload_json: string }, []>(
        'SELECT payload_json FROM events WHERE event_id = ?',
      )
      .get('01H000000000000000000000C1')
    expect(row).not.toBeNull()
    expect(JSON.parse(row!.payload_json)).toEqual({
      name: 'Read',
      input: { path: '/x' },
    })
  })
})
```

- [ ] **Step 2: 失敗を確認**

```bash
bun test packages/runtime/test/eventlog/writer.test.ts
```

- [ ] **Step 3: schema を実装**

`packages/runtime/src/eventlog/schema.ts`:

```ts
import type { Database } from 'bun:sqlite'

// Append-only log. seq is the global monotonic ordering (AUTOINCREMENT).
// event_id is the AgentEvent.id (ULID) — also unique.
export function initEventLogSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      workflow_instance_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      timestamp_iso TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_wf ON events(workflow_instance_id, seq);
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, seq);
  `)
}
```

- [ ] **Step 4: writer を実装**

`packages/runtime/src/eventlog/writer.ts`:

```ts
import type { Database } from 'bun:sqlite'
import type { AgentEvent } from '@legion/core'

export class EventLogWriter {
  private stmt
  constructor(private readonly db: Database) {
    this.stmt = db.query<
      { seq: number },
      [string, string, string, string, string, string]
    >(`
      INSERT INTO events (event_id, workflow_instance_id, session_id, type, payload_json, timestamp_iso)
      VALUES (?, ?, ?, ?, ?, ?)
      RETURNING seq
    `)
  }

  append(workflowInstanceId: string, evt: AgentEvent): number {
    const row = this.stmt.get(
      evt.id,
      workflowInstanceId,
      evt.sessionId,
      evt.type,
      JSON.stringify(evt.payload),
      evt.timestamp.toISOString(),
    )
    if (!row) throw new Error('event insert returned no row')
    return row.seq
  }
}
```

- [ ] **Step 5: テスト成功確認**

```bash
bun test packages/runtime/test/eventlog/writer.test.ts
```

期待: 3 tests passed。

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/eventlog/schema.ts packages/runtime/src/eventlog/writer.ts packages/runtime/test/eventlog/writer.test.ts
git commit -m "feat(runtime): SQLite event log schema and writer per D-003"
```

---

## Task 2: Event log reader (history + live tail)

**Files:**
- Create: `packages/runtime/src/eventlog/reader.ts`
- Create: `packages/runtime/test/eventlog/reader.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { initEventLogSchema } from '@legion/runtime/eventlog/schema'
import { EventLogWriter } from '@legion/runtime/eventlog/writer'
import { EventLogReader } from '@legion/runtime/eventlog/reader'
import type { AgentEvent } from '@legion/core'

let db: Database

function evt(id: string, sessionId = 's'): AgentEvent {
  return {
    id,
    sessionId,
    type: 'message',
    payload: { text: id },
    timestamp: new Date(),
  }
}

beforeEach(() => {
  db = new Database(':memory:')
  initEventLogSchema(db)
})

afterEach(() => db.close())

describe('EventLogReader.history', () => {
  test('returns events for a workflow instance in seq order', () => {
    const w = new EventLogWriter(db)
    w.append('wf-1', evt('01H000000000000000000000D1'))
    w.append('wf-2', evt('01H000000000000000000000D2'))
    w.append('wf-1', evt('01H000000000000000000000D3'))
    const r = new EventLogReader(db)
    const rows = r.history('wf-1')
    expect(rows.map((e) => e.id)).toEqual([
      '01H000000000000000000000D1',
      '01H000000000000000000000D3',
    ])
  })

  test('respects sinceSeq parameter', () => {
    const w = new EventLogWriter(db)
    const s1 = w.append('wf-1', evt('01H000000000000000000000E1'))
    w.append('wf-1', evt('01H000000000000000000000E2'))
    const r = new EventLogReader(db)
    const rows = r.history('wf-1', { afterSeq: s1 })
    expect(rows.map((e) => e.id)).toEqual(['01H000000000000000000000E2'])
  })
})

describe('EventLogReader.tail', () => {
  test('yields newly-appended events for the given workflow instance', async () => {
    const w = new EventLogWriter(db)
    const r = new EventLogReader(db)
    const yielded: string[] = []
    const stop = r.tail('wf-1', (e) => {
      yielded.push(e.id)
    })
    w.append('wf-1', evt('01H000000000000000000000F1'))
    w.append('wf-2', evt('01H000000000000000000000F2')) // different wf
    w.append('wf-1', evt('01H000000000000000000000F3'))
    await new Promise((r) => setTimeout(r, 10))
    stop()
    expect(yielded).toEqual(['01H000000000000000000000F1', '01H000000000000000000000F3'])
  })
})
```

- [ ] **Step 2: 失敗を確認**

```bash
bun test packages/runtime/test/eventlog/reader.test.ts
```

- [ ] **Step 3: 実装**

`packages/runtime/src/eventlog/reader.ts`:

```ts
import type { Database } from 'bun:sqlite'
import type { AgentEvent } from '@legion/core'

export interface HistoryOptions {
  afterSeq?: number
  limit?: number
}

interface Row {
  seq: number
  event_id: string
  workflow_instance_id: string
  session_id: string
  type: string
  payload_json: string
  timestamp_iso: string
}

export class EventLogReader {
  private subscribers = new Map<
    string,
    Map<symbol, (e: AgentEvent, seq: number) => void>
  >()

  constructor(private readonly db: Database) {}

  history(workflowInstanceId: string, opts: HistoryOptions = {}): AgentEvent[] {
    const afterSeq = opts.afterSeq ?? 0
    const limit = opts.limit ?? 1000
    const rows = this.db
      .query<Row, [string, number, number]>(
        `SELECT seq, event_id, workflow_instance_id, session_id, type, payload_json, timestamp_iso
         FROM events
         WHERE workflow_instance_id = ? AND seq > ?
         ORDER BY seq ASC
         LIMIT ?`,
      )
      .all(workflowInstanceId, afterSeq, limit)
    return rows.map(rowToEvent)
  }

  /** Subscribe to live events. Returns a stop function. */
  tail(
    workflowInstanceId: string,
    handler: (e: AgentEvent, seq: number) => void,
  ): () => void {
    const key = Symbol()
    let inner = this.subscribers.get(workflowInstanceId)
    if (!inner) {
      inner = new Map()
      this.subscribers.set(workflowInstanceId, inner)
    }
    inner.set(key, handler)
    return () => inner!.delete(key)
  }

  /** Called by EventLogWriter (or its wrapper) after a successful append. */
  notify(workflowInstanceId: string, evt: AgentEvent, seq: number): void {
    const inner = this.subscribers.get(workflowInstanceId)
    if (!inner) return
    for (const h of inner.values()) h(evt, seq)
  }
}

function rowToEvent(row: Row): AgentEvent {
  return {
    id: row.event_id,
    sessionId: row.session_id,
    type: row.type as AgentEvent['type'],
    payload: JSON.parse(row.payload_json),
    timestamp: new Date(row.timestamp_iso),
  }
}
```

`reader.tail()` で実時間に反映させるには writer 側 から notify される必要がある。書き手と読み手を協調させる小さな wrapper を Task 3 で作る。

- [ ] **Step 4: テストはまだ通らないはず (writer が notify しないため)**

```bash
bun test packages/runtime/test/eventlog/reader.test.ts
```

期待: history テストはパス、tail テストはまだ FAIL (notify されないので yielded 配列が空)。

- [ ] **Step 5: 一時実装 - test 内で reader.notify を直接呼ぶ**

`reader.test.ts` の tail テストを次のように修正 (writer + reader を別々に動かさず、後の Task 3 で wrapper を入れる前提):

```ts
describe('EventLogReader.tail', () => {
  test('yields events for the given workflow instance via notify()', async () => {
    const r = new EventLogReader(db)
    const yielded: string[] = []
    const stop = r.tail('wf-1', (e) => {
      yielded.push(e.id)
    })
    r.notify('wf-1', evt('01H000000000000000000000F1'), 1)
    r.notify('wf-2', evt('01H000000000000000000000F2'), 2)
    r.notify('wf-1', evt('01H000000000000000000000F3'), 3)
    stop()
    expect(yielded).toEqual(['01H000000000000000000000F1', '01H000000000000000000000F3'])
  })
})
```

- [ ] **Step 6: テスト成功確認**

```bash
bun test packages/runtime/test/eventlog/reader.test.ts
```

期待: 3 tests passed。

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/eventlog/reader.ts packages/runtime/test/eventlog/reader.test.ts
git commit -m "feat(runtime): event log reader with history and tail subscription"
```

---

## Task 3: EventLog wrapper (writer + reader を連携)

writer と reader を 1 つの class でラップし、append 時に reader.notify() を自動呼出。

**Files:**
- Create: `packages/runtime/src/eventlog/eventlog.ts`
- Create: `packages/runtime/test/eventlog/eventlog.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { initEventLogSchema } from '@legion/runtime/eventlog/schema'
import { EventLog } from '@legion/runtime/eventlog/eventlog'
import type { AgentEvent } from '@legion/core'

let db: Database

beforeEach(() => {
  db = new Database(':memory:')
  initEventLogSchema(db)
})

afterEach(() => db.close())

describe('EventLog', () => {
  test('append triggers tail subscribers', () => {
    const log = new EventLog(db)
    const got: string[] = []
    log.tail('wf-1', (e) => got.push(e.id))
    log.append('wf-1', {
      id: '01H000000000000000000000G1',
      sessionId: 's',
      type: 'message',
      payload: null,
      timestamp: new Date(),
    } as AgentEvent)
    expect(got).toEqual(['01H000000000000000000000G1'])
  })

  test('history reflects appended events', () => {
    const log = new EventLog(db)
    log.append('wf-1', {
      id: '01H000000000000000000000G2',
      sessionId: 's',
      type: 'message',
      payload: null,
      timestamp: new Date(),
    } as AgentEvent)
    expect(log.history('wf-1').map((e) => e.id)).toEqual(['01H000000000000000000000G2'])
  })
})
```

- [ ] **Step 2: 失敗を確認**

```bash
bun test packages/runtime/test/eventlog/eventlog.test.ts
```

- [ ] **Step 3: 実装**

`packages/runtime/src/eventlog/eventlog.ts`:

```ts
import type { Database } from 'bun:sqlite'
import type { AgentEvent } from '@legion/core'
import { EventLogReader, type HistoryOptions } from './reader'
import { EventLogWriter } from './writer'

export class EventLog {
  private writer: EventLogWriter
  private reader: EventLogReader

  constructor(db: Database) {
    this.writer = new EventLogWriter(db)
    this.reader = new EventLogReader(db)
  }

  append(workflowInstanceId: string, evt: AgentEvent): number {
    const seq = this.writer.append(workflowInstanceId, evt)
    this.reader.notify(workflowInstanceId, evt, seq)
    return seq
  }

  history(workflowInstanceId: string, opts?: HistoryOptions): AgentEvent[] {
    return this.reader.history(workflowInstanceId, opts)
  }

  tail(
    workflowInstanceId: string,
    handler: (e: AgentEvent, seq: number) => void,
  ): () => void {
    return this.reader.tail(workflowInstanceId, handler)
  }
}
```

- [ ] **Step 4: テスト成功確認**

```bash
bun test packages/runtime/test/eventlog/eventlog.test.ts
```

期待: 2 tests passed。

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/eventlog/eventlog.ts packages/runtime/test/eventlog/eventlog.test.ts
git commit -m "feat(runtime): EventLog wrapper coupling writer and reader"
```

---

## Task 4: Workflow Template loader (YAML → `WorkflowTemplate`)

D-019 の YAML スキーマを `WorkflowTemplate` 型 (`packages/core/src/types/template.ts`) にマップ。

**Files:**
- Create: `packages/runtime/src/template/loader.ts`
- Create: `packages/runtime/test/template/loader.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, test, expect } from 'bun:test'
import { join } from 'node:path'
import { loadWorkflowTemplate } from '@legion/runtime/template/loader'

const REPO = process.cwd()

describe('loadWorkflowTemplate', () => {
  test('parses workflows/feature-implementation.yaml into a WorkflowTemplate', async () => {
    const t = await loadWorkflowTemplate(
      join(REPO, 'workflows', 'feature-implementation.yaml'),
    )
    expect(t.id).toBe('feature-implementation')
    expect(t.name).toBe('Feature Implementation Workflow')
    const roleIds = t.nodes.filter((n) => n.type === 'role').map((n) => n.id)
    expect(roleIds).toEqual(['director', 'implementer', 'reviewer'])
    expect(t.edges.length).toBeGreaterThan(0)
  })

  test('throws on missing required field (id)', async () => {
    const tmp = `${process.env['TMPDIR'] ?? '/tmp'}/no-id.yaml`
    await Bun.write(tmp, 'name: x\nnodes: []\nedges: []\n')
    await expect(loadWorkflowTemplate(tmp)).rejects.toThrow(/id/)
  })

  test('throws on unknown node type', async () => {
    const tmp = `${process.env['TMPDIR'] ?? '/tmp'}/bad-node.yaml`
    await Bun.write(
      tmp,
      "id: t\nname: t\nnodes:\n  - {id: x, type: alien}\nedges: []\n",
    )
    await expect(loadWorkflowTemplate(tmp)).rejects.toThrow(/alien/)
  })
})
```

- [ ] **Step 2: 失敗を確認**

```bash
bun test packages/runtime/test/template/loader.test.ts
```

- [ ] **Step 3: 実装**

`packages/runtime/src/template/loader.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import type {
  WorkflowTemplate,
  TemplateNode,
  TemplateEdge,
  EdgeType,
} from '@legion/core'

const KNOWN_NODE_TYPES = new Set([
  'role',
  'trigger',
  'blackboard',
  'human-gate',
  'sink',
])

const KNOWN_EDGE_TYPES: EdgeType[] = [
  'triggers',
  'delegates',
  'publishes',
  'subscribes',
  'reviews',
  'synthesizes',
]

export async function loadWorkflowTemplate(yamlPath: string): Promise<WorkflowTemplate> {
  const text = await readFile(yamlPath, 'utf-8')
  const parsed = parseYaml(text) as Record<string, unknown> | null
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${yamlPath}: top-level must be an object`)
  }
  if (typeof parsed.id !== 'string') throw new Error(`${yamlPath}: missing id`)
  if (typeof parsed.name !== 'string') throw new Error(`${yamlPath}: missing name`)
  const nodes = parseNodes(parsed.nodes, yamlPath)
  const edges = parseEdges(parsed.edges, yamlPath)
  const out: WorkflowTemplate = { id: parsed.id, name: parsed.name, nodes, edges }
  if (typeof parsed.description === 'string') out.description = parsed.description
  return out
}

function parseNodes(raw: unknown, file: string): TemplateNode[] {
  if (!Array.isArray(raw)) throw new Error(`${file}: nodes must be an array`)
  return raw.map((n, i) => parseNode(n, file, i))
}

function parseNode(raw: unknown, file: string, idx: number): TemplateNode {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${file}: nodes[${idx}] must be an object`)
  }
  const n = raw as Record<string, unknown>
  if (typeof n.id !== 'string' || typeof n.type !== 'string') {
    throw new Error(`${file}: nodes[${idx}] missing id or type`)
  }
  if (!KNOWN_NODE_TYPES.has(n.type)) {
    throw new Error(`${file}: nodes[${idx}] unknown type '${n.type}'`)
  }
  return n as unknown as TemplateNode
}

function parseEdges(raw: unknown, file: string): TemplateEdge[] {
  if (!Array.isArray(raw)) throw new Error(`${file}: edges must be an array`)
  return raw.map((e, i) => {
    if (typeof e !== 'object' || e === null) {
      throw new Error(`${file}: edges[${i}] must be an object`)
    }
    const ed = e as Record<string, unknown>
    if (
      typeof ed.from !== 'string' ||
      typeof ed.to !== 'string' ||
      typeof ed.type !== 'string'
    ) {
      throw new Error(`${file}: edges[${i}] requires from/to/type`)
    }
    if (!KNOWN_EDGE_TYPES.includes(ed.type as EdgeType)) {
      throw new Error(`${file}: edges[${i}] unknown type '${ed.type}'`)
    }
    return ed as unknown as TemplateEdge
  })
}
```

(ファイル長: ~80 行、関数最大 ~20 行。)

- [ ] **Step 4: テスト成功確認**

```bash
bun test packages/runtime/test/template/loader.test.ts
```

期待: 3 tests passed。

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/template/loader.ts packages/runtime/test/template/loader.test.ts
git commit -m "feat(runtime): YAML template loader per D-019"
```

---

## Task 5: Template Registry (`workflows/` をスキャン)

**Files:**
- Create: `packages/runtime/src/template/registry.ts`
- Create: `packages/runtime/test/template/registry.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, test, expect } from 'bun:test'
import { join } from 'node:path'
import { TemplateRegistry } from '@legion/runtime/template/registry'

describe('TemplateRegistry', () => {
  test('discovers YAML files under workflows/', async () => {
    const reg = new TemplateRegistry(join(process.cwd(), 'workflows'))
    await reg.refresh()
    const ids = reg.list().map((t) => t.id)
    expect(ids).toContain('feature-implementation')
  })

  test('get returns the template by id', async () => {
    const reg = new TemplateRegistry(join(process.cwd(), 'workflows'))
    await reg.refresh()
    const t = reg.get('feature-implementation')
    expect(t).toBeDefined()
    expect(t!.nodes.some((n) => n.type === 'role')).toBe(true)
  })

  test('get returns undefined for unknown id', async () => {
    const reg = new TemplateRegistry(join(process.cwd(), 'workflows'))
    await reg.refresh()
    expect(reg.get('nope')).toBeUndefined()
  })
})
```

- [ ] **Step 2: 失敗を確認**

```bash
bun test packages/runtime/test/template/registry.test.ts
```

- [ ] **Step 3: 実装**

`packages/runtime/src/template/registry.ts`:

```ts
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorkflowTemplate } from '@legion/core'
import { loadWorkflowTemplate } from './loader'

export class TemplateRegistry {
  private templates = new Map<string, WorkflowTemplate>()

  constructor(private readonly dir: string) {}

  async refresh(): Promise<void> {
    const entries = await readdir(this.dir)
    const next = new Map<string, WorkflowTemplate>()
    for (const e of entries) {
      if (!/\.ya?ml$/i.test(e)) continue
      const t = await loadWorkflowTemplate(join(this.dir, e))
      next.set(t.id, t)
    }
    this.templates = next
  }

  list(): WorkflowTemplate[] {
    return [...this.templates.values()]
  }

  get(id: string): WorkflowTemplate | undefined {
    return this.templates.get(id)
  }
}
```

- [ ] **Step 4: テスト成功確認**

```bash
bun test packages/runtime/test/template/registry.test.ts
```

期待: 3 tests passed。

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/template/registry.ts packages/runtime/test/template/registry.test.ts
git commit -m "feat(runtime): TemplateRegistry to scan workflows/ directory"
```

---

## Task 6: WorkflowInstance store

D-018 / D-027: Template の immutable snapshot を保持。

**Files:**
- Create: `packages/runtime/src/orchestrator/instance-store.ts`
- Create: `packages/runtime/test/orchestrator/instance-store.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { InstanceStore, initInstanceSchema } from '@legion/runtime/orchestrator/instance-store'
import type { WorkflowTemplate } from '@legion/core'

const SAMPLE_TEMPLATE: WorkflowTemplate = {
  id: 't',
  name: 'T',
  nodes: [{ type: 'trigger', id: 'trig', kind: 'manual' }],
  edges: [],
}

describe('InstanceStore', () => {
  test('create returns a fresh ULID and persists snapshot', () => {
    const db = new Database(':memory:')
    initInstanceSchema(db)
    const store = new InstanceStore(db)
    const inst = store.create({
      templateId: 't',
      templateSnapshot: SAMPLE_TEMPLATE,
      baseCommitSha: 'a'.repeat(40),
    })
    expect(inst.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/i)
    expect(inst.status).toBe('running')
    const fetched = store.get(inst.id)
    expect(fetched?.templateSnapshot).toEqual(SAMPLE_TEMPLATE)
    db.close()
  })

  test('list returns instances most-recent first', () => {
    const db = new Database(':memory:')
    initInstanceSchema(db)
    const store = new InstanceStore(db)
    const a = store.create({ templateId: 't', templateSnapshot: SAMPLE_TEMPLATE, baseCommitSha: 'x' })
    const b = store.create({ templateId: 't', templateSnapshot: SAMPLE_TEMPLATE, baseCommitSha: 'y' })
    const list = store.list()
    expect(list[0]!.id).toBe(b.id)
    expect(list[1]!.id).toBe(a.id)
    db.close()
  })

  test('updateStatus persists', () => {
    const db = new Database(':memory:')
    initInstanceSchema(db)
    const store = new InstanceStore(db)
    const inst = store.create({ templateId: 't', templateSnapshot: SAMPLE_TEMPLATE, baseCommitSha: 'x' })
    store.updateStatus(inst.id, 'completed')
    expect(store.get(inst.id)?.status).toBe('completed')
    db.close()
  })
})
```

- [ ] **Step 2: 失敗を確認**

```bash
bun test packages/runtime/test/orchestrator/instance-store.test.ts
```

- [ ] **Step 3: 実装**

`packages/runtime/src/orchestrator/instance-store.ts`:

```ts
import type { Database } from 'bun:sqlite'
import { ulid } from 'ulidx'
import type {
  WorkflowInstance,
  WorkflowInstanceStatus,
  WorkflowTemplate,
} from '@legion/core'

export function initInstanceSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_instances (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      template_snapshot_json TEXT NOT NULL,
      base_commit_sha TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at_iso TEXT NOT NULL,
      ended_at_iso TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_wi_started ON workflow_instances(started_at_iso DESC);
  `)
}

export interface CreateInstanceInput {
  templateId: string
  templateSnapshot: WorkflowTemplate
  baseCommitSha: string
}

export class InstanceStore {
  constructor(private readonly db: Database) {}

  create(input: CreateInstanceInput): WorkflowInstance {
    const id = ulid()
    const startedAt = new Date()
    this.db.run(
      `INSERT INTO workflow_instances (id, template_id, template_snapshot_json, base_commit_sha, status, started_at_iso) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.templateId,
        JSON.stringify(input.templateSnapshot),
        input.baseCommitSha,
        'running',
        startedAt.toISOString(),
      ],
    )
    return {
      id,
      templateId: input.templateId,
      templateSnapshot: input.templateSnapshot,
      status: 'running',
      agentInstances: [],
      blackboardChannels: [],
      startedAt,
    }
  }

  get(id: string): WorkflowInstance | undefined {
    const row = this.db
      .query<
        {
          id: string
          template_id: string
          template_snapshot_json: string
          base_commit_sha: string
          status: string
          started_at_iso: string
          ended_at_iso: string | null
        },
        [string]
      >(`SELECT * FROM workflow_instances WHERE id = ?`)
      .get(id)
    if (!row) return undefined
    return rowToInstance(row)
  }

  list(): WorkflowInstance[] {
    const rows = this.db
      .query<any, []>(`SELECT * FROM workflow_instances ORDER BY started_at_iso DESC`)
      .all()
    return rows.map(rowToInstance)
  }

  updateStatus(id: string, status: WorkflowInstanceStatus): void {
    const endedAt = status === 'completed' || status === 'failed' ? new Date().toISOString() : null
    this.db.run(
      `UPDATE workflow_instances SET status = ?, ended_at_iso = COALESCE(?, ended_at_iso) WHERE id = ?`,
      [status, endedAt, id],
    )
  }
}

function rowToInstance(row: any): WorkflowInstance {
  return {
    id: row.id,
    templateId: row.template_id,
    templateSnapshot: JSON.parse(row.template_snapshot_json),
    status: row.status as WorkflowInstanceStatus,
    agentInstances: [],
    blackboardChannels: [],
    startedAt: new Date(row.started_at_iso),
    ...(row.ended_at_iso ? { endedAt: new Date(row.ended_at_iso) } : {}),
  }
}
```

(ファイル長: ~90 行。`agentInstances` / `blackboardChannels` は Phase 1 では空のままにする — Phase 2 で AgentInstance store を作って結合する。)

- [ ] **Step 4: テスト成功確認**

```bash
bun test packages/runtime/test/orchestrator/instance-store.test.ts
```

期待: 3 tests passed。

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/orchestrator/instance-store.ts packages/runtime/test/orchestrator/instance-store.test.ts
git commit -m "feat(runtime): SQLite-backed WorkflowInstance store per D-018"
```

---

## Task 7: 単一 Role spawn ロジック

Phase 1 の簡略オーケストレータ。Template から最初に出てくる Role node を 1 つだけ spawn する (Director-Worker は Phase 2)。

**Files:**
- Create: `packages/runtime/src/orchestrator/spawn-agent.ts`
- Create: `packages/runtime/test/orchestrator/spawn-agent.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, test, expect } from 'bun:test'
import { firstRoleNode, buildInitialPrompt } from '@legion/runtime/orchestrator/spawn-agent'
import type { WorkflowTemplate } from '@legion/core'

const TEMPLATE: WorkflowTemplate = {
  id: 'fi',
  name: 'Feature Implementation',
  nodes: [
    { type: 'trigger', id: 'trig', kind: 'manual' },
    { type: 'role', id: 'dir', role: 'director', provider: 'claude-code', lifetime: 'per-workflow' },
    { type: 'role', id: 'impl', role: 'implementer', provider: 'claude-code', lifetime: 'per-task' },
  ],
  edges: [
    { from: 'trig', to: 'dir', type: 'triggers' },
    { from: 'dir', to: 'impl', type: 'delegates' },
  ],
}

describe('firstRoleNode', () => {
  test('returns the first Role connected to a trigger', () => {
    const n = firstRoleNode(TEMPLATE)
    expect(n?.id).toBe('dir')
    expect(n?.role).toBe('director')
  })

  test('returns null if template has no Role nodes', () => {
    const empty: WorkflowTemplate = { id: 'x', name: 'x', nodes: [], edges: [] }
    expect(firstRoleNode(empty)).toBeNull()
  })
})

describe('buildInitialPrompt', () => {
  test('embeds the user prompt and role context', () => {
    const role = TEMPLATE.nodes.find((n) => n.id === 'dir')! as any
    const p = buildInitialPrompt(role, 'Add a /health endpoint.')
    expect(p).toContain('director')
    expect(p).toContain('Add a /health endpoint.')
  })
})
```

- [ ] **Step 2: 失敗を確認**

```bash
bun test packages/runtime/test/orchestrator/spawn-agent.test.ts
```

- [ ] **Step 3: 実装**

`packages/runtime/src/orchestrator/spawn-agent.ts`:

```ts
import type { RoleNode, WorkflowTemplate } from '@legion/core'

export function firstRoleNode(template: WorkflowTemplate): RoleNode | null {
  // Find the Role that is the direct target of a 'triggers' edge from a trigger node.
  const triggers = template.nodes.filter((n) => n.type === 'trigger').map((n) => n.id)
  for (const e of template.edges) {
    if (e.type !== 'triggers') continue
    if (!triggers.includes(e.from)) continue
    const target = template.nodes.find((n) => n.id === e.to)
    if (target && target.type === 'role') return target
  }
  // Fallback: the first Role node in document order.
  const r = template.nodes.find((n) => n.type === 'role')
  return r && r.type === 'role' ? r : null
}

export function buildInitialPrompt(role: RoleNode, userPrompt: string): string {
  return [
    `You are operating as the "${role.role}" role in a legion workflow.`,
    `Your task:`,
    userPrompt,
  ].join('\n\n')
}
```

- [ ] **Step 4: テスト成功確認**

```bash
bun test packages/runtime/test/orchestrator/spawn-agent.test.ts
```

期待: 3 tests passed。

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/orchestrator/spawn-agent.ts packages/runtime/test/orchestrator/spawn-agent.test.ts
git commit -m "feat(runtime): orchestrator helpers for single-role spawn"
```

---

## Task 8: `triggerWorkflow` の統合

Template + LocalWorktreeProvider + ClaudeCodeAgentSDKProvider + InstanceStore + EventLog を組む。Phase 1 簡略版。

**Files:**
- Create: `packages/runtime/src/orchestrator/trigger.ts`
- Create: `packages/runtime/test/orchestrator/trigger.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { makeTempRepo, type TempRepo } from '../helpers/temp-repo'
import { resolveCommitSha } from '@legion/runtime/workspace/git'
import { LocalWorktreeProvider } from '@legion/runtime/workspace/local-worktree-provider'
import { ClaudeCodeAgentSDKProvider } from '@legion/runtime/adapter/provider'
import { initEventLogSchema } from '@legion/runtime/eventlog/schema'
import { initInstanceSchema } from '@legion/runtime/orchestrator/instance-store'
import { InstanceStore } from '@legion/runtime/orchestrator/instance-store'
import { EventLog } from '@legion/runtime/eventlog/eventlog'
import { triggerWorkflow } from '@legion/runtime/orchestrator/trigger'
import type { WorkflowTemplate } from '@legion/core'

const TEMPLATE: WorkflowTemplate = {
  id: 'echo',
  name: 'Echo',
  nodes: [
    { type: 'trigger', id: 'trig', kind: 'manual' },
    {
      type: 'role',
      id: 'impl',
      role: 'implementer',
      provider: 'claude-code',
      lifetime: 'per-task',
    },
  ],
  edges: [{ from: 'trig', to: 'impl', type: 'triggers' }],
}

let repo: TempRepo
let baseDir: string
let db: Database

beforeEach(async () => {
  repo = await makeTempRepo()
  baseDir = await mkdtemp(join(tmpdir(), 'legion-trig-'))
  db = new Database(':memory:')
  initEventLogSchema(db)
  initInstanceSchema(db)
})

afterEach(async () => {
  db.close()
  await rm(baseDir, { recursive: true, force: true })
  await repo.cleanup()
})

describe('triggerWorkflow', () => {
  test('creates an instance, creates a worktree, spawns one agent, and pipes events to event log', async () => {
    const wt = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const queryMock = (input: any) => {
      // Confirm we got the workspace path as workingDirectory
      expect(input.options.workingDirectory).toBeDefined()
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'x', model: 'm' }
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } }
        yield { type: 'result', subtype: 'success' }
      })()
    }
    const adapter = new ClaudeCodeAgentSDKProvider({ query: queryMock })
    const store = new InstanceStore(db)
    const log = new EventLog(db)
    const result = await triggerWorkflow({
      template: TEMPLATE,
      userPrompt: 'echo this',
      repoPath: repo.path,
      baseRef: 'HEAD',
      workspaceProvider: wt,
      adapter,
      instanceStore: store,
      eventLog: log,
    })
    expect(result.workflowInstanceId).toBeDefined()
    // Wait briefly for the streaming consumer to drain
    await new Promise((r) => setTimeout(r, 20))
    const history = log.history(result.workflowInstanceId)
    expect(history.length).toBeGreaterThanOrEqual(2) // init + message at minimum
    expect(history.some((e) => e.type === 'message')).toBe(true)
    expect(store.get(result.workflowInstanceId)?.status).toBe('completed')
  })
})
```

- [ ] **Step 2: 失敗を確認**

```bash
bun test packages/runtime/test/orchestrator/trigger.test.ts
```

- [ ] **Step 3: 実装**

`packages/runtime/src/orchestrator/trigger.ts`:

```ts
import type { WorkflowTemplate, AgentProvider, RoleNode } from '@legion/core'
import type { EventLog } from '../eventlog/eventlog'
import type { InstanceStore } from './instance-store'
import type { WorkspaceProvider } from '../workspace/provider'
import { resolveCommitSha } from '../workspace/git'
import { ulid } from 'ulidx'
import { firstRoleNode, buildInitialPrompt } from './spawn-agent'

export interface TriggerInput {
  template: WorkflowTemplate
  userPrompt: string
  repoPath: string
  baseRef: string
  workspaceProvider: WorkspaceProvider
  adapter: AgentProvider
  instanceStore: InstanceStore
  eventLog: EventLog
}

export interface TriggerResult {
  workflowInstanceId: string
}

export async function triggerWorkflow(input: TriggerInput): Promise<TriggerResult> {
  const role = firstRoleNode(input.template)
  if (!role) throw new Error('Template has no Role node to spawn')
  const baseCommitSha = await resolveCommitSha(input.repoPath, input.baseRef)
  const instance = input.instanceStore.create({
    templateId: input.template.id,
    templateSnapshot: input.template,
    baseCommitSha,
  })
  const agentInstanceId = ulid()
  const workspace = await input.workspaceProvider.create({
    workflowInstanceId: instance.id,
    agentInstanceId,
    role: role.role,
    seq: 1,
    baseCommitSha,
  })
  const handle = await input.adapter.launch({
    workdir: workspace.path,
    role: role.role,
    initialPrompt: buildInitialPrompt(role, input.userPrompt),
    ...(role.provider === 'claude-code' ? {} : {}), // future: route per provider
  })
  // Drain the stream and append events
  void (async () => {
    try {
      for await (const evt of input.adapter.stream(handle.sessionId)) {
        input.eventLog.append(instance.id, evt)
        if (evt.type === 'status_change') {
          const status = (evt.payload as { status?: string }).status
          if (status === 'completed') input.instanceStore.updateStatus(instance.id, 'completed')
          if (status === 'failed') input.instanceStore.updateStatus(instance.id, 'failed')
        }
      }
    } catch (err) {
      input.eventLog.append(instance.id, {
        id: ulid(),
        sessionId: handle.sessionId,
        type: 'error',
        payload: { message: (err as Error).message },
        timestamp: new Date(),
      })
      input.instanceStore.updateStatus(instance.id, 'failed')
    }
  })()
  return { workflowInstanceId: instance.id }
}
```

(ファイル長: ~70 行、関数 ~50 行で 100 行制限内。Phase 1 は spawn の対象を 1 Role に限定。)

- [ ] **Step 4: テスト成功確認**

```bash
bun test packages/runtime/test/orchestrator/trigger.test.ts
```

期待: 1 test passed。

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/orchestrator/trigger.ts packages/runtime/test/orchestrator/trigger.test.ts
git commit -m "feat(runtime): triggerWorkflow for Phase 1 single-role spawn"
```

---

## Task 9: HTTP routes — Templates

**Files:**
- Create: `packages/server/src/http/routes.ts`
- Create: `packages/server/src/http/handlers/templates.ts`
- Create: `packages/server/src/app.ts`
- Create: `packages/server/test/handlers/templates.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { startApp } from '@legion/server/app'
import { TemplateRegistry } from '@legion/runtime/template/registry'
import { join } from 'node:path'

const REPO = process.cwd()

let server: ReturnType<typeof startApp> extends Promise<infer T> ? T : never

beforeEach(async () => {
  const db = new Database(':memory:')
  const reg = new TemplateRegistry(join(REPO, 'workflows'))
  await reg.refresh()
  server = await startApp({ port: 0, db, templates: reg, repoPath: REPO })
})

afterEach(async () => {
  await server.stop()
})

describe('GET /templates', () => {
  test('returns array of template summaries', async () => {
    const res = await fetch(`http://localhost:${server.port}/templates`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body[0]).toHaveProperty('id')
    expect(body[0]).toHaveProperty('name')
    expect(body[0]).toHaveProperty('nodeCount')
  })
})

describe('GET /templates/:id', () => {
  test('returns the full template', async () => {
    const res = await fetch(`http://localhost:${server.port}/templates/feature-implementation`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('feature-implementation')
    expect(Array.isArray(body.nodes)).toBe(true)
  })

  test('returns 404 for unknown template', async () => {
    const res = await fetch(`http://localhost:${server.port}/templates/nope`)
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: 失敗を確認**

```bash
bun test packages/server/test/handlers/templates.test.ts
```

- [ ] **Step 3: app の骨組み**

`packages/server/src/app.ts`:

```ts
import type { Server } from 'bun'
import type { Database } from 'bun:sqlite'
import type { TemplateRegistry } from '@legion/runtime/template/registry'
import { route } from './http/routes'

export interface AppOptions {
  port: number
  db: Database
  templates: TemplateRegistry
  repoPath: string
}

export interface AppHandle {
  port: number
  stop(): Promise<void>
}

export async function startApp(opts: AppOptions): Promise<AppHandle> {
  const server: Server = Bun.serve({
    port: opts.port,
    fetch: (req, srv) => route(req, srv, opts),
  })
  return {
    port: server.port,
    stop: async () => {
      server.stop()
    },
  }
}
```

- [ ] **Step 4: route dispatcher**

`packages/server/src/http/routes.ts`:

```ts
import type { Server } from 'bun'
import type { AppOptions } from '../app'
import { handleTemplates } from './handlers/templates'

export function route(req: Request, _srv: Server, ctx: AppOptions): Response | Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname
  if (path === '/templates' || path.startsWith('/templates/')) {
    return handleTemplates(req, ctx)
  }
  return new Response('Not Found', { status: 404 })
}
```

- [ ] **Step 5: templates handler**

`packages/server/src/http/handlers/templates.ts`:

```ts
import type { AppOptions } from '../../app'

export function handleTemplates(req: Request, ctx: AppOptions): Response {
  const url = new URL(req.url)
  if (url.pathname === '/templates' && req.method === 'GET') {
    const list = ctx.templates.list().map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description ?? null,
      nodeCount: t.nodes.length,
    }))
    return Response.json(list)
  }
  const m = url.pathname.match(/^\/templates\/([^/]+)$/)
  if (m && req.method === 'GET') {
    const t = ctx.templates.get(m[1]!)
    if (!t) return new Response('Not Found', { status: 404 })
    return Response.json(t)
  }
  return new Response('Method Not Allowed', { status: 405 })
}
```

- [ ] **Step 6: テスト成功確認**

```bash
bun test packages/server/test/handlers/templates.test.ts
```

期待: 3 tests passed。

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/ packages/server/test/handlers/templates.test.ts
git commit -m "feat(server): GET /templates endpoints"
```

---

## Task 10: HTTP routes — Instances (list / get / trigger)

**Files:**
- Create: `packages/server/src/http/handlers/instances.ts`
- Modify: `packages/server/src/http/routes.ts`
- Create: `packages/server/test/handlers/instances.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { makeTempRepo, type TempRepo } from '@legion/runtime/../test/helpers/temp-repo'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { startApp } from '@legion/server/app'
import { TemplateRegistry } from '@legion/runtime/template/registry'
import { initEventLogSchema } from '@legion/runtime/eventlog/schema'
import { initInstanceSchema } from '@legion/runtime/orchestrator/instance-store'

let repo: TempRepo
let baseDir: string
let server: any

beforeEach(async () => {
  repo = await makeTempRepo()
  baseDir = await mkdtemp(join(tmpdir(), 'legion-srv-'))
  const db = new Database(':memory:')
  initEventLogSchema(db)
  initInstanceSchema(db)
  const reg = new TemplateRegistry(join(process.cwd(), 'workflows'))
  await reg.refresh()
  server = await startApp({
    port: 0,
    db,
    templates: reg,
    repoPath: repo.path,
    worktreeBaseDir: baseDir,
    // adapter factory: inject a mock that yields one assistant message and result
    adapterFactory: () =>
      ({
        id: 'claude-code',
        displayName: 'm',
        capabilities: {
          supportsCheckpoint: false,
          supportsResume: false,
          supportsAttach: false,
          supportsApprovalFlow: false,
        },
        detect: async () => ({ installed: true }),
        authenticate: async () => ({ authenticated: true }),
        launch: async () => ({ sessionId: 'sess-1' }),
        stream: async function* () {
          yield {
            id: 'evt-1',
            sessionId: 'sess-1',
            type: 'message',
            payload: { text: 'hi' },
            timestamp: new Date(),
          }
          yield {
            id: 'evt-2',
            sessionId: 'sess-1',
            type: 'status_change',
            payload: { status: 'completed' },
            timestamp: new Date(),
          }
        },
        send: async () => {},
        interrupt: async () => {},
        approve: async () => {},
        deny: async () => {},
        status: async () => ({}),
        checkpoint: async () => ({ id: '', createdAt: new Date(), metadata: {} }),
        resume: async () => ({ sessionId: '' }),
        shutdown: async () => {},
        exportTranscript: async () => ({ sessionId: '', events: [] }),
      }),
  } as any)
})

afterEach(async () => {
  await server.stop()
  await rm(baseDir, { recursive: true, force: true })
  await repo.cleanup()
})

describe('POST /workflows/trigger', () => {
  test('triggers a workflow and returns the new instance id', async () => {
    const res = await fetch(`http://localhost:${server.port}/workflows/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        templateId: 'feature-implementation',
        userPrompt: 'add /health',
      }),
    })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.workflowInstanceId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/i)
  })
})

describe('GET /instances and /instances/:id', () => {
  test('list and detail work after a trigger', async () => {
    const trig = await fetch(`http://localhost:${server.port}/workflows/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        templateId: 'feature-implementation',
        userPrompt: 'x',
      }),
    })
    const { workflowInstanceId } = await trig.json()
    await new Promise((r) => setTimeout(r, 30))
    const listRes = await fetch(`http://localhost:${server.port}/instances`)
    const list = await listRes.json()
    expect(Array.isArray(list)).toBe(true)
    expect(list.some((i: any) => i.id === workflowInstanceId)).toBe(true)

    const detailRes = await fetch(`http://localhost:${server.port}/instances/${workflowInstanceId}`)
    const detail = await detailRes.json()
    expect(detail.id).toBe(workflowInstanceId)
    expect(Array.isArray(detail.events)).toBe(true)
  })
})
```

- [ ] **Step 2: 失敗を確認**

```bash
bun test packages/server/test/handlers/instances.test.ts
```

- [ ] **Step 3: AppOptions を拡張**

`packages/server/src/app.ts`:

```ts
import type { Server } from 'bun'
import type { Database } from 'bun:sqlite'
import type { AgentProvider } from '@legion/core'
import type { TemplateRegistry } from '@legion/runtime/template/registry'
import { route } from './http/routes'
import { InstanceStore } from '@legion/runtime/orchestrator/instance-store'
import { EventLog } from '@legion/runtime/eventlog/eventlog'
import { LocalWorktreeProvider } from '@legion/runtime/workspace/local-worktree-provider'

export interface AppOptions {
  port: number
  db: Database
  templates: TemplateRegistry
  repoPath: string
  worktreeBaseDir: string
  adapterFactory: () => AgentProvider
}

export interface AppRuntime {
  options: AppOptions
  store: InstanceStore
  log: EventLog
  worktree: LocalWorktreeProvider
}

export interface AppHandle {
  port: number
  stop(): Promise<void>
  runtime: AppRuntime
}

export async function startApp(opts: AppOptions): Promise<AppHandle> {
  const runtime: AppRuntime = {
    options: opts,
    store: new InstanceStore(opts.db),
    log: new EventLog(opts.db),
    worktree: new LocalWorktreeProvider({ repoPath: opts.repoPath, baseDir: opts.worktreeBaseDir }),
  }
  const server: Server = Bun.serve({
    port: opts.port,
    fetch: (req, srv) => route(req, srv, runtime),
  })
  return {
    port: server.port,
    runtime,
    stop: async () => {
      server.stop()
    },
  }
}
```

- [ ] **Step 4: instances handler を書く**

`packages/server/src/http/handlers/instances.ts`:

```ts
import type { AppRuntime } from '../../app'
import { triggerWorkflow } from '@legion/runtime/orchestrator/trigger'

export async function handleWorkflowsTrigger(
  req: Request,
  ctx: AppRuntime,
): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const body = (await req.json()) as { templateId?: string; userPrompt?: string; baseRef?: string }
  const templateId = body.templateId
  const userPrompt = body.userPrompt ?? ''
  if (!templateId) return new Response('templateId required', { status: 400 })
  const template = ctx.options.templates.get(templateId)
  if (!template) return new Response('Unknown template', { status: 404 })
  const adapter = ctx.options.adapterFactory()
  const { workflowInstanceId } = await triggerWorkflow({
    template,
    userPrompt,
    repoPath: ctx.options.repoPath,
    baseRef: body.baseRef ?? 'HEAD',
    workspaceProvider: ctx.worktree,
    adapter,
    instanceStore: ctx.store,
    eventLog: ctx.log,
  })
  return Response.json({ workflowInstanceId }, { status: 202 })
}

export function handleInstancesList(_req: Request, ctx: AppRuntime): Response {
  const list = ctx.store.list().map((i) => ({
    id: i.id,
    templateId: i.templateId,
    status: i.status,
    startedAt: i.startedAt.toISOString(),
    endedAt: i.endedAt?.toISOString() ?? null,
  }))
  return Response.json(list)
}

export function handleInstanceDetail(id: string, ctx: AppRuntime): Response {
  const inst = ctx.store.get(id)
  if (!inst) return new Response('Not Found', { status: 404 })
  const events = ctx.log.history(id)
  return Response.json({
    id: inst.id,
    templateId: inst.templateId,
    templateSnapshot: inst.templateSnapshot,
    status: inst.status,
    startedAt: inst.startedAt.toISOString(),
    endedAt: inst.endedAt?.toISOString() ?? null,
    events,
  })
}
```

- [ ] **Step 5: route dispatcher を拡張**

`packages/server/src/http/routes.ts`:

```ts
import type { Server } from 'bun'
import type { AppRuntime } from '../app'
import { handleTemplates } from './handlers/templates'
import {
  handleInstancesList,
  handleInstanceDetail,
  handleWorkflowsTrigger,
} from './handlers/instances'

export function route(req: Request, _srv: Server, ctx: AppRuntime): Response | Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname
  if (path === '/templates' || path.startsWith('/templates/')) {
    return handleTemplates(req, ctx)
  }
  if (path === '/workflows/trigger') {
    return handleWorkflowsTrigger(req, ctx)
  }
  if (path === '/instances') {
    return handleInstancesList(req, ctx)
  }
  const m = path.match(/^\/instances\/([^/]+)$/)
  if (m) return handleInstanceDetail(m[1]!, ctx)
  return new Response('Not Found', { status: 404 })
}
```

- [ ] **Step 6: templates handler の signature を `AppRuntime` 経由に揃える**

`packages/server/src/http/handlers/templates.ts` の型を `AppRuntime` に修正 (`ctx.options.templates` に変更):

```ts
import type { AppRuntime } from '../../app'

export function handleTemplates(req: Request, ctx: AppRuntime): Response {
  const url = new URL(req.url)
  if (url.pathname === '/templates' && req.method === 'GET') {
    const list = ctx.options.templates.list().map((t) => ({ /* ... */ }))
    return Response.json(list)
  }
  // ... etc
}
```

(本 step ですべての箇所を `ctx.options.templates` に揃える。)

- [ ] **Step 7: テスト成功確認**

```bash
bun test packages/server/test/handlers/instances.test.ts
bun test packages/server/test/handlers/templates.test.ts
```

期待: それぞれ pass (templates 3 + instances 2)。

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/ packages/server/test/handlers/
git commit -m "feat(server): instance list/detail and workflow trigger endpoints"
```

---

## Task 11: WebSocket イベントストリーム

`/ws/instances/:id/events` で接続すると、その instance の event stream を JSON で push。history + tail を流す。

**Files:**
- Create: `packages/server/src/ws/event-stream.ts`
- Modify: `packages/server/src/app.ts` (`Bun.serve` の `websocket` 設定)
- Create: `packages/server/test/ws/event-stream.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
// ... same setup as instances.test.ts ...

describe('WS /ws/instances/:id/events', () => {
  test('streams history then live events', async () => {
    // trigger an instance first
    const trig = await fetch(`http://localhost:${server.port}/workflows/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templateId: 'feature-implementation', userPrompt: '' }),
    })
    const { workflowInstanceId } = await trig.json()
    await new Promise((r) => setTimeout(r, 20)) // drain initial events

    const url = `ws://localhost:${server.port}/ws/instances/${workflowInstanceId}/events`
    const ws = new WebSocket(url)
    const received: any[] = []
    ws.onmessage = (e) => received.push(JSON.parse(e.data as string))
    await new Promise((r) => (ws.onopen = r as any))
    await new Promise((r) => setTimeout(r, 30))
    ws.close()
    expect(received.length).toBeGreaterThan(0)
    expect(received[0]).toHaveProperty('id')
    expect(received[0]).toHaveProperty('type')
  })
})
```

- [ ] **Step 2: 失敗を確認**

```bash
bun test packages/server/test/ws/event-stream.test.ts
```

- [ ] **Step 3: WS handler を実装**

`packages/server/src/ws/event-stream.ts`:

```ts
import type { ServerWebSocket } from 'bun'
import type { AppRuntime } from '../app'

interface WsData {
  workflowInstanceId: string
  stop: (() => void) | null
}

export function upgradeEventStream(
  req: Request,
  workflowInstanceId: string,
  server: { upgrade(req: Request, opts?: any): boolean },
): boolean {
  return server.upgrade(req, {
    data: { workflowInstanceId, stop: null } satisfies WsData,
  })
}

export const wsHandlers = (ctx: AppRuntime) => ({
  open(ws: ServerWebSocket<WsData>) {
    const id = ws.data.workflowInstanceId
    // 1. send history
    for (const e of ctx.log.history(id)) ws.send(JSON.stringify(e))
    // 2. subscribe to live
    ws.data.stop = ctx.log.tail(id, (evt) => ws.send(JSON.stringify(evt)))
  },
  message() {
    // ignore inbound for Phase 1
  },
  close(ws: ServerWebSocket<WsData>) {
    if (ws.data.stop) ws.data.stop()
  },
})
```

- [ ] **Step 4: app.ts と routes.ts に組み込み**

`packages/server/src/app.ts` の `Bun.serve` を:

```ts
import { wsHandlers, upgradeEventStream } from './ws/event-stream'
// ...
const server: Server = Bun.serve({
  port: opts.port,
  fetch: (req, srv) => {
    const url = new URL(req.url)
    const m = url.pathname.match(/^\/ws\/instances\/([^/]+)\/events$/)
    if (m) {
      const ok = upgradeEventStream(req, m[1]!, srv)
      if (ok) return undefined as unknown as Response
      return new Response('Upgrade failed', { status: 400 })
    }
    return route(req, srv, runtime)
  },
  websocket: wsHandlers(runtime),
})
```

- [ ] **Step 5: テスト成功確認**

```bash
bun test packages/server/test/ws/event-stream.test.ts
```

期待: 1 test passed。

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/ws/ packages/server/src/app.ts packages/server/test/ws/
git commit -m "feat(server): WebSocket event stream per instance"
```

---

## Task 12: Approval API (POST /instances/:id/approvals/:approvalId)

a02 で実装した `ApprovalOrchestrator` は session 内に閉じている。Phase 1 では adapter を「launch 時に注入する factory」越しに使うので、approval の resolve はその session を保持している adapter インスタンスに対して呼ぶ必要がある。

設計: server は adapter instance を `instanceId → AgentProvider` のマップで保持 (runtime に拡張)。trigger 時にマップに登録、approval API はそのマップから引いて approve/deny。

**Files:**
- Modify: `packages/server/src/app.ts` (`AppRuntime` に `adapters` map 追加)
- Modify: `packages/runtime/src/orchestrator/trigger.ts` (adapter + sessionId を返す)
- Create: `packages/server/src/http/handlers/approvals.ts`
- Modify: `packages/server/src/http/routes.ts`
- Create: `packages/server/test/handlers/approvals.test.ts`

- [ ] **Step 1: triggerWorkflow を改修**

```ts
export interface TriggerResult {
  workflowInstanceId: string
  sessionId: string
}
```

(handle.sessionId を返す。)

- [ ] **Step 2: AppRuntime に `adapters` を追加**

```ts
export interface AppRuntime {
  options: AppOptions
  store: InstanceStore
  log: EventLog
  worktree: LocalWorktreeProvider
  adapters: Map<string, { adapter: AgentProvider; sessionId: string }> // wfInstanceId -> adapter
}
```

trigger handler 内で `ctx.adapters.set(workflowInstanceId, { adapter, sessionId })`。

- [ ] **Step 3: 失敗するテストを書く**

```ts
describe('POST /instances/:id/approvals/:approvalId', () => {
  test('approve resolves a pending PreToolUse approval', async () => {
    // adapter factory that lets a permission go pending and then resolves on approve()
    let pendingApprovalId: string | null = null
    const adapterMock: AgentProvider = {
      id: 'claude-code', displayName: 'm',
      capabilities: { supportsCheckpoint: false, supportsResume: false, supportsAttach: false, supportsApprovalFlow: true },
      detect: async () => ({ installed: true }),
      authenticate: async () => ({ authenticated: true }),
      launch: async () => ({ sessionId: 's' }),
      stream: async function* () {
        yield {
          id: 'evt-pr',
          sessionId: 's',
          type: 'permission_request',
          payload: { approvalId: 'app-1', tool: 'Edit', input: {} },
          timestamp: new Date(),
        }
        pendingApprovalId = 'app-1'
        // pause until approve is called
        await new Promise((r) => setTimeout(r, 50))
        yield { id: 'evt-done', sessionId: 's', type: 'status_change', payload: { status: 'completed' }, timestamp: new Date() }
      },
      send: async () => {}, interrupt: async () => {},
      approve: async (_sid, _aid) => { /* test: track */ },
      deny: async () => {},
      status: async () => ({}), checkpoint: async () => ({ id: '', createdAt: new Date(), metadata: {} }),
      resume: async () => ({ sessionId: '' }), shutdown: async () => {},
      exportTranscript: async () => ({ sessionId: '', events: [] }),
    }
    server = await startApp({ /* ... */, adapterFactory: () => adapterMock } as any)
    const trig = await fetch(`http://localhost:${server.port}/workflows/trigger`, { /* ... */ })
    const { workflowInstanceId } = await trig.json()
    await new Promise((r) => setTimeout(r, 20))
    const res = await fetch(
      `http://localhost:${server.port}/instances/${workflowInstanceId}/approvals/${pendingApprovalId}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve' }) },
    )
    expect(res.status).toBe(204)
  })
})
```

- [ ] **Step 4: approvals handler を実装**

`packages/server/src/http/handlers/approvals.ts`:

```ts
import type { AppRuntime } from '../../app'

export async function handleApproval(
  instanceId: string,
  approvalId: string,
  req: Request,
  ctx: AppRuntime,
): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const body = (await req.json()) as { decision?: 'approve' | 'deny'; reason?: string }
  const entry = ctx.adapters.get(instanceId)
  if (!entry) return new Response('Not Found', { status: 404 })
  if (body.decision === 'approve') {
    await entry.adapter.approve(entry.sessionId, approvalId)
    return new Response(null, { status: 204 })
  }
  if (body.decision === 'deny') {
    await entry.adapter.deny(entry.sessionId, approvalId, body.reason)
    return new Response(null, { status: 204 })
  }
  return new Response('decision must be "approve" or "deny"', { status: 400 })
}
```

- [ ] **Step 5: routes に追加**

```ts
const a = path.match(/^\/instances\/([^/]+)\/approvals\/([^/]+)$/)
if (a) return handleApproval(a[1]!, a[2]!, req, ctx)
```

- [ ] **Step 6: テスト確認**

```bash
bun test packages/server/test/handlers/approvals.test.ts
```

期待: 1 test passed。

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/ packages/server/test/handlers/approvals.test.ts packages/runtime/src/orchestrator/trigger.ts
git commit -m "feat(server): approve/deny endpoints wired to ApprovalOrchestrator"
```

---

## Task 13: サーバ起動エントリ + production startApp

`bun run --filter @legion/server start` で起動できる shim。

**Files:**
- Create: `packages/server/bin/start.ts`
- Modify: `packages/server/package.json` (`start` script)

- [ ] **Step 1: bin スクリプト**

`packages/server/bin/start.ts`:

```ts
#!/usr/bin/env bun
import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, mkdirSync } from 'node:fs'
import { startApp } from '../src/app'
import { TemplateRegistry } from '@legion/runtime/template/registry'
import { initEventLogSchema } from '@legion/runtime/eventlog/schema'
import { initInstanceSchema } from '@legion/runtime/orchestrator/instance-store'
import { ClaudeCodeAgentSDKProvider } from '@legion/runtime/adapter/provider'
import { query } from '@anthropic-ai/claude-agent-sdk'

const args = process.argv.slice(2)
const portIdx = args.indexOf('--port')
const port = portIdx >= 0 ? parseInt(args[portIdx + 1]!, 10) : 5500
const repoPath = process.cwd()
const dataDir = join(homedir(), '.legion')
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
const db = new Database(join(dataDir, 'legion.db'))
initEventLogSchema(db)
initInstanceSchema(db)

const templates = new TemplateRegistry(join(repoPath, 'workflows'))
await templates.refresh()

const handle = await startApp({
  port,
  db,
  templates,
  repoPath,
  worktreeBaseDir: join(dataDir, 'worktrees'),
  adapterFactory: () => new ClaudeCodeAgentSDKProvider({ query: query as any }),
})

console.log(`legion server listening on http://localhost:${handle.port}`)
```

- [ ] **Step 2: package.json**

```json
"scripts": {
  "typecheck": "tsc --noEmit",
  "test": "bun test",
  "start": "bun run bin/start.ts"
}
```

- [ ] **Step 3: 手動 smoke 確認 (テストは無し)**

```bash
bun run --filter @legion/server start &
sleep 1
curl -s http://localhost:5500/templates
kill %1
```

期待: templates の JSON が返る。

- [ ] **Step 4: Commit**

```bash
git add packages/server/bin/start.ts packages/server/package.json
git commit -m "feat(server): start.ts entry for bun run start"
```

---

## 完了条件

- [ ] event log writer / reader / wrapper のテストが緑 (合計 ~8 cases)
- [ ] template loader / registry のテストが緑 (~6 cases)
- [ ] instance store / spawn-agent / trigger のテストが緑 (~7 cases)
- [ ] server handlers (templates / instances / approvals) のテストが緑 (~7 cases)
- [ ] WS event-stream のテストが緑 (1 case)
- [ ] `bun run --filter @legion/server start` で起動し、`curl /templates` が動く

## 次の計画

[a04 Web UI Track A](2026-05-13_phase1_a04_web_runtime.md) に進む。a04 は a03 の HTTP/WS API をブラウザから叩く。
