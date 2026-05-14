import { describe, test, expect } from 'bun:test'
import { ulid } from 'ulid'
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

// Mock: WorkspaceProvider for DelegateToolHandler unit tests
// representing:    @legion/runtime WorkspaceProvider interface (legion internal)
// verified on:     2026-05-14, by review of packages/runtime/src/workspace/provider.ts
// invalidated when: WorkspaceProvider.create() signature changes (esp. WorkspaceCreateInput shape)
// contract test:   packages/runtime/test/workspace/local-worktree-provider.test.ts (real git)
function createMockWorkspaceProvider(): WorkspaceProvider & { lastCreateInput: WorkspaceCreateInput | undefined } {
  return {
    lastCreateInput: undefined as WorkspaceCreateInput | undefined,
    async create(input: WorkspaceCreateInput): Promise<WorkspaceDescriptor> {
      this.lastCreateInput = input
      const path = `/tmp/wt/${input.agentInstanceId}`
      const branch = `legion/wf-01/impl-${input.seq}`
      return { ref: { kind: 'owned', path, branch }, path }
    },
    async destroy() {},
    async list() { return [] },
  }
}

// Mock: AgentProvider for DelegateToolHandler unit tests
// representing:    @legion/core AgentProvider interface (legion internal protocol)
// verified on:     2026-05-14, by review of packages/core/src/types/agent-provider.ts
// invalidated when: AgentProvider interface adds new methods or changes capabilities shape
// contract test:   packages/runtime/test/integration/delegate-flow.integration.test.ts (Phase 2),
//                  packages/runtime/test/integration/delegate-flow-review.integration.test.ts (Phase 3 a06)
function createMockProvider(opts?: { summary?: string }) {
  const summary = opts?.summary ?? 'edited foo.ts and committed'
  return {
    launch: async (_req: unknown) => ({ sessionId: 'impl-sess-1' }),
    stream: async function* (_sid: string) {
      yield {
        id: 'evt-1',
        sessionId: 'impl-sess-1',
        type: 'message' as const,
        payload: { text: summary },
        timestamp: new Date(),
      }
    },
    shutdown: async () => {},
  }
}

// Mock: AgentProvider that captures the last LaunchRequest for outputSchema inspection
// representing:    @legion/core AgentProvider interface (legion internal protocol)
// verified on:     2026-05-14, by review of packages/core/src/types/agent-provider.ts
// invalidated when: LaunchRequest interface changes (esp. outputSchema field removed or renamed)
// contract test:   packages/runtime/test/integration/delegate-flow-review.integration.test.ts (Phase 3 a06)
function createCapturingProvider(opts?: { summary?: string }) {
  const summary = opts?.summary ?? 'edited foo.ts and committed'
  const provider = {
    lastLaunchRequest: undefined as unknown | undefined,
    launch: async (req: unknown) => {
      provider.lastLaunchRequest = req
      return { sessionId: 'rev-sess-1' }
    },
    stream: async function* (_sid: string) {
      yield {
        id: 'evt-1',
        sessionId: 'rev-sess-1',
        type: 'message' as const,
        payload: { text: summary },
        timestamp: new Date(),
      }
    },
    shutdown: async () => {},
  }
  return provider
}

function stubEventLog() {
  const events: AgentEvent[] = []
  return { write: (e: AgentEvent) => events.push(e) }
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

  const workspaceProvider = createMockWorkspaceProvider()
  const provider = createMockProvider()

  return { db, store, eventLog, workspaceProvider, provider, events }
}

