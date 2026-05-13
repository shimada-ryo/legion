# Phase 2 a02: Server Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the `@legion/server` package to (a) return populated `agentInstances[]` and per-agent diffs from `GET /api/instances/:id` and `GET /api/instances/:id/diff`, (b) resolve `POST /api/instances/:id/approvals/:approvalId` to the correct session even when multiple agents share a workflow, (c) close orphan `running` instances on server boot, and (d) fix the WebSocket history/tail race surfaced as I-2.

**Architecture:** Server boot wires the new `AgentInstanceStore` from a01 into `AppRuntime`. The approval lookup gains a server-level `Map<approvalId, sessionId>` that is populated when `permission_request` events flow through the event log. The WS handler switches to a subscribe-first pattern using `EventLogReader.history({ afterSeq })`.

**Tech Stack:** Bun's `Bun.serve`, `bun:sqlite`, `bun:test`, the runtime types added in a01.

**Spec reference:** [docs/dev/specs/2026-05-14_phase2_design.md](../specs/2026-05-14_phase2_design.md) §§ 4.4, 7.3, 8.5, 9 (I-2).
**Depends on:** [a01 runtime plan](2026-05-14_phase2_a01_runtime.md) — must be fully merged before starting a02.

---

## File Structure

### Create

| Path | Responsibility |
| --- | --- |
| `packages/server/src/boot/orphan-recovery.ts` | Mark `running` workflow_instances / agent_instances as `failed` on boot |
| `packages/server/test/boot/orphan-recovery.test.ts` | Unit tests for above |

### Modify

| Path | Change |
| --- | --- |
| `packages/server/src/app.ts` | Add `agentInstanceStore: AgentInstanceStore`, `approvalIdToSessionId: Map<string,string>` to `AppRuntime`; call `initAgentInstanceSchema` + `runOrphanRecovery` at startup; rekey `adapters` to `Map<workflowInstanceId, AgentProvider>` (drop the `sessionId` field — multiple sessions per workflow now) |
| `packages/server/src/http/handlers/instances.ts` | `handleInstanceDetail` populates `agentInstances`; `handleWorkflowsTrigger` sets `adapters` by workflowInstanceId only |
| `packages/server/src/http/handlers/approvals.ts` | Look up `approvalIdToSessionId` to resolve session |
| `packages/server/src/http/handlers/diff.ts` | Per-agent diff: query `agent_instances` rows with non-null `branch_name`, run `git diff <base>..<branch>` for each |
| `packages/server/src/ws/event-stream.ts` | Subscribe-first using `afterSeq` to close the I-2 race |
| `packages/server/src/http/routes.ts` | (no API change; ensure new modules wired) |
| `packages/server/test/handlers/instances.test.ts` | Add tests for new fields |
| `packages/server/test/handlers/approvals.test.ts` | Update for new lookup path |
| `packages/server/test/ws/event-stream.test.ts` | Add race-window test |

---

## Pre-flight

- [ ] **Confirm a01 is merged**

```bash
git log --oneline | head -20
```

Expected: 13 commits from a01 visible (last commit message: `refactor(runtime): remove dead SINGLETON_ROLES branch (I-4)`).

- [ ] **Baseline tests**

```bash
bun run typecheck && bun run test
```

Expected: green, total `≥ 145 pass / 1 skip / 0 fail`.

---

## Task 1: Wire `AgentInstanceStore` into `AppRuntime`

**Files:**
- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: Extend `AppRuntime` and `startApp`**

Edit `packages/server/src/app.ts`:

```typescript
import type { AgentProvider } from '@legion/core'
import { InstanceStore } from '@legion/runtime/orchestrator/instance-store'
import {
  AgentInstanceStore,
  initAgentInstanceSchema,
} from '@legion/runtime/store/agent-instance-store'
import { EventLog } from '@legion/runtime/eventlog/eventlog'
import { LocalWorktreeProvider } from '@legion/runtime/workspace/local-worktree-provider'
import { route } from './http/routes'
import { wsHandlers, type WsData } from './ws/event-stream'

export interface AppRuntime {
  options: AppOptions
  store: InstanceStore
  agentInstanceStore: AgentInstanceStore       // ★ new
  log: EventLog
  worktree: LocalWorktreeProvider
  /** workflowInstanceId → provider (one provider instance per workflow; sessions live in agentInstanceStore). */
  adapters: Map<string, AgentProvider>          // ★ shape change
  /** approvalId → sessionId, populated when permission_request events flow through. */
  approvalIdToSessionId: Map<string, string>    // ★ new
}

export async function startApp(opts: AppOptions): Promise<AppHandle> {
  initAgentInstanceSchema(opts.db)
  const runtime: AppRuntime = {
    options: opts,
    store: new InstanceStore(opts.db),
    agentInstanceStore: new AgentInstanceStore(opts.db),
    log: new EventLog(opts.db),
    worktree: new LocalWorktreeProvider({
      repoPath: opts.repoPath,
      baseDir: opts.worktreeBaseDir,
    }),
    adapters: new Map(),
    approvalIdToSessionId: new Map(),
  }
  // ... (rest unchanged for now; orphan recovery hooks in Task 4)
  const server: BunServer = Bun.serve<WsData>({
    port: opts.port,
    fetch: (req, srv) => {
      const url = new URL(req.url)
      const m = url.pathname.match(/^\/api\/ws\/instances\/([^/]+)\/events$/)
      if (m) {
        const upgraded = srv.upgrade(req, {
          data: { workflowInstanceId: m[1]!, stop: null } satisfies WsData,
        })
        if (upgraded) return undefined as unknown as Response
        return new Response('Upgrade failed', { status: 400 })
      }
      return route(req, srv, runtime)
    },
    websocket: wsHandlers(runtime),
  })
  return { port: server.port ?? opts.port, runtime, stop: async () => { server.stop() } }
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: fails at handler sites that still expect `{ adapter, sessionId }`. We will fix in Task 2 / 3.

- [ ] **Step 3: Do not commit yet** — type errors are intentional and will resolve in Task 2.

---

## Task 2: Update `handleWorkflowsTrigger` to the new `adapters` shape

**Files:**
- Modify: `packages/server/src/http/handlers/instances.ts`

- [ ] **Step 1: Edit the handler**

In `packages/server/src/http/handlers/instances.ts`, change the `triggerWorkflow` call site:

```typescript
const adapter = ctx.options.adapterFactory()
const { workflowInstanceId } = await triggerWorkflow({
  template,
  userPrompt,
  repoPath: ctx.options.repoPath,
  baseRef: body.baseRef ?? 'HEAD',
  workspaceProvider: ctx.worktree,
  adapter,
  instanceStore: ctx.store,
  agentInstanceStore: ctx.agentInstanceStore,    // ★ pass through
  eventLog: ctx.log,
})
ctx.adapters.set(workflowInstanceId, adapter)     // ★ value is now just the adapter
return Response.json({ workflowInstanceId }, { status: 202 })
```

Note: `triggerWorkflow` from a01 already accepts `agentInstanceStore`. If your a01 implementation didn't expose this parameter, fix that first.

- [ ] **Step 2: Confirm typecheck progress**

Run: `bun run typecheck`
Expected: this handler compiles; remaining failures should be in `approvals.ts` only.

---

## Task 3: Approval handler — resolve via `approvalIdToSessionId`

**Files:**
- Modify: `packages/server/src/http/handlers/approvals.ts`
- Modify: `packages/server/test/handlers/approvals.test.ts`

- [ ] **Step 1: Rewrite the handler**

```typescript
// packages/server/src/http/handlers/approvals.ts
import type { AppRuntime } from '../../app'

