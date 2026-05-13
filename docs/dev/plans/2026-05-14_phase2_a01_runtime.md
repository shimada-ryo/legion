# Phase 2 a01: Runtime Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the runtime core for Phase 2 Director→Implementer 1-to-1 delegation: core types, `agent_instances` SQLite store, graph walker, role prompts, role-profile updates, `provider.ts` split, `DelegateToolHandler`, and `trigger.ts` rewrite.

**Architecture:** Director (per-workflow Claude Code session) gets a `delegate` custom tool. Calling it synchronously spawns an Implementer (per-task session) inside a fresh worktree, awaits its completion, and returns the branch name + summary. Both agents are tracked in a new `agent_instances` SQLite table joined to the existing `workflow_instances`. The runtime is the only package touched in this plan; server and web changes follow in a02/a03.

**Tech Stack:** TypeScript, Bun runtime, Bun's built-in test runner (`bun:test`), Bun's built-in SQLite (`bun:sqlite`), `@anthropic-ai/claude-agent-sdk`, `ulid` for IDs.

**Spec reference:** [docs/dev/specs/2026-05-14_phase2_design.md](../specs/2026-05-14_phase2_design.md) §§ 4–7, 9.

---

## File Structure

### Create

| Path | Responsibility |
| --- | --- |
| `packages/core/src/types/delegate.ts` | `DelegateToolInput` / `DelegateToolOutput` |
| `packages/runtime/src/store/agent-instance-store.ts` | SQLite CRUD for `agent_instances` table |
| `packages/runtime/src/orchestrator/graph-walker.ts` | `resolveTriggerTargets`, `resolveDelegateTargets` |
| `packages/runtime/src/adapter/role-prompts.ts` | Director / Implementer system prompts |
| `packages/runtime/src/adapter/provider/launch.ts` | Extracted session launcher (called by `provider.ts`) |
| `packages/runtime/src/adapter/provider/stream.ts` | Extracted event stream merger |
| `packages/runtime/src/orchestrator/delegate-tool.ts` | `DelegateToolHandler` (Director's delegate tool) |
| `packages/runtime/test/store/agent-instance-store.test.ts` | Store unit tests |
| `packages/runtime/test/orchestrator/graph-walker.test.ts` | Graph walker unit tests |
| `packages/runtime/test/adapter/role-prompts.test.ts` | Role prompt unit tests |
| `packages/runtime/test/orchestrator/delegate-tool.test.ts` | Delegate handler unit tests (mock provider) |

### Modify

| Path | Change |
| --- | --- |
| `packages/core/src/types/instance.ts` | Extend `AgentInstance` with `parentAgentInstanceId`, `spawnEdgeId`, `workspace`, `branchName` |
| `packages/core/src/types/agent-provider.ts` | Add `customTools?: unknown[]` to `LaunchRequest` |
| `packages/core/src/index.ts` | Export new types |
| `packages/runtime/src/adapter/role-profile.ts` | Add delegate to Director profile, git bash to Implementer; add `defaultSystemPromptFor` |
| `packages/runtime/src/adapter/provider.ts` | Reduce to thin orchestrator delegating to `provider/launch.ts` + `provider/stream.ts`; pass `customTools` |
| `packages/runtime/src/orchestrator/trigger.ts` | Use `resolveTriggerTargets` instead of `firstRoleNode`; INSERT into `agent_instances` for Director; inject `DelegateToolHandler` as `customTools` |
| `packages/runtime/src/orchestrator/spawn-agent.ts` | Use `defaultSystemPromptFor(role)` in `buildInitialPrompt` |
| `packages/runtime/src/workspace/branch-naming.ts` | Drop dead `SINGLETON_ROLES` branch (I-4) |
| `packages/runtime/package.json` | Add new exports for `./store/agent-instance-store`, `./orchestrator/graph-walker`, `./orchestrator/delegate-tool`, `./adapter/role-prompts` |
| `packages/runtime/test/adapter/role-profile.test.ts` | Update profile assertions to include `mcp__legion__delegate` + git bash |

---

## Pre-flight

- [ ] **Confirm clean working tree**

```bash
git status
```

Expected: `nothing to commit, working tree clean`. If dirty, stash or resolve before starting.

- [ ] **Confirm tests green at baseline**

```bash
bun run test
```

Expected: `126 pass / 1 skip / 0 fail` (matches the handoff snapshot). If different, investigate before changing code — this is the baseline you regress-check against.

---

## Task 1: Add `DelegateTool` types to `@legion/core`

**Files:**
- Create: `packages/core/src/types/delegate.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the file**

```typescript
// packages/core/src/types/delegate.ts
// D-037, D-038: Director-facing custom tool. Synchronous: tool returns only
// after the Implementer session has ended.

export interface DelegateToolInput {
  /** Role to spawn. Phase 2 narrow scope accepts 'implementer' only. */
  role: string
  /** Self-contained prompt for the spawned agent. The spawned agent does NOT see the original user prompt. */
  prompt: string
  /** Optional one-line rationale. Logged to the event log but not passed to the spawned agent. */
  rationale?: string
}

export interface DelegateToolOutput {
  /** The spawned AgentInstance.id. */
  agentInstanceId: string
  /** Branch the Implementer committed to. */
  branchName: string
  /** 'completed' = session ended normally; 'failed' = provider threw. */
  status: 'completed' | 'failed'
  /** Last assistant message from the spawned agent, truncated to ~500 chars. */
  summary: string
  /** Present only when status='failed'. */
  error?: string
}
```

- [ ] **Step 2: Re-export from the package barrel**

Edit `packages/core/src/index.ts`. Find the block that exports `./types/instance`-style lines and add:

```typescript
export type { DelegateToolInput, DelegateToolOutput } from './types/delegate'
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: green across all packages.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types/delegate.ts packages/core/src/index.ts
git commit -m "feat(core): add DelegateTool input/output types"
```

---

## Task 2: Extend `AgentInstance` type with Phase 2 fields

**Files:**
- Modify: `packages/core/src/types/instance.ts`

- [ ] **Step 1: Edit the type**

In `packages/core/src/types/instance.ts`, add an import for `WorkspaceRef`:

```typescript
import type { WorkspaceRef } from './workspace'
```

Then expand the `AgentInstance` interface (keep existing fields; add the four new ones marked ★):

```typescript
export interface AgentInstance {
  id: string
  roleNodeId: string
  workflowInstanceId: string
  sessionId: string
  status: AgentStatus
  parentAgentInstanceId?: string      // ★ Phase 2: parent (Director's id for Implementer)
  spawnEdgeId?: string                // ★ Phase 2: which template edge spawned this agent
  workspace: WorkspaceRef             // ★ Phase 2: persisted workspace reference
  branchName?: string                 // ★ Phase 2: branch name for committers (Implementer); undefined for --detach (Director)
  tasks: Task[]
  inbox: InboundMessage[]
  subscriptions: SubscriptionState[]
  startedAt: Date
  endedAt?: Date
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: green. (No existing code reads `AgentInstance` fields apart from the literal `agentInstances: []` produced by `InstanceStore`, so adding required fields here is safe — those literals still match `[]: AgentInstance[]`.)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types/instance.ts
git commit -m "feat(core): extend AgentInstance with parent / spawn-edge / workspace / branch"
```

---

## Task 3: `AgentInstanceStore` — schema, CRUD, and tests

**Files:**
- Create: `packages/runtime/test/store/agent-instance-store.test.ts`
- Create: `packages/runtime/src/store/agent-instance-store.ts`
- Modify: `packages/runtime/package.json`

- [ ] **Step 1: Add the package export ahead of writing tests**

Edit `packages/runtime/package.json`. Inside `"exports"` add:

```json
"./store/agent-instance-store": "./src/store/agent-instance-store.ts",
```

(Place alphabetically near other `./...` keys.)

- [ ] **Step 2: Write the failing test file**

```typescript
// packages/runtime/test/store/agent-instance-store.test.ts
import { describe, test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  AgentInstanceStore,
  initAgentInstanceSchema,
  type AgentInstanceRow,
} from '@legion/runtime/store/agent-instance-store'

function freshStore(): { db: Database; store: AgentInstanceStore } {
  const db = new Database(':memory:')
  initAgentInstanceSchema(db)
  return { db, store: new AgentInstanceStore(db) }
}

function row(overrides: Partial<AgentInstanceRow> = {}): AgentInstanceRow {
  return {
    id: '01JABCDEFGHJKMNPQRSTUVWXY1',
    workflowInstanceId: 'wf-01',
    roleNodeId: 'director',
    sessionId: 'sess-1',
    parentAgentInstanceId: null,
    spawnEdgeId: null,
    status: 'starting',
    workspaceKind: 'owned',
    workspacePath: '/tmp/wt/director',
    branchName: null,
    startedAt: new Date('2026-05-14T12:00:00Z'),
    endedAt: null,
    ...overrides,
  }
}

describe('AgentInstanceStore', () => {
  test('insert then byId round-trips', () => {
    const { db, store } = freshStore()
    const r = row()
    store.insert(r)
    expect(store.byId(r.id)).toEqual(r)
    db.close()
  })

  test('bySessionId looks up by unique session_id', () => {
    const { db, store } = freshStore()
    const r = row({ sessionId: 'sess-xyz' })
    store.insert(r)
    expect(store.bySessionId('sess-xyz')?.id).toBe(r.id)
    expect(store.bySessionId('nope')).toBeUndefined()
    db.close()
  })

  test('listByWorkflow returns rows in insertion order', () => {
    const { db, store } = freshStore()
    store.insert(row({ id: 'a1', sessionId: 's1' }))
    store.insert(row({ id: 'a2', sessionId: 's2' }))
    const list = store.listByWorkflow('wf-01')
    expect(list.map((r) => r.id)).toEqual(['a1', 'a2'])
    db.close()
  })

  test('listChildren filters by parent', () => {
    const { db, store } = freshStore()
    store.insert(row({ id: 'parent', sessionId: 'sp' }))
    store.insert(
      row({ id: 'child1', sessionId: 'sc1', parentAgentInstanceId: 'parent' }),
    )
    store.insert(
      row({ id: 'child2', sessionId: 'sc2', parentAgentInstanceId: 'parent' }),
    )
    const kids = store.listChildren('parent')
    expect(kids.map((r) => r.id).sort()).toEqual(['child1', 'child2'])
    db.close()
  })

  test('updateStatus persists', () => {
    const { db, store } = freshStore()
    store.insert(row())
    store.updateStatus(row().id, 'running')
    expect(store.byId(row().id)?.status).toBe('running')
    db.close()
  })

  test('setEndedAt persists', () => {
    const { db, store } = freshStore()
    store.insert(row())
    const t = new Date('2026-05-14T13:00:00Z')
    store.setEndedAt(row().id, t)
    expect(store.byId(row().id)?.endedAt?.toISOString()).toBe(t.toISOString())
    db.close()
  })
})
```

- [ ] **Step 3: Run tests, verify failure**

Run: `bun test packages/runtime/test/store/agent-instance-store.test.ts`
Expected: All tests fail with module not found (`@legion/runtime/store/agent-instance-store`).

- [ ] **Step 4: Implement the store**

```typescript
// packages/runtime/src/store/agent-instance-store.ts
import type { Database } from 'bun:sqlite'
import type { AgentStatus } from '@legion/core'

export interface AgentInstanceRow {
  id: string
  workflowInstanceId: string
  roleNodeId: string
  sessionId: string
  parentAgentInstanceId: string | null
  spawnEdgeId: string | null
  status: AgentStatus
  workspaceKind: 'owned' | 'shared'
  workspacePath: string
  branchName: string | null
  startedAt: Date
  endedAt: Date | null
}

interface DbRow {
  id: string
  workflow_instance_id: string
  role_node_id: string
  session_id: string
  parent_agent_instance_id: string | null
  spawn_edge_id: string | null
  status: string
  workspace_kind: string
  workspace_path: string
  branch_name: string | null
  started_at_iso: string
  ended_at_iso: string | null
}

export function initAgentInstanceSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_instances (
      id                       TEXT PRIMARY KEY,
      workflow_instance_id     TEXT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
      role_node_id             TEXT NOT NULL,
      session_id               TEXT NOT NULL UNIQUE,
      parent_agent_instance_id TEXT REFERENCES agent_instances(id),
      spawn_edge_id            TEXT,
      status                   TEXT NOT NULL,
      workspace_kind           TEXT NOT NULL,
      workspace_path           TEXT NOT NULL,
      branch_name              TEXT,
      started_at_iso           TEXT NOT NULL,
      ended_at_iso             TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_instances_workflow ON agent_instances(workflow_instance_id);
    CREATE INDEX IF NOT EXISTS idx_agent_instances_session  ON agent_instances(session_id);
    CREATE INDEX IF NOT EXISTS idx_agent_instances_parent   ON agent_instances(parent_agent_instance_id);
  `)
}

export class AgentInstanceStore {
  constructor(private readonly db: Database) {}

  insert(r: AgentInstanceRow): void {
    this.db.run(
      `INSERT INTO agent_instances
       (id, workflow_instance_id, role_node_id, session_id, parent_agent_instance_id,
        spawn_edge_id, status, workspace_kind, workspace_path, branch_name,
        started_at_iso, ended_at_iso)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        r.id,
        r.workflowInstanceId,
        r.roleNodeId,
        r.sessionId,
        r.parentAgentInstanceId,
        r.spawnEdgeId,
        r.status,
        r.workspaceKind,
        r.workspacePath,
        r.branchName,
        r.startedAt.toISOString(),
        r.endedAt ? r.endedAt.toISOString() : null,
      ],
    )
  }

  byId(id: string): AgentInstanceRow | undefined {
    const row = this.db
      .query<DbRow, [string]>(`SELECT * FROM agent_instances WHERE id = ?`)
      .get(id)
    return row ? toRow(row) : undefined
  }

  bySessionId(sessionId: string): AgentInstanceRow | undefined {
    const row = this.db
      .query<DbRow, [string]>(`SELECT * FROM agent_instances WHERE session_id = ?`)
      .get(sessionId)
    return row ? toRow(row) : undefined
  }

  listByWorkflow(workflowInstanceId: string): AgentInstanceRow[] {
    const rows = this.db
      .query<DbRow, [string]>(
        `SELECT * FROM agent_instances WHERE workflow_instance_id = ? ORDER BY rowid ASC`,
      )
      .all(workflowInstanceId)
    return rows.map(toRow)
  }

  listChildren(parentAgentInstanceId: string): AgentInstanceRow[] {
    const rows = this.db
      .query<DbRow, [string]>(
        `SELECT * FROM agent_instances WHERE parent_agent_instance_id = ? ORDER BY rowid ASC`,
      )
      .all(parentAgentInstanceId)
    return rows.map(toRow)
  }

  updateStatus(id: string, status: AgentStatus): void {
    this.db.run(`UPDATE agent_instances SET status = ? WHERE id = ?`, [status, id])
  }

  setEndedAt(id: string, endedAt: Date): void {
    this.db.run(`UPDATE agent_instances SET ended_at_iso = ? WHERE id = ?`, [
      endedAt.toISOString(),
      id,
    ])
  }
}