function makeHandler(m: ReturnType<typeof makeMocks>) {
  return new DelegateToolHandler({
    workflowInstanceId: 'wf-01',
    parentAgentInstanceId: 'dir-01',
    agentInstanceStore: m.store,
    workspaceProvider: m.workspaceProvider,
    provider: m.provider as never,
    eventLog: m.eventLog as never,
    template: TEMPLATE,
    baseCommitSha: 'abc',
  })
}

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

  test('resolves reviewTargetBranch from caller agent_instance when edge type is reviews', async () => {
    const db = new Database(':memory:')
    initInstanceSchema(db)
    initAgentInstanceSchema(db)
    const agentInstanceStore = new AgentInstanceStore(db)

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
      endedAt: null,
    })

    const workspaceProvider = createMockWorkspaceProvider()
    const handler = new DelegateToolHandler({
      workflowInstanceId: 'wf-1',
      parentAgentInstanceId: implId,
      agentInstanceStore,
      workspaceProvider,
      provider: createMockProvider({ summary: 'reviewed' }) as never,
      eventLog: stubEventLog() as never,
      template: templateWithReviewsEdge(),
      baseCommitSha: 'base-sha',
    })

    await handler.handle({ role: 'reviewer', prompt: 'review please' })

    expect(workspaceProvider.lastCreateInput).toMatchObject({
      role: 'reviewer',
      reviewTargetBranch: 'legion/wf-1/impl-1',
      baseCommitSha: 'base-sha',
    })

    db.close()
  })

  test('throws when reviews edge caller has no branchName', async () => {
    const db = new Database(':memory:')
    initInstanceSchema(db)
    initAgentInstanceSchema(db)
    const agentInstanceStore = new AgentInstanceStore(db)

    const implId = ulid()
    agentInstanceStore.insert({
      id: implId,
      workflowInstanceId: 'wf-1',
      roleNodeId: 'implementer',
      sessionId: 'sess-implementer',
      parentAgentInstanceId: null,
      spawnEdgeId: null,
      status: 'running',
      workspaceKind: 'owned',
      workspacePath: '/tmp/wt1',
      branchName: null,  // no branch — should cause error
      startedAt: new Date(),
      endedAt: null,
    })

    const workspaceProvider = createMockWorkspaceProvider()
    const handler = new DelegateToolHandler({
      workflowInstanceId: 'wf-1',
      parentAgentInstanceId: implId,
      agentInstanceStore,
      workspaceProvider,
      provider: createMockProvider() as never,
      eventLog: stubEventLog() as never,
      template: templateWithReviewsEdge(),
      baseCommitSha: 'base-sha',
    })

    await expect(handler.handle({ role: 'reviewer', prompt: 'review please' })).rejects.toThrow(
      /no branchName/i,
    )

    db.close()
  })

  test('passes outputSchema to provider.launch when delegating to reviewer', async () => {
    const db = new Database(':memory:')
    initInstanceSchema(db)
    initAgentInstanceSchema(db)
    const agentInstanceStore = new AgentInstanceStore(db)

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
      endedAt: null,
    })

    const provider = createCapturingProvider()
    const handler = new DelegateToolHandler({
      workflowInstanceId: 'wf-1',
      parentAgentInstanceId: implId,
      agentInstanceStore,
      workspaceProvider: createMockWorkspaceProvider(),
      provider: provider as never,
      eventLog: stubEventLog() as never,
      template: templateWithReviewsEdge(),
      baseCommitSha: 'base-sha',
    })

    await handler.handle({ role: 'reviewer', prompt: 'review please' })

    expect(provider.lastLaunchRequest).toBeDefined()
    expect((provider.lastLaunchRequest as any).outputSchema).toBeDefined()
    expect((provider.lastLaunchRequest as any).outputSchema.required).toContain('decision')

    db.close()
  })

  test('parses decision/feedback/notes from final assistant_message when role=reviewer', async () => {
    const db = new Database(':memory:')
    initInstanceSchema(db)
    initAgentInstanceSchema(db)
    const agentInstanceStore = new AgentInstanceStore(db)

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
      endedAt: null,
    })

    const provider = createCapturingProvider({
      summary: 'free-form notes\n\n```json\n{"decision":"request-changes","feedback":"fix the typo","notes":"some context"}\n```',
    })
    const handler = new DelegateToolHandler({
      workflowInstanceId: 'wf-1',
      parentAgentInstanceId: implId,
      agentInstanceStore,
      workspaceProvider: createMockWorkspaceProvider(),
      provider: provider as never,
      eventLog: stubEventLog() as never,
      template: templateWithReviewsEdge(),
      baseCommitSha: 'base-sha',
    })

    const out = await handler.handle({ role: 'reviewer', prompt: 'review please' })

    expect(out.decision).toBe('request-changes')
    expect(out.feedback).toBe('fix the typo')
    expect(out.summary).not.toContain('```json')

    db.close()
  })

  test('handles malformed JSON gracefully (decision=undefined, status=completed)', async () => {
    const db = new Database(':memory:')
    initInstanceSchema(db)
    initAgentInstanceSchema(db)
    const agentInstanceStore = new AgentInstanceStore(db)

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
      endedAt: null,
    })

    const provider = createCapturingProvider({ summary: 'not even json' })
    const handler = new DelegateToolHandler({
      workflowInstanceId: 'wf-1',
      parentAgentInstanceId: implId,
      agentInstanceStore,
      workspaceProvider: createMockWorkspaceProvider(),
      provider: provider as never,
      eventLog: stubEventLog() as never,
      template: templateWithReviewsEdge(),
      baseCommitSha: 'base-sha',
    })

    const out = await handler.handle({ role: 'reviewer', prompt: 'review please' })

    expect(out.decision).toBeUndefined()
    expect(out.status).toBe('completed')
    expect(out.summary).toBe('not even json')

    db.close()
  })
})