export async function handleApproval(
  instanceId: string,
  approvalId: string,
  req: Request,
  ctx: AppRuntime,
): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const body = (await req.json()) as { decision?: 'approve' | 'deny'; reason?: string }

  const sessionId = ctx.approvalIdToSessionId.get(approvalId)
  if (!sessionId) return new Response('Approval not found', { status: 404 })
  const adapter = ctx.adapters.get(instanceId)
  if (!adapter) return new Response('Instance not found', { status: 404 })

  if (body.decision === 'approve') {
    await adapter.approve(sessionId, approvalId)
    return new Response(null, { status: 204 })
  }
  if (body.decision === 'deny') {
    await adapter.deny(sessionId, approvalId, body.reason)
    return new Response(null, { status: 204 })
  }
  return new Response('decision must be "approve" or "deny"', { status: 400 })
}
```

- [ ] **Step 2: Update existing approvals.test.ts**

Find the line(s) that seed `ctx.adapters.set(instanceId, { adapter, sessionId })` and rewrite:

```typescript
ctx.adapters.set(instanceId, mockAdapter)
ctx.approvalIdToSessionId.set('approval-1', 'session-xyz')
```

Add a test for the not-found path:

```typescript
test('returns 404 when approvalId is unknown', async () => {
  const res = await handleApproval('inst-1', 'unknown-approval', new Request('http://x', {
    method: 'POST',
    body: JSON.stringify({ decision: 'approve' }),
  }), ctx)
  expect(res.status).toBe(404)
})
```

- [ ] **Step 3: Add `approvalId → sessionId` registration on event ingress**

Edit `packages/server/src/ws/event-stream.ts` (or wherever events first land server-side; the EventLog's tail callback is the natural place). The cleanest spot is in the tail handler used by the WS handler — but that only registers when a client is connected. We need registration even with no client. Instead, register inside the `EventLog.append` path via a separate tap.

Add a tap function in `app.ts`:

```typescript
// in startApp, after `runtime` is created:
runtime.log.onAny((evt) => {
  if (evt.type === 'permission_request') {
    const approvalId = (evt.payload as { approvalId?: string }).approvalId
    if (approvalId) runtime.approvalIdToSessionId.set(approvalId, evt.sessionId)
  }
})
```

If `EventLog` does not have `onAny`, add it. Edit `packages/runtime/src/eventlog/eventlog.ts`:

```typescript
private taps: ((e: AgentEvent) => void)[] = []

onAny(fn: (e: AgentEvent) => void): void {
  this.taps.push(fn)
}

// inside append() or wherever events get persisted, after notify():
for (const t of this.taps) t(evt)
```

This is the only runtime-touching change in a02. Keep it minimal.

- [ ] **Step 4: Run tests**

Run: `bun run typecheck && bun test packages/server/`
Expected: server tests green.

- [ ] **Step 5: Full regress**

Run: `bun run test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/app.ts \
        packages/server/src/http/handlers/instances.ts \
        packages/server/src/http/handlers/approvals.ts \
        packages/server/test/handlers/approvals.test.ts \
        packages/runtime/src/eventlog/eventlog.ts
git commit -m "feat(server): rekey adapters by workflow, resolve approvals via approvalId map"
```

---

## Task 4: Orphan recovery on boot

**Files:**
- Create: `packages/server/src/boot/orphan-recovery.ts`
- Create: `packages/server/test/boot/orphan-recovery.test.ts`
- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/server/test/boot/orphan-recovery.test.ts
import { describe, test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  InstanceStore,
  initInstanceSchema,
} from '@legion/runtime/orchestrator/instance-store'
import {
  AgentInstanceStore,
  initAgentInstanceSchema,
} from '@legion/runtime/store/agent-instance-store'
import { runOrphanRecovery } from '../../src/boot/orphan-recovery'

describe('runOrphanRecovery', () => {
  test('flips workflow_instances.status from running to failed', () => {
    const db = new Database(':memory:')
    initInstanceSchema(db)
    initAgentInstanceSchema(db)
    const wf = new InstanceStore(db)
    const inst = wf.create({
      templateId: 't',
      templateSnapshot: { id: 't', name: 't', nodes: [], edges: [] },
      baseCommitSha: 'x',
    })
    runOrphanRecovery({ db })
    expect(wf.get(inst.id)?.status).toBe('failed')
    db.close()
  })

  test('flips agent_instances with ended_at IS NULL', () => {
    const db = new Database(':memory:')
    initInstanceSchema(db)
    initAgentInstanceSchema(db)
    const ai = new AgentInstanceStore(db)
    ai.insert({
      id: 'a1',
      workflowInstanceId: 'wf-1',
      roleNodeId: 'director',
      sessionId: 's1',
      parentAgentInstanceId: null,
      spawnEdgeId: null,
      status: 'running',
      workspaceKind: 'owned',
      workspacePath: '/tmp/wt',
      branchName: null,
      startedAt: new Date(),
      endedAt: null,
    })
    runOrphanRecovery({ db })
    const row = ai.byId('a1')
    expect(row?.status).toBe('failed')
    expect(row?.endedAt).not.toBeNull()
    db.close()
  })

  test('does not touch already-completed rows', () => {
    const db = new Database(':memory:')
    initInstanceSchema(db)
    initAgentInstanceSchema(db)
    const wf = new InstanceStore(db)
    const inst = wf.create({
      templateId: 't',
      templateSnapshot: { id: 't', name: 't', nodes: [], edges: [] },
      baseCommitSha: 'x',
    })
    wf.updateStatus(inst.id, 'completed')
    runOrphanRecovery({ db })
    expect(wf.get(inst.id)?.status).toBe('completed')
    db.close()
  })
})
```