function toRow(r: DbRow): AgentInstanceRow {
  return {
    id: r.id,
    workflowInstanceId: r.workflow_instance_id,
    roleNodeId: r.role_node_id,
    sessionId: r.session_id,
    parentAgentInstanceId: r.parent_agent_instance_id,
    spawnEdgeId: r.spawn_edge_id,
    status: r.status as AgentStatus,
    workspaceKind: r.workspace_kind as 'owned' | 'shared',
    workspacePath: r.workspace_path,
    branchName: r.branch_name,
    startedAt: new Date(r.started_at_iso),
    endedAt: r.ended_at_iso ? new Date(r.ended_at_iso) : null,
  }
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `bun test packages/runtime/test/store/agent-instance-store.test.ts`
Expected: 6 pass, 0 fail.

- [ ] **Step 6: Full regress check**

Run: `bun run typecheck && bun run test`
Expected: typecheck green; total tests `132 pass / 1 skip / 0 fail` (126 baseline + 6 new).

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/store/agent-instance-store.ts \
        packages/runtime/test/store/agent-instance-store.test.ts \
        packages/runtime/package.json
git commit -m "feat(runtime): add AgentInstanceStore (SQLite agent_instances table)"
```

---

## Task 4: `graph-walker` — `resolveTriggerTargets` and `resolveDelegateTargets`

**Files:**
- Create: `packages/runtime/test/orchestrator/graph-walker.test.ts`
- Create: `packages/runtime/src/orchestrator/graph-walker.ts`
- Modify: `packages/runtime/package.json`

- [ ] **Step 1: Add package export**

Edit `packages/runtime/package.json`. Inside `"exports"` add:

```json
"./orchestrator/graph-walker": "./src/orchestrator/graph-walker.ts",
```

- [ ] **Step 2: Write the failing test**

```typescript
// packages/runtime/test/orchestrator/graph-walker.test.ts
import { describe, test, expect } from 'bun:test'
import {
  resolveTriggerTargets,
  resolveDelegateTargets,
} from '@legion/runtime/orchestrator/graph-walker'
import type { WorkflowTemplate } from '@legion/core'

const TEMPLATE: WorkflowTemplate = {
  id: 'feature-implementation',
  name: 'Feature Implementation',
  nodes: [
    { type: 'trigger', id: 'trigger', kind: 'manual' },
    { type: 'role', id: 'director', role: 'director', provider: 'claude-code', lifetime: 'per-workflow' },
    { type: 'role', id: 'implementer', role: 'implementer', provider: 'claude-code', lifetime: 'per-task' },
    { type: 'role', id: 'reviewer', role: 'reviewer', provider: 'codex', lifetime: 'per-task' },
  ],
  edges: [
    { from: 'trigger', to: 'director', type: 'triggers' },
    { from: 'director', to: 'implementer', type: 'delegates' },
    { from: 'implementer', to: 'reviewer', type: 'reviews' },
  ],
}

describe('resolveTriggerTargets', () => {
  test('returns the role nodes connected from trigger nodes via triggers edges', () => {
    const out = resolveTriggerTargets(TEMPLATE)
    expect(out.map((n) => n.id)).toEqual(['director'])
  })

  test('returns empty when no trigger edges exist', () => {
    const t: WorkflowTemplate = {
      ...TEMPLATE,
      edges: [],
    }
    expect(resolveTriggerTargets(t)).toEqual([])
  })

  test('ignores non-role targets of trigger edges (defensive)', () => {
    const t: WorkflowTemplate = {
      id: 'x',
      name: 'X',
      nodes: [
        { type: 'trigger', id: 'trig', kind: 'manual' },
        { type: 'sink', id: 'sink-node', kind: 'github-pr' },
      ],
      edges: [{ from: 'trig', to: 'sink-node', type: 'triggers' }],
    }
    expect(resolveTriggerTargets(t)).toEqual([])
  })
})

describe('resolveDelegateTargets', () => {
  test('returns role nodes connected by a delegates edge from the given role', () => {
    const out = resolveDelegateTargets(TEMPLATE, 'director')
    expect(out).toEqual([{ roleNodeId: 'implementer', roleName: 'implementer' }])
  })

  test('returns empty when no delegates edge exists for the given role', () => {
    expect(resolveDelegateTargets(TEMPLATE, 'implementer')).toEqual([])
  })

  test('ignores non-delegates edges', () => {
    const t: WorkflowTemplate = {
      ...TEMPLATE,
      edges: [{ from: 'director', to: 'implementer', type: 'triggers' }],
    }
    expect(resolveDelegateTargets(t, 'director')).toEqual([])
  })
})
```

- [ ] **Step 3: Run test, verify failure**

Run: `bun test packages/runtime/test/orchestrator/graph-walker.test.ts`
Expected: module-not-found error.

- [ ] **Step 4: Implement the walker**

```typescript
// packages/runtime/src/orchestrator/graph-walker.ts
import type { WorkflowTemplate, TemplateNode, RoleNode } from '@legion/core'

function isRole(n: TemplateNode): n is RoleNode {
  return n.type === 'role'
}

/**
 * Resolve role nodes reachable from any trigger node via a 'triggers' edge.
 * Phase 2 narrow scope: returns exactly one role (the Director). The plural
 * shape is kept for Phase 3+ where multiple roles might be triggered.
 */
export function resolveTriggerTargets(template: WorkflowTemplate): RoleNode[] {
  const triggerIds = new Set(
    template.nodes.filter((n) => n.type === 'trigger').map((n) => n.id),
  )
  const targetIds = new Set<string>()
  for (const e of template.edges) {
    if (e.type === 'triggers' && triggerIds.has(e.from)) {
      targetIds.add(e.to)
    }
  }
  return template.nodes.filter(isRole).filter((n) => targetIds.has(n.id))
}

/**
 * Resolve role nodes reachable from the given role via a 'delegates' edge.
 * Used by DelegateToolHandler to validate that the caller really has a
 * delegates edge to the requested role in the template snapshot.
 */
export function resolveDelegateTargets(
  template: WorkflowTemplate,
  fromRoleNodeId: string,
): { roleNodeId: string; roleName: string }[] {
  const targets: { roleNodeId: string; roleName: string }[] = []
  for (const e of template.edges) {
    if (e.type !== 'delegates' || e.from !== fromRoleNodeId) continue
    const node = template.nodes.find((n) => n.id === e.to)
    if (node && isRole(node)) {
      targets.push({ roleNodeId: node.id, roleName: node.role })
    }
  }
  return targets
}
```

- [ ] **Step 5: Run test, verify pass**

Run: `bun test packages/runtime/test/orchestrator/graph-walker.test.ts`
Expected: 6 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/orchestrator/graph-walker.ts \
        packages/runtime/test/orchestrator/graph-walker.test.ts \
        packages/runtime/package.json
git commit -m "feat(runtime): add graph-walker (resolveTrigger/DelegateTargets)"
```

---

## Task 5: Role prompts — `role-prompts.ts`

**Files:**
- Create: `packages/runtime/test/adapter/role-prompts.test.ts`
- Create: `packages/runtime/src/adapter/role-prompts.ts`
- Modify: `packages/runtime/package.json`

- [ ] **Step 1: Add package export**

Edit `packages/runtime/package.json`. Inside `"exports"` add:

```json
"./adapter/role-prompts": "./src/adapter/role-prompts.ts",
```

- [ ] **Step 2: Write the failing test**

```typescript
// packages/runtime/test/adapter/role-prompts.test.ts
import { describe, test, expect } from 'bun:test'
import { defaultSystemPromptFor } from '@legion/runtime/adapter/role-prompts'

describe('defaultSystemPromptFor', () => {
  test('director prompt mentions the delegate tool and the BLOCKING contract', () => {
    const p = defaultSystemPromptFor('director')
    expect(p).toContain('delegate(role, prompt)')
    expect(p).toContain('BLOCKING')
  })

  test('director prompt forbids editing files directly', () => {
    expect(defaultSystemPromptFor('director')).toContain('MUST NOT attempt to edit files')
  })

  test('implementer prompt requires a git commit before ending', () => {
    const p = defaultSystemPromptFor('implementer')
    expect(p).toContain('git add -A && git commit')
    expect(p).toContain('MUST commit before ending')
  })

  test('unknown roles return an empty string (legacy fallback)', () => {
    expect(defaultSystemPromptFor('unknown-role')).toBe('')
  })
})
```

- [ ] **Step 3: Run test, verify failure**

Run: `bun test packages/runtime/test/adapter/role-prompts.test.ts`
Expected: module-not-found error.

- [ ] **Step 4: Implement**

```typescript
// packages/runtime/src/adapter/role-prompts.ts
// D-042: Role-specific system prompts. Used by spawn-agent.ts to prepend
// role-aware instructions to the initial user prompt.

const DIRECTOR_PROMPT = `
You are the Director agent in legion. Your job is to receive a user task,
decide what sub-task to delegate to an Implementer, and report the result.

Available tools:
- Read / Glob / Grep — to investigate the codebase before delegating.
- delegate(role, prompt) — to spawn an Implementer agent. This is a BLOCKING
  call: it returns only after the Implementer has finished. The return value
  contains the branch name and a summary of what the Implementer did.

You SHOULD:
1. Optionally read a few files to understand the task scope.
2. Write a precise, self-contained prompt for the Implementer that describes
   what to change, in which file, and any relevant constraints. The Implementer
   does NOT see the original user prompt — only what you pass to delegate.
3. Call delegate exactly once with role='implementer'.
4. After delegate returns, summarize the result for the user. Mention the
   branch name. Do not call delegate again.

You MUST NOT attempt to edit files yourself. Your toolset does not include
Edit/Write — that is intentional.
`.trim()

const IMPLEMENTER_PROMPT = `
You are an Implementer agent in legion. You operate inside a git worktree
that was created specifically for this task. The Director has handed you
a self-contained sub-task.

You SHOULD:
1. Read the files relevant to the task.
2. Make the requested edits.
3. Run any quick verification command if applicable (e.g. typecheck).
4. Commit your changes with 'git add -A && git commit -m "<concise message>"'.
   This is REQUIRED — your branch is how the Director and Reviewer see your work.
5. Briefly summarize what you changed and end the session.

You MUST commit before ending. An uncommitted worktree is treated as a failed
delegate by the Director.
`.trim()

const PROMPTS: Record<string, string> = {
  director: DIRECTOR_PROMPT,
  implementer: IMPLEMENTER_PROMPT,
}

export function defaultSystemPromptFor(role: string): string {
  return PROMPTS[role] ?? ''
}
```

- [ ] **Step 5: Run test, verify pass**

Run: `bun test packages/runtime/test/adapter/role-prompts.test.ts`
Expected: 4 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/adapter/role-prompts.ts \
        packages/runtime/test/adapter/role-prompts.test.ts \
        packages/runtime/package.json
git commit -m "feat(runtime): add role-prompts (Director + Implementer system prompts)"
```

---

## Task 6: Update `role-profile.ts` — delegate tool + git bash

**Files:**
- Modify: `packages/runtime/src/adapter/role-profile.ts`
- Modify: `packages/runtime/test/adapter/role-profile.test.ts`

- [ ] **Step 1: Update existing tests to expect the new tools**

Read `packages/runtime/test/adapter/role-profile.test.ts` first to see its current shape:

```bash
cat packages/runtime/test/adapter/role-profile.test.ts
```

Then update the assertions. The director profile should include `'mcp__legion__delegate'`; the implementer profile should include `'Bash(git add*)'`, `'Bash(git commit*)'`, `'Bash(git status*)'`, `'Bash(git diff*)'`. Add new assertions, keep existing ones for unaffected tools.

Concretely, append these tests to the existing `describe('defaultAllowedToolsFor', ...)` block (or replace stale ones if they conflict):

```typescript
test('director profile includes the delegate tool', () => {
  expect(defaultAllowedToolsFor('director')).toContain('mcp__legion__delegate')
})

test('implementer profile includes git commit-related bash whitelisted entries', () => {
  const p = defaultAllowedToolsFor('implementer')
  expect(p).toContain('Bash(git add*)')
  expect(p).toContain('Bash(git commit*)')
  expect(p).toContain('Bash(git status*)')
  expect(p).toContain('Bash(git diff*)')
})

test('reviewer profile remains read-only (no delegate, no git)', () => {
  const p = defaultAllowedToolsFor('reviewer')
  expect(p).not.toContain('mcp__legion__delegate')
  expect(p.some((t) => t.startsWith('Bash('))).toBe(false)
})
```

- [ ] **Step 2: Run tests, verify failure**

Run: `bun test packages/runtime/test/adapter/role-profile.test.ts`
Expected: the new assertions fail; older tests still pass.

- [ ] **Step 3: Implement profile changes**

Replace `packages/runtime/src/adapter/role-profile.ts`:

```typescript
// D-033 / D-042 / D-037: Default profile per role. Workflow YAML may override.

const READ_TOOLS = ['Read', 'Glob', 'Grep'] as const
const EDIT_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep'] as const

const IMPLEMENTER_BASH_WHITELIST = [
  'Bash(bun test*)',
  'Bash(bun run typecheck*)',
  'Bash(bun run lint*)',
  'Bash(bun build*)',
  'Bash(npm test*)',
  'Bash(npm run typecheck*)',
  'Bash(yarn test*)',
  'Bash(pnpm test*)',
  'Bash(pytest*)',
  'Bash(cargo test*)',
  'Bash(go test*)',
] as const

const IMPLEMENTER_GIT_WHITELIST = [
  'Bash(git add*)',
  'Bash(git commit*)',
  'Bash(git status*)',
  'Bash(git diff*)',
] as const

const DIRECTOR_TOOLS = [...READ_TOOLS, 'mcp__legion__delegate'] as const

const PROFILES: Record<string, readonly string[]> = {
  director: DIRECTOR_TOOLS,
  implementer: [...EDIT_TOOLS, ...IMPLEMENTER_BASH_WHITELIST, ...IMPLEMENTER_GIT_WHITELIST],
  reviewer: READ_TOOLS,
}

export function defaultAllowedToolsFor(role: string): string[] {
  return [...(PROFILES[role] ?? [])]
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `bun test packages/runtime/test/adapter/role-profile.test.ts`
Expected: all pass.

- [ ] **Step 5: Full regress check**

Run: `bun run typecheck && bun run test`
Expected: typecheck green; total `~135+ pass / 1 skip / 0 fail`.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/adapter/role-profile.ts \
        packages/runtime/test/adapter/role-profile.test.ts
git commit -m "feat(runtime): add delegate to Director profile, git tools to Implementer (I-9)"
```

---

## Task 7: Add `customTools` to `LaunchRequest`

**Files:**
- Modify: `packages/core/src/types/agent-provider.ts`

- [ ] **Step 1: Edit the type**

In `packages/core/src/types/agent-provider.ts`, expand `LaunchRequest`:

```typescript
export interface LaunchRequest {
  workdir: string
  role: string
  initialPrompt: string
  model?: string
  env?: Record<string, string>
  /**
   * D-037: Custom tools to inject into the spawned session (e.g. the Director's
   * delegate tool). Treated as opaque here; the provider passes it through to
   * its underlying SDK. Phase 2 only injects this for the Director session.
   */
  customTools?: unknown[]
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types/agent-provider.ts
git commit -m "feat(core): add LaunchRequest.customTools for in-session tool injection"
```

---

## Task 8: Refactor `provider.ts` — extract `provider/launch.ts`

**Files:**
- Create: `packages/runtime/src/adapter/provider/launch.ts`
- Modify: `packages/runtime/src/adapter/provider.ts`
- Modify: `packages/runtime/package.json` (no public export — internal-only)

This task does not change behavior. It moves the body of `launch()` into a free function. Tests must remain green throughout.

- [ ] **Step 1: Run the existing provider tests to lock the baseline**

Run: `bun test packages/runtime/test/adapter/provider.test.ts`
Expected: all pass.

- [ ] **Step 2: Create the extracted function**

```typescript
// packages/runtime/src/adapter/provider/launch.ts
import { ulid } from 'ulid'
import type { LaunchRequest } from '@legion/core'
import { defaultAllowedToolsFor } from '../role-profile'
import { ApprovalOrchestrator } from '../approval'
import { EventInjector } from '../session-store'

export type QueryFn = (input: unknown) => AsyncIterable<unknown>

export interface LaunchedSession {
  sessionId: string
  iter: AsyncIterable<unknown>
  approval: ApprovalOrchestrator
  injector: EventInjector
  workdir: string
  role: string
}

export function launchSession(req: LaunchRequest, query: QueryFn): LaunchedSession {
  const sessionId = ulid()
  const allowed = defaultAllowedToolsFor(req.role)
  const approval = new ApprovalOrchestrator(allowed)
  const injector = new EventInjector()

  approval.on('permission_request', (permReq) => {
    injector.push({
      id: ulid(),
      sessionId,
      type: 'permission_request',
      payload: {
        approvalId: permReq.approvalId,
        tool: permReq.tool,
        input: permReq.input,
      },
      timestamp: new Date(),
    })
  })

  const iter = query({
    prompt: req.initialPrompt,
    options: {
      cwd: req.workdir,
      allowedTools: allowed,
      permissionMode: 'default',
      canUseTool: async (toolName: string, input: Record<string, unknown>) => {
        const d = await approval.decide({ tool: toolName, input })
        return d.allow
          ? { behavior: 'allow' as const, updatedInput: input }
          : { behavior: 'deny' as const, message: d.reason ?? 'denied' }
      },
      ...(req.customTools !== undefined ? { tools: req.customTools } : {}),
      ...(req.model !== undefined ? { model: req.model } : {}),
      ...(req.env !== undefined ? { env: req.env } : {}),
    },
  })

  return { sessionId, iter, approval, injector, workdir: req.workdir, role: req.role }
}
```

- [ ] **Step 3: Replace the body of `provider.ts::launch`**

In `packages/runtime/src/adapter/provider.ts`, replace the `launch()` body so the file calls into `launchSession`:

```typescript
import { launchSession, type QueryFn } from './provider/launch'
// remove the inline `defaultAllowedToolsFor`, `ApprovalOrchestrator`, `EventInjector`,
// and `ulid` imports if they are no longer used in this file.

// ...

async launch(req: LaunchRequest): Promise<SessionHandle> {
  const s = launchSession(req, this.opts.query)
  this.store.set(s)
  return { sessionId: s.sessionId }
}
```

Make sure the `QueryFn` re-export from `provider.ts` keeps working (move it to re-export from `./provider/launch`):

```typescript
export type { QueryFn } from './provider/launch'
```

- [ ] **Step 4: Run provider tests, verify pass**

Run: `bun test packages/runtime/test/adapter/provider.test.ts`
Expected: all pass (no behavior change).

- [ ] **Step 5: Full regress check**

Run: `bun run typecheck && bun run test`
Expected: typecheck green; tests still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/adapter/provider.ts \
        packages/runtime/src/adapter/provider/launch.ts
git commit -m "refactor(runtime): extract provider/launch.ts (I-1 split prep)"
```

---

## Task 9: Refactor `provider.ts` — extract `provider/stream.ts`

**Files:**
- Create: `packages/runtime/src/adapter/provider/stream.ts`
- Modify: `packages/runtime/src/adapter/provider.ts`

Same no-behavior-change rule as Task 8.

- [ ] **Step 1: Create the extracted function**

```typescript
// packages/runtime/src/adapter/provider/stream.ts
import type { AgentEvent } from '@legion/core'
import { toAgentEvent } from '../event-convert'
import type { SessionStore } from '../session-store'

export async function* streamSession(
  store: SessionStore,
  sessionId: string,
): AsyncIterable<AgentEvent> {
  const s = store.get(sessionId)
  const sdkIter = s.iter[Symbol.asyncIterator]()
  let sdkPromise = sdkIter.next()
  let sdkDone = false

  while (true) {
    let injected: AgentEvent | undefined
    while ((injected = s.injector.shift()) !== undefined) {
      yield injected
    }
    if (sdkDone) return

    const injectPromise = s.injector.wait().then(() => 'inject' as const)
    const sdkP = sdkPromise.then((r) => ({ kind: 'sdk' as const, r }))
    const winner = await Promise.race([sdkP, injectPromise])

    if (winner === 'inject') continue

    const { r } = winner
    if (r.done) {
      sdkDone = true
      continue
    }

    sdkPromise = sdkIter.next()
    const evt = toAgentEvent(sessionId, r.value)
    if (evt) yield evt
  }
}
```

- [ ] **Step 2: Replace `stream()` body in `provider.ts`**

```typescript
import { streamSession } from './provider/stream'

// ...

stream(sessionId: string): AsyncIterable<AgentEvent> {
  return streamSession(this.store, sessionId)
}
```

Note: this changes `stream` from `async *...` to a sync method that returns the iterable from `streamSession`. The external contract (`AsyncIterable<AgentEvent>`) is unchanged.

- [ ] **Step 3: Run provider tests, verify pass**

Run: `bun test packages/runtime/test/adapter/provider.test.ts`
Expected: all pass.

- [ ] **Step 4: Confirm `provider.ts` is now ≲ 100 lines**

Run: `wc -l packages/runtime/src/adapter/provider.ts`
Expected: ~80–100 lines (was 168). If you accidentally left dead imports, clean them.

- [ ] **Step 5: Full regress check**

Run: `bun run typecheck && bun run test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/adapter/provider.ts \
        packages/runtime/src/adapter/provider/stream.ts
git commit -m "refactor(runtime): extract provider/stream.ts (I-1 split complete)"
```

---

## Task 10: `buildInitialPrompt` uses `defaultSystemPromptFor`

(Originally numbered Task 12. Moved earlier so the signature change happens before `trigger.ts` is rewritten.)

**Files:**
- Modify: `packages/runtime/src/orchestrator/spawn-agent.ts`
- Modify: `packages/runtime/test/orchestrator/spawn-agent.test.ts`

The existing signature is `buildInitialPrompt(role: RoleNode, userPrompt: string)`. We change it to take a `{ role: string; userPrompt: string }` object so the handler in Task 11 can call it without resolving a `RoleNode` reference.

- [ ] **Step 1: Update `buildInitialPrompt`**

```typescript
// packages/runtime/src/orchestrator/spawn-agent.ts
import type { RoleNode, WorkflowTemplate } from '@legion/core'
import { defaultSystemPromptFor } from '../adapter/role-prompts'

// firstRoleNode is removed in Task 11; keep it here until then.
export function firstRoleNode(template: WorkflowTemplate): RoleNode | null {
  const triggers = template.nodes.filter((n) => n.type === 'trigger').map((n) => n.id)
  for (const e of template.edges) {
    if (e.type !== 'triggers') continue
    if (!triggers.includes(e.from)) continue
    const target = template.nodes.find((n) => n.id === e.to)
    if (target && target.type === 'role') return target
  }
  const r = template.nodes.find((n) => n.type === 'role')
  return r && r.type === 'role' ? r : null
}

export function buildInitialPrompt(input: { role: string; userPrompt: string }): string {
  const sys = defaultSystemPromptFor(input.role)
  if (sys) return `${sys}\n\nTask: ${input.userPrompt}`
  return [
    `You are operating as the "${input.role}" role in a legion workflow.`,
    `Your task:`,
    input.userPrompt,
  ].join('\n\n')
}
```

- [ ] **Step 2: Update the existing call site in `trigger.ts`**

This is the only known caller. Edit `packages/runtime/src/orchestrator/trigger.ts:53`:

```typescript
// before
initialPrompt: buildInitialPrompt(role, input.userPrompt),
// after
initialPrompt: buildInitialPrompt({ role: role.role, userPrompt: input.userPrompt }),
```

- [ ] **Step 3: Update tests**

Read `packages/runtime/test/orchestrator/spawn-agent.test.ts` first. Replace any `buildInitialPrompt(roleNode, '...')` calls with the new shape, and add:

```typescript
test('buildInitialPrompt prepends the director system prompt', () => {
  const p = buildInitialPrompt({ role: 'director', userPrompt: 'do X' })
  expect(p).toContain('You are the Director agent')
  expect(p).toContain('Task: do X')
})

test('buildInitialPrompt prepends the implementer system prompt', () => {
  const p = buildInitialPrompt({ role: 'implementer', userPrompt: 'do Y' })
  expect(p).toContain('You are an Implementer agent')
})

test('buildInitialPrompt falls back to a generic line for unknown roles', () => {
  expect(buildInitialPrompt({ role: 'xyz', userPrompt: 'do Z' })).toContain('"xyz"')
})
```

- [ ] **Step 4: Run tests, verify pass**

Run: `bun test packages/runtime/test/orchestrator/spawn-agent.test.ts`
Expected: pass.

- [ ] **Step 5: Full regress check**

Run: `bun run typecheck && bun run test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/orchestrator/spawn-agent.ts \
        packages/runtime/test/orchestrator/spawn-agent.test.ts \
        packages/runtime/src/orchestrator/trigger.ts
git commit -m "feat(runtime): prepend role system prompt in buildInitialPrompt"
```

---

## Task 11: `DelegateToolHandler` — implementation and unit tests

**Files:**
- Create: `packages/runtime/test/orchestrator/delegate-tool.test.ts`
- Create: `packages/runtime/src/orchestrator/delegate-tool.ts`
- Modify: `packages/runtime/package.json`

- [ ] **Step 1: Add package export**

Edit `packages/runtime/package.json`. Inside `"exports"` add:

```json
"./orchestrator/delegate-tool": "./src/orchestrator/delegate-tool.ts",
```

- [ ] **Step 2: Extend `AgentInstanceStore` with `updateSessionId`**

Before writing the handler, expose a tiny update we will need. Edit `packages/runtime/src/store/agent-instance-store.ts` and add inside the class:

```typescript
updateSessionId(id: string, sessionId: string): void {
  this.db.run(`UPDATE agent_instances SET session_id = ? WHERE id = ?`, [sessionId, id])
}
```

And add a test in `packages/runtime/test/store/agent-instance-store.test.ts`:

```typescript
test('updateSessionId persists', () => {
  const { db, store } = freshStore()
  store.insert(row({ sessionId: 'placeholder' }))
  store.updateSessionId(row().id, 'real-session-id')
  expect(store.bySessionId('real-session-id')?.id).toBe(row().id)
  db.close()
})
```

Run: `bun test packages/runtime/test/store/agent-instance-store.test.ts`
Expected: 7 pass (6 existing + the new one).

- [ ] **Step 3: Write the failing handler test (uses `WorkspaceProvider.create`)**

```typescript
// packages/runtime/test/orchestrator/delegate-tool.test.ts
import { describe, test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  AgentInstanceStore,
  initAgentInstanceSchema,
} from '@legion/runtime/store/agent-instance-store'
import { initInstanceSchema } from '@legion/runtime/orchestrator/instance-store'
import { DelegateToolHandler } from '@legion/runtime/orchestrator/delegate-tool'
import type { AgentEvent, WorkflowTemplate } from '@legion/core'
import type {
  WorkspaceCreateInput,
  WorkspaceDescriptor,
  WorkspaceProvider,
} from '@legion/runtime/workspace/provider'

const TEMPLATE: WorkflowTemplate = {
  id: 'feature-implementation',
  name: 'F',
  nodes: [
    { type: 'trigger', id: 'trigger', kind: 'manual' },
    { type: 'role', id: 'director', role: 'director', provider: 'claude-code', lifetime: 'per-workflow' },
    { type: 'role', id: 'implementer', role: 'implementer', provider: 'claude-code', lifetime: 'per-task' },
  ],
  edges: [
    { from: 'trigger', to: 'director', type: 'triggers' },
    { from: 'director', to: 'implementer', type: 'delegates' },
  ],
}

function makeMocks() {
  const db = new Database(':memory:')
  initInstanceSchema(db)
  initAgentInstanceSchema(db)
  const store = new AgentInstanceStore(db)

  // Seed a Director row so the handler can look up its parent's roleNodeId.
  store.insert({
    id: 'dir-01',
    workflowInstanceId: 'wf-01',
    roleNodeId: 'director',
    sessionId: 'dir-sess',
    parentAgentInstanceId: null,
    spawnEdgeId: null,
    status: 'running',
    workspaceKind: 'owned',
    workspacePath: '/tmp/wt/director',
    branchName: null,
    startedAt: new Date(),
    endedAt: null,
  })

  const events: AgentEvent[] = []
  const eventLog = { write: (e: AgentEvent) => events.push(e) }

  const workspaceProvider: WorkspaceProvider = {
    create: async (input: WorkspaceCreateInput): Promise<WorkspaceDescriptor> => {
      const path = `/tmp/wt/${input.agentInstanceId}`
      const branch = `legion/wf-01/impl-${input.seq}`
      return { ref: { kind: 'owned', path, branch }, path }
    },
    destroy: async () => {},
    list: async () => [],
  }

  const provider = {
    launch: async (_req: unknown) => ({ sessionId: 'impl-sess-1' }),
    stream: async function* (_sid: string) {
      yield {
        id: 'evt-1',
        sessionId: 'impl-sess-1',
        type: 'message' as const,
        payload: { text: 'edited foo.ts and committed' },
        timestamp: new Date(),
      }
    },
    shutdown: async () => {},
  }

  return { db, store, eventLog, workspaceProvider, provider, events }
}

function makeHandler(m: ReturnType<typeof makeMocks>) {
  return new DelegateToolHandler({
    workflowInstanceId: 'wf-01',
    parentAgentInstanceId: 'dir-01',
    parentSessionId: 'dir-sess',
    agentInstanceStore: m.store,
    workspaceProvider: m.workspaceProvider,
    provider: m.provider as never,
    eventLog: m.eventLog as never,
    template: TEMPLATE,
    baseCommitSha: 'abc',
  })
}

describe('DelegateToolHandler', () => {
  test('inserts an agent_instance row with parent = Director and returns a result', async () => {
    const m = makeMocks()
    const out = await makeHandler(m).handle({ role: 'implementer', prompt: 'edit foo.ts' })

    expect(out.status).toBe('completed')
    expect(out.branchName).toMatch(/^legion\/wf-01\/impl-1$/)

    const rows = m.store.listByWorkflow('wf-01')
    const impl = rows.find((r) => r.roleNodeId === 'implementer')
    expect(impl).toBeDefined()
    expect(impl!.parentAgentInstanceId).toBe('dir-01')
    expect(impl!.spawnEdgeId).toBe('director→implementer')
    expect(impl!.workspaceKind).toBe('owned')
    expect(impl!.sessionId).toBe('impl-sess-1')
    expect(impl!.endedAt).not.toBeNull()
    m.db.close()
  })

  test('rejects roles not connected by a delegates edge', async () => {
    const m = makeMocks()
    await expect(makeHandler(m).handle({ role: 'reviewer', prompt: 'noop' })).rejects.toThrow(
      /no delegates edge/i,
    )
    m.db.close()
  })

  test('truncates summary to 500 chars', async () => {
    const m = makeMocks()
    m.provider.stream = async function* () {
      yield {
        id: 'evt-1',
        sessionId: 'impl-sess-1',
        type: 'message' as const,
        payload: { text: 'x'.repeat(2000) },
        timestamp: new Date(),
      }
    } as never
    const out = await makeHandler(m).handle({ role: 'implementer', prompt: 'p' })
    expect(out.summary.length).toBe(500)
    m.db.close()
  })
})
```

- [ ] **Step 4: Run test, verify failure**

Run: `bun test packages/runtime/test/orchestrator/delegate-tool.test.ts`
Expected: module-not-found.

- [ ] **Step 5: Implement the handler**

```typescript
// packages/runtime/src/orchestrator/delegate-tool.ts
// D-037, D-038: Director-facing delegate tool. Synchronous: returns only after
// the spawned agent's session has ended.

import { ulid } from 'ulid'
import type {
  AgentEvent,
  AgentProvider,
  DelegateToolInput,
  DelegateToolOutput,
  WorkflowTemplate,
} from '@legion/core'
import { defaultSystemPromptFor } from '../adapter/role-prompts'
import { resolveDelegateTargets } from './graph-walker'
import type { AgentInstanceStore } from '../store/agent-instance-store'
import type { WorkspaceProvider } from '../workspace/provider'

export interface EventLogWriter {
  write(evt: AgentEvent): void
}

export interface DelegateToolDeps {
  workflowInstanceId: string
  parentAgentInstanceId: string
  parentSessionId: string
  agentInstanceStore: AgentInstanceStore
  workspaceProvider: WorkspaceProvider
  provider: AgentProvider
  eventLog: EventLogWriter
  template: WorkflowTemplate
  baseCommitSha: string
}

const SUMMARY_MAX = 500

export class DelegateToolHandler {
  constructor(private readonly deps: DelegateToolDeps) {}

  async handle(input: DelegateToolInput): Promise<DelegateToolOutput> {
    const parentRow = this.deps.agentInstanceStore.byId(this.deps.parentAgentInstanceId)
    const fromRoleNodeId = parentRow?.roleNodeId ?? 'director'

    const targets = resolveDelegateTargets(this.deps.template, fromRoleNodeId)
    const target = targets.find((t) => t.roleName === input.role)
    if (!target) {
      throw new Error(
        `delegate: no delegates edge from '${fromRoleNodeId}' to role '${input.role}' in template`,
      )
    }

    const seq = this.nextSeqForRole(target.roleNodeId)
    const agentInstanceId = ulid()

    // Create worktree via the existing WorkspaceProvider API. The provider
    // derives the branch name internally; we read it back from the descriptor.
    const ws = await this.deps.workspaceProvider.create({
      workflowInstanceId: this.deps.workflowInstanceId,
      agentInstanceId,
      role: input.role,
      seq,
      baseCommitSha: this.deps.baseCommitSha,
    })
    const branchName =
      ws.ref.kind === 'owned' && 'branch' in ws.ref ? ws.ref.branch ?? null : null
    if (!branchName) {
      throw new Error(
        `delegate: workspace for role '${input.role}' must produce a branch (got --detach)`,
      )
    }

    this.deps.agentInstanceStore.insert({
      id: agentInstanceId,
      workflowInstanceId: this.deps.workflowInstanceId,
      roleNodeId: target.roleNodeId,
      sessionId: 'pending',
      parentAgentInstanceId: this.deps.parentAgentInstanceId,
      spawnEdgeId: `${fromRoleNodeId}→${target.roleNodeId}`,
      status: 'starting',
      workspaceKind: 'owned',
      workspacePath: ws.path,
      branchName,
      startedAt: new Date(),
      endedAt: null,
    })

    let summary = ''
    let status: 'completed' | 'failed' = 'completed'
    let error: string | undefined

    try {
      const handle = await this.deps.provider.launch({
        workdir: ws.path,
        role: input.role,
        initialPrompt: `${defaultSystemPromptFor(input.role)}\n\nTask: ${input.prompt}`,
      })
      this.deps.agentInstanceStore.updateSessionId(agentInstanceId, handle.sessionId)
      this.deps.agentInstanceStore.updateStatus(agentInstanceId, 'running')

      for await (const evt of this.deps.provider.stream(handle.sessionId)) {
        this.deps.eventLog.write(evt)
        if (evt.type === 'message') {
          const t = (evt.payload as { text?: string }).text
          if (typeof t === 'string') summary = t
        }
      }
    } catch (e) {
      status = 'failed'
      error = e instanceof Error ? e.message : String(e)
    } finally {
      this.deps.agentInstanceStore.setEndedAt(agentInstanceId, new Date())
      this.deps.agentInstanceStore.updateStatus(
        agentInstanceId,
        status === 'completed' ? 'completed' : 'failed',
      )
    }

    return {
      agentInstanceId,
      branchName,
      status,
      summary: summary.slice(0, SUMMARY_MAX),
      ...(error !== undefined ? { error } : {}),
    }
  }

  private nextSeqForRole(roleNodeId: string): number {
    const rows = this.deps.agentInstanceStore.listByWorkflow(this.deps.workflowInstanceId)
    return rows.filter((r) => r.roleNodeId === roleNodeId).length + 1
  }
}
```

- [ ] **Step 6: Run tests, verify pass**

Run: `bun test packages/runtime/test/orchestrator/delegate-tool.test.ts packages/runtime/test/store/agent-instance-store.test.ts`
Expected: 3 delegate tests + 7 store tests pass.

- [ ] **Step 7: Full regress check**

Run: `bun run typecheck && bun run test`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add packages/runtime/src/orchestrator/delegate-tool.ts \
        packages/runtime/src/store/agent-instance-store.ts \
        packages/runtime/test/orchestrator/delegate-tool.test.ts \
        packages/runtime/test/store/agent-instance-store.test.ts \
        packages/runtime/package.json
git commit -m "feat(runtime): add DelegateToolHandler (Director->Implementer spawn)"
```

---

## Task 12: Rewrite `trigger.ts` — graph walker + `agent_instances` row for Director + delegate tool injection

**Files:**
- Modify: `packages/runtime/src/orchestrator/trigger.ts`
- Modify: `packages/runtime/test/orchestrator/trigger.test.ts`

This task wires Director spawning through the new walker, persists Director into `agent_instances`, and injects `DelegateToolHandler` as `customTools` so the Director can call `delegate`.

- [ ] **Step 1: Read the current trigger.ts and tests**

```bash
cat packages/runtime/src/orchestrator/trigger.ts
cat packages/runtime/test/orchestrator/trigger.test.ts
```

Take note of:

- The shape of `TriggerInput` (uses `workspaceProvider`, `adapter`, `instanceStore`, `eventLog` — NOT a unified `ctx`)
- How `firstRoleNode` is currently called
- How `drainStream` is structured
- Existing test fixtures

- [ ] **Step 2: Extend `TriggerInput`**

Add `agentInstanceStore: AgentInstanceStore` to the `TriggerInput` interface:

```typescript
import type { AgentInstanceStore } from '../store/agent-instance-store'

export interface TriggerInput {
  template: WorkflowTemplate
  userPrompt: string
  repoPath: string
  baseRef: string
  workspaceProvider: WorkspaceProvider
  adapter: AgentProvider
  instanceStore: InstanceStore
  agentInstanceStore: AgentInstanceStore   // ★ new
  eventLog: EventLog
}
```

- [ ] **Step 3: Replace `firstRoleNode` with `resolveTriggerTargets[0]`**

Edit the top of `triggerWorkflow`:

```typescript
import { resolveTriggerTargets } from './graph-walker'

export async function triggerWorkflow(input: TriggerInput): Promise<TriggerResult> {
  const triggerTargets = resolveTriggerTargets(input.template)
  if (triggerTargets.length === 0) {
    throw new Error(`template ${input.template.id} has no triggers→role edge`)
  }
  const directorNode = triggerTargets[0]!

  const baseCommitSha = await resolveCommitSha(input.repoPath, input.baseRef)
  const instance = input.instanceStore.create({
    templateId: input.template.id,
    templateSnapshot: input.template,
    baseCommitSha,
  })
```

(Remove the old `firstRoleNode(input.template)` call entirely.)

- [ ] **Step 4: Create the Director worktree using the existing `WorkspaceProvider.create` API**

The existing `LocalWorktreeProvider` already auto-detaches when `role === 'director' | 'reviewer'` (see `DETACHED_ROLES` in [packages/runtime/src/workspace/local-worktree-provider.ts](../../../packages/runtime/src/workspace/local-worktree-provider.ts)). No new API needed — just call `create`:

```typescript
import { ulid } from 'ulid'

const directorAgentInstanceId = ulid()
const directorWs = await input.workspaceProvider.create({
  workflowInstanceId: instance.id,
  agentInstanceId: directorAgentInstanceId,
  role: directorNode.role,
  seq: 1,
  baseCommitSha,
})
// Director worktree is --detach, so ws.ref has no branch field.
const directorBranch =
  directorWs.ref.kind === 'owned' && 'branch' in directorWs.ref ? directorWs.ref.branch ?? null : null
```

- [ ] **Step 5: Insert the Director row into `agent_instances`**

```typescript
input.agentInstanceStore.insert({
  id: directorAgentInstanceId,
  workflowInstanceId: instance.id,
  roleNodeId: directorNode.id,
  sessionId: 'pending',
  parentAgentInstanceId: null,
  spawnEdgeId: null,
  status: 'starting',
  workspaceKind: 'owned',
  workspacePath: directorWs.path,
  branchName: directorBranch,        // null for Director
  startedAt: new Date(),
  endedAt: null,
})
```

- [ ] **Step 6: Run setup hooks and build the delegate tool**

Keep the existing `.legion.yaml` setup hook block in place, then build the handler:

```typescript
import { DelegateToolHandler } from './delegate-tool'

const config = await loadLegionConfig(input.repoPath)
await runWorktreeSetup({
  mainRepoPath: input.repoPath,
  worktreePath: directorWs.path,
  config,
})

const delegateHandler = new DelegateToolHandler({
  workflowInstanceId: instance.id,
  parentAgentInstanceId: directorAgentInstanceId,
  parentSessionId: 'pending',   // filled in after launch returns
  agentInstanceStore: input.agentInstanceStore,
  workspaceProvider: input.workspaceProvider,
  provider: input.adapter,
  eventLog: { write: (evt) => input.eventLog.append(instance.id, evt) },
  template: input.template,
  baseCommitSha,
})

const customTools = [
  {
    name: 'mcp__legion__delegate',
    description:
      'Spawn an Implementer agent and wait for it to finish. Returns { agentInstanceId, branchName, status, summary }.',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string' },
        prompt: { type: 'string' },
        rationale: { type: 'string' },
      },
      required: ['role', 'prompt'],
    },
    handler: (toolInput: unknown) => delegateHandler.handle(toolInput as never),
  },
]
```

The `eventLog: { write: ... }` adapter is needed because `EventLog.append(workflowInstanceId, evt)` takes two args while `DelegateToolHandler` expects a `write(evt)` shape (see Task 11's `EventLogWriter` interface). This adapter binds the workflow id at construction time.

- [ ] **Step 7: Launch Director with `customTools`**

```typescript
const handle = await input.adapter.launch({
  workdir: directorWs.path,
  role: directorNode.role,
  initialPrompt: buildInitialPrompt({ role: directorNode.role, userPrompt: input.userPrompt }),
  customTools,
})

input.agentInstanceStore.updateSessionId(directorAgentInstanceId, handle.sessionId)
input.agentInstanceStore.updateStatus(directorAgentInstanceId, 'running')
```

- [ ] **Step 8: Update `drainStream` to mark Director ended**

Edit the `drainStream` helper (or merge it into the main body — your call). After the `for await` loop ends, append the close-out:

```typescript
async function drainStream(
  input: TriggerInput,
  workflowInstanceId: string,
  directorAgentInstanceId: string,
  sessionId: string,
): Promise<void> {
  try {
    for await (const evt of input.adapter.stream(sessionId)) {
      input.eventLog.append(workflowInstanceId, evt)
      if (evt.type === 'status_change') {
        const status = (evt.payload as { status?: string }).status
        if (status === 'completed')
          input.instanceStore.updateStatus(workflowInstanceId, 'completed')
        if (status === 'failed')
          input.instanceStore.updateStatus(workflowInstanceId, 'failed')
      }
    }
    input.agentInstanceStore.setEndedAt(directorAgentInstanceId, new Date())
    input.agentInstanceStore.updateStatus(directorAgentInstanceId, 'completed')
  } catch (err) {
    input.eventLog.append(workflowInstanceId, {
      id: ulid(),
      sessionId,
      type: 'error',
      payload: { message: (err as Error).message },
      timestamp: new Date(),
    })
    input.instanceStore.updateStatus(workflowInstanceId, 'failed')
    input.agentInstanceStore.setEndedAt(directorAgentInstanceId, new Date())
    input.agentInstanceStore.updateStatus(directorAgentInstanceId, 'failed')
  }
}
```

And update the call site:

```typescript
void drainStream(input, instance.id, directorAgentInstanceId, handle.sessionId)
return { workflowInstanceId: instance.id, sessionId: handle.sessionId }
```

- [ ] **Step 9: Update `trigger.test.ts`**

The existing test setup needs an `AgentInstanceStore` instance. Add to the test fixture:

```typescript
import {
  AgentInstanceStore,
  initAgentInstanceSchema,
} from '@legion/runtime/store/agent-instance-store'

// In your test setup helper:
initAgentInstanceSchema(db)
const agentInstanceStore = new AgentInstanceStore(db)

// Add agentInstanceStore to every triggerWorkflow call:
await triggerWorkflow({
  // ... existing fields ...
  agentInstanceStore,
})
```

Update any test that depended on `firstRoleNode`'s doc-order fallback (the new `resolveTriggerTargets` requires an explicit `triggers` edge — tests that lacked one will throw "no triggers→role edge").

Add a new test:

```typescript
test('triggerWorkflow persists Director into agent_instances', async () => {
  // ... arrange a template with trigger→director edge ...
  const result = await triggerWorkflow({ /* with agentInstanceStore */ })
  // Wait briefly for the background stream to settle (or use a mock adapter that resolves immediately).
  const rows = agentInstanceStore.listByWorkflow(result.workflowInstanceId)
  expect(rows).toHaveLength(1)
  expect(rows[0]!.roleNodeId).toBe('director')
  expect(rows[0]!.parentAgentInstanceId).toBeNull()
})
```

- [ ] **Step 10: Run trigger tests, verify pass**

Run: `bun test packages/runtime/test/orchestrator/trigger.test.ts`
Expected: pass.

- [ ] **Step 11: Full regress check**

Run: `bun run typecheck && bun run test`
Expected: typecheck green; total tests still pass. Server tests under `packages/server` will fail because `handleWorkflowsTrigger` does not pass `agentInstanceStore`. That is intentional — a02 Task 2 fixes them. To unblock the regress run, temporarily make `agentInstanceStore` optional in `TriggerInput` and gate the new code with `if (input.agentInstanceStore)`. **Remove this temporary optional in a02 once the server side is updated.**

Alternative: stop here and run only the runtime tests (`bun test packages/runtime/`), accepting that the cross-package check is deferred to a02.

- [ ] **Step 12: Commit**

```bash
git add packages/runtime/src/orchestrator/trigger.ts \
        packages/runtime/test/orchestrator/trigger.test.ts
git commit -m "feat(runtime): wire graph-walker, agent_instances, and DelegateToolHandler into triggerWorkflow"
```

---

## Task 13: Drop dead `SINGLETON_ROLES` branch in `branch-naming.ts` (I-4)

**Files:**
- Modify: `packages/runtime/src/workspace/branch-naming.ts`

- [ ] **Step 1: Read the file**

```bash
cat packages/runtime/src/workspace/branch-naming.ts
```

Identify the `SINGLETON_ROLES` constant and the `if`/`else` branch that uses it. Verify nothing in the codebase still depends on it.

- [ ] **Step 2: Grep for any caller**

Run the Grep tool (or `rg`) for `SINGLETON_ROLES` across the repo. Expected: no usage outside `branch-naming.ts` itself.

- [ ] **Step 3: Delete the dead branch and the constant**

Remove the `if (SINGLETON_ROLES.includes(role))` block and the `SINGLETON_ROLES` declaration. The remaining branch becomes the unconditional path.

- [ ] **Step 4: Run tests, verify pass**

Run: `bun test packages/runtime/test/workspace/`
Expected: all branch-naming tests still pass.

- [ ] **Step 5: Full regress check**

Run: `bun run typecheck && bun run test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/workspace/branch-naming.ts
git commit -m "refactor(runtime): remove dead SINGLETON_ROLES branch (I-4)"
```

---

## Wrap-up

- [ ] **Final regress check**

Run: `bun run typecheck && bun run test`
Expected: typecheck green; total tests `≥ 145 pass / 1 skip / 0 fail`.

- [ ] **Log line counts vs predictions**

The spec § 11 predicted:
- `agent-instance-store.ts` ≈ 120 lines (actual: run `wc -l` and compare)
- `graph-walker.ts` ≈ 80 lines
- `delegate-tool.ts` ≈ 140 lines
- `role-prompts.ts` ≈ 80 lines
- `provider.ts` ≈ 80 lines after split

Record actuals in the project's plan-vs-actual tracking file if one exists (Phase 1 plans have a `実測との突合` section; consider adding one here too).

- [ ] **Branch state check**

```bash
git log --oneline main..HEAD
```

Expected: 13 commits since pre-flight (one per task).

- [ ] **Next plan handoff**

Phase 2 a02 (server changes) depends on the types and stores from this plan. Open `docs/dev/plans/2026-05-14_phase2_a02_server.md` next.

---

*If you hit a blocker, do NOT skip a TDD step. Stop, diagnose, and update this plan if the design needs revision. The "spec said X, impl did Y" lesson from the Phase 1 smoke discoveries applies here too.*
