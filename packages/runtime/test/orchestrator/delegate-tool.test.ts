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