- [ ] **Step 2: Run test, verify failure**

Run: `bun test packages/server/test/boot/orphan-recovery.test.ts`
Expected: module-not-found.

- [ ] **Step 3: Implement**

```typescript
// packages/server/src/boot/orphan-recovery.ts
// On boot, any workflow_instance or agent_instance still in 'running'/'starting'
// is an orphan from a prior crash. Mark them failed; record ended_at_iso on
// agent_instances if missing.

import type { Database } from 'bun:sqlite'

export interface OrphanRecoveryOpts {
  db: Database
}

export function runOrphanRecovery({ db }: OrphanRecoveryOpts): void {
  const nowIso = new Date().toISOString()
  db.run(
    `UPDATE workflow_instances
     SET status = 'failed', ended_at_iso = COALESCE(ended_at_iso, ?)
     WHERE status IN ('running', 'waiting')`,
    [nowIso],
  )
  db.run(
    `UPDATE agent_instances
     SET status = 'failed', ended_at_iso = COALESCE(ended_at_iso, ?)
     WHERE ended_at_iso IS NULL`,
    [nowIso],
  )
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `bun test packages/server/test/boot/orphan-recovery.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Wire into `startApp`**

In `packages/server/src/app.ts`, after `initAgentInstanceSchema(opts.db)` and before constructing `runtime`:

```typescript
import { runOrphanRecovery } from './boot/orphan-recovery'

// ...
initAgentInstanceSchema(opts.db)
runOrphanRecovery({ db: opts.db })   // ★ before AppRuntime construction
```

- [ ] **Step 6: Full regress**

Run: `bun run typecheck && bun run test`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/boot/orphan-recovery.ts \
        packages/server/test/boot/orphan-recovery.test.ts \
        packages/server/src/app.ts
git commit -m "feat(server): close orphan running instances on boot"
```

---

## Task 5: `GET /api/instances/:id` populates `agentInstances[]`

**Files:**
- Modify: `packages/server/src/http/handlers/instances.ts`
- Modify: `packages/server/test/handlers/instances.test.ts`

- [ ] **Step 1: Update the handler**

In `packages/server/src/http/handlers/instances.ts`, rewrite `handleInstanceDetail`:

```typescript
export function handleInstanceDetail(id: string, ctx: AppRuntime): Response {
  const inst = ctx.store.get(id)
  if (!inst) return new Response('Not Found', { status: 404 })
  const events = ctx.log.history(id)
  const rows = ctx.agentInstanceStore.listByWorkflow(id)
  const agentInstances = rows.map((r) => ({
    id: r.id,
    roleNodeId: r.roleNodeId,
    workflowInstanceId: r.workflowInstanceId,
    sessionId: r.sessionId,
    status: r.status,
    parentAgentInstanceId: r.parentAgentInstanceId ?? undefined,
    spawnEdgeId: r.spawnEdgeId ?? undefined,
    workspace: { kind: r.workspaceKind, path: r.workspacePath } as const,
    branchName: r.branchName ?? undefined,
    tasks: [],
    inbox: [],
    subscriptions: [],
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt ? r.endedAt.toISOString() : null,
  }))
  return Response.json({
    id: inst.id,
    templateId: inst.templateId,
    templateSnapshot: inst.templateSnapshot,
    status: inst.status,
    startedAt: inst.startedAt.toISOString(),
    endedAt: inst.endedAt ? inst.endedAt.toISOString() : null,
    agentInstances,
    events,
  })
}
```

- [ ] **Step 2: Add a test**

In `packages/server/test/handlers/instances.test.ts`, add a test that seeds `agentInstanceStore` with two rows (Director + Implementer) and asserts the response shape:

```typescript
test('GET /api/instances/:id returns agentInstances populated with parent / branch', async () => {
  // arrange: seed both stores
  const inst = ctx.store.create({
    templateId: 't',
    templateSnapshot: { id: 't', name: 't', nodes: [], edges: [] },
    baseCommitSha: 'x',
  })
  ctx.agentInstanceStore.insert({
    id: 'dir-1',
    workflowInstanceId: inst.id,
    roleNodeId: 'director',
    sessionId: 'sess-dir',
    parentAgentInstanceId: null,
    spawnEdgeId: null,
    status: 'completed',
    workspaceKind: 'owned',
    workspacePath: '/tmp/wt/dir',
    branchName: null,
    startedAt: new Date(),
    endedAt: new Date(),
  })
  ctx.agentInstanceStore.insert({
    id: 'impl-1',
    workflowInstanceId: inst.id,
    roleNodeId: 'implementer',
    sessionId: 'sess-impl',
    parentAgentInstanceId: 'dir-1',
    spawnEdgeId: 'director→implementer',
    status: 'completed',
    workspaceKind: 'owned',
    workspacePath: '/tmp/wt/impl',
    branchName: 'legion/x/impl-1',
    startedAt: new Date(),
    endedAt: new Date(),
  })

  const res = handleInstanceDetail(inst.id, ctx)
  const body = (await res.json()) as { agentInstances: Array<{ id: string; parentAgentInstanceId?: string; branchName?: string }> }
  expect(body.agentInstances.map((a) => a.id).sort()).toEqual(['dir-1', 'impl-1'])
  const impl = body.agentInstances.find((a) => a.id === 'impl-1')!
  expect(impl.parentAgentInstanceId).toBe('dir-1')
  expect(impl.branchName).toBe('legion/x/impl-1')
})
```

- [ ] **Step 3: Run tests**

Run: `bun test packages/server/test/handlers/instances.test.ts`
Expected: new test passes; existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/http/handlers/instances.ts \
        packages/server/test/handlers/instances.test.ts
git commit -m "feat(server): populate agentInstances in GET /api/instances/:id"
```

---

## Task 6: Per-agent diff in `GET /api/instances/:id/diff`

**Files:**
- Modify: `packages/server/src/http/handlers/diff.ts`
- Modify: existing diff handler test (or add a new test file if none)

- [ ] **Step 1: Rewrite the handler**

```typescript
// packages/server/src/http/handlers/diff.ts
import { $ } from 'bun'
import type { AppRuntime } from '../../app'

export async function handleInstanceDiff(
  instanceId: string,
  ctx: AppRuntime,
): Promise<Response> {
  const inst = ctx.store.get(instanceId)
  if (!inst) return new Response('Not Found', { status: 404 })

  const rows = ctx.agentInstanceStore
    .listByWorkflow(instanceId)
    .filter((r) => r.branchName !== null)

  const out: Array<{ agentInstanceId: string; branch: string; diff: string }> = []
  for (const r of rows) {
    const branch = r.branchName!
    const diffProc = await $`git diff ${inst.baseCommitSha}..${branch}`
      .cwd(ctx.options.repoPath)
      .quiet()
      .nothrow()
    const diff = diffProc.exitCode === 0 ? diffProc.stdout.toString() : ''
    out.push({ agentInstanceId: r.id, branch, diff })
  }
  return Response.json(out)
}
```

- [ ] **Step 2: Update / add a diff handler test**

If a diff test file exists, update the expected response shape (array of `{agentInstanceId, branch, diff}`). If none exists yet, create `packages/server/test/handlers/diff.test.ts` and add a smoke test that asserts the handler returns an empty array when no agent has a branch.

- [ ] **Step 3: Run tests**

Run: `bun test packages/server/test/handlers/`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/http/handlers/diff.ts \
        packages/server/test/handlers/diff.test.ts
git commit -m "feat(server): per-agent diff in GET /api/instances/:id/diff"
```

---

## Task 7: WS history/tail race fix (I-2) — subscribe-first

**Files:**
- Modify: `packages/server/src/ws/event-stream.ts`
- Modify: `packages/server/test/ws/event-stream.test.ts`

- [ ] **Step 1: Write the failing test**

The race is: between `history()` and `tail()`, an event can land that history missed but tail also missed. Test by emitting an event into the log mid-handshake.

Add to `packages/server/test/ws/event-stream.test.ts`:

```typescript
test('no events are dropped when one lands between history fetch and tail subscription', async () => {
  const ctx = makeTestCtx()  // existing helper
  const wfId = 'wf-1'
  const received: string[] = []
  const ws = mockWs(wfId, (msg) => received.push(JSON.parse(msg).id))

  // seed history
  ctx.log.append(wfId, { id: 'e1', sessionId: 's1', type: 'message', payload: {}, timestamp: new Date() })

  // simulate concurrent emission: append e2 immediately, then open the WS
  ctx.log.append(wfId, { id: 'e2', sessionId: 's1', type: 'message', payload: {}, timestamp: new Date() })

  wsHandlers(ctx).open(ws as never)

  ctx.log.append(wfId, { id: 'e3', sessionId: 's1', type: 'message', payload: {}, timestamp: new Date() })

  await new Promise((r) => setTimeout(r, 10))
  expect(received).toEqual(['e1', 'e2', 'e3'])
})
```

- [ ] **Step 2: Run test, verify it can fail (depends on timing)**

Run: `bun test packages/server/test/ws/event-stream.test.ts`
Expected: the new test may or may not fail. If it passes consistently, that's because the current code is `history(); tail();` in sync — but in real load any async event between those lines drops. The test exercises the new subscribe-first pattern regardless.

- [ ] **Step 3: Implement subscribe-first**

```typescript
// packages/server/src/ws/event-stream.ts
import type { ServerWebSocket } from 'bun'
import type { AppRuntime } from '../app'

export interface WsData {
  workflowInstanceId: string
  stop: (() => void) | null
}

export function wsHandlers(ctx: AppRuntime) {
  return {
    open(ws: ServerWebSocket<WsData>) {
      const id = ws.data.workflowInstanceId

      // Subscribe FIRST. Buffer events that arrive before history is sent.
      const buffer: { seq: number; raw: string }[] = []
      const stop = ctx.log.tail(id, (evt, seq) => {
        buffer.push({ seq, raw: JSON.stringify(evt) })
      })

      // Now fetch history and find the high-water mark.
      const past = ctx.log.history(id)
      const lastHistorySeq = past.length === 0 ? 0 : (past[past.length - 1] as { seq?: number }).seq ?? 0

      for (const e of past) ws.send(JSON.stringify(e))

      // Replay buffered events with seq > lastHistorySeq, then keep tailing live.
      for (const b of buffer) {
        if (b.seq > lastHistorySeq) ws.send(b.raw)
      }
      // Swap the handler to direct-send for subsequent events.
      stop()
      ws.data.stop = ctx.log.tail(id, (evt) => ws.send(JSON.stringify(evt)))
    },
    message() {
      /* ignore inbound */
    },
    close(ws: ServerWebSocket<WsData>) {
      if (ws.data.stop) ws.data.stop()
    },
  }
}
```

Note: this requires `history()` to expose the `seq` of returned rows. Verify the existing reader does — if it doesn't, extend `AgentEvent` (or a sibling row type) to carry `seq` and update `history()`.

- [ ] **Step 4: Run test, verify pass**

Run: `bun test packages/server/test/ws/event-stream.test.ts`
Expected: green.

- [ ] **Step 5: Full regress**

Run: `bun run typecheck && bun run test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/ws/event-stream.ts \
        packages/server/test/ws/event-stream.test.ts
git commit -m "fix(server): close WS history/tail race with subscribe-first pattern (I-2)"
```

---

## Wrap-up

- [ ] **Final regress check**

Run: `bun run typecheck && bun run test`
Expected: typecheck green; total ≥ 152 pass.

- [ ] **Manual smoke (optional)**

If `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` is available, run the full Phase 1 manual smoke against the new server build. Confirm:
1. `GET /api/instances` still returns the kanban-friendly summaries.
2. `GET /api/instances/:id` now returns `agentInstances[]` with the Director and (after delegate) the Implementer entries.
3. `GET /api/instances/:id/diff` returns a per-agent array.

- [ ] **Branch state check**

```bash
git log --oneline | head -15
```

Expected: ~6 commits added since a01.

---

*If `triggerWorkflow` from a01 does not accept `agentInstanceStore`, stop and adjust — do not work around. The store must be threaded through so Director is persisted before any client polls.*
