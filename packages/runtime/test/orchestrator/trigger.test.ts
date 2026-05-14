import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { makeTempRepo, type TempRepo } from '../helpers/temp-repo'
import { LocalWorktreeProvider } from '@legion/runtime/workspace/local-worktree-provider'
import { ClaudeCodeAgentSDKProvider } from '@legion/runtime/adapter/provider'
import { initEventLogSchema } from '@legion/runtime/eventlog/schema'
import { EventLog } from '@legion/runtime/eventlog/eventlog'
import {
  InstanceStore,
  initInstanceSchema,
} from '@legion/runtime/orchestrator/instance-store'
import {
  AgentInstanceStore,
  initAgentInstanceSchema,
} from '@legion/runtime/store/agent-instance-store'
import { BlackboardStore } from '@legion/runtime/store/blackboard-store'
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

const DIRECTOR_TEMPLATE: WorkflowTemplate = {
  id: 'echo-director',
  name: 'Echo Director',
  nodes: [
    { type: 'trigger', id: 'trig', kind: 'manual' },
    {
      type: 'role',
      id: 'director',
      role: 'director',
      provider: 'claude-code',
      lifetime: 'per-workflow',
    },
  ],
  edges: [{ from: 'trig', to: 'director', type: 'triggers' }],
}

let repo: TempRepo
let baseDir: string
let db: Database
let blackboard: BlackboardStore

beforeEach(async () => {
  repo = await makeTempRepo()
  baseDir = await mkdtemp(join(tmpdir(), 'legion-trig-'))
  db = new Database(':memory:')
  initEventLogSchema(db)
  initInstanceSchema(db)
  initAgentInstanceSchema(db)
  blackboard = new BlackboardStore(db)
  blackboard.initSchema()
})

afterEach(async () => {
  db.close()
  await rm(baseDir, { recursive: true, force: true })
  await repo.cleanup()
})

describe('triggerWorkflow', () => {
  test('creates an instance, creates a worktree, spawns one agent, and pipes events to event log', async () => {
    const wt = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const queryMock = (input: any): AsyncIterable<unknown> => {
      expect(input.options.cwd).toBeDefined()
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'x', model: 'm' }
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'done' }] },
        }
        yield { type: 'result', subtype: 'success' }
      })()
    }
    const adapter = new ClaudeCodeAgentSDKProvider({ query: queryMock })
    const store = new InstanceStore(db)
    const agentInstanceStore = new AgentInstanceStore(db)
    const log = new EventLog(db)
    const result = await triggerWorkflow({
      template: TEMPLATE,
      userPrompt: 'echo this',
      repoPath: repo.path,
      baseRef: 'HEAD',
      workspaceProvider: wt,
      providersByName: new Map([['claude-code', adapter]]),
      instanceStore: store,
      agentInstanceStore,
      eventLog: log,
      blackboardStore: blackboard,
    })
    expect(result.workflowInstanceId).toBeDefined()
    expect(result.sessionId).toBeDefined()
    // Wait for the streaming consumer to drain
    await new Promise((r) => setTimeout(r, 50))
    const history = log.history(result.workflowInstanceId)
    expect(history.length).toBeGreaterThanOrEqual(2) // init + message at minimum
    expect(history.some((e) => e.type === 'message')).toBe(true)
    expect(store.get(result.workflowInstanceId)?.status).toBe('completed')
  })

  test('runs .legion.yaml setup hook after creating worktree', async () => {
    // write a .legion.yaml to repo
    await Bun.write(
      join(repo.path, '.legion.yaml'),
      'worktree:\n  setup:\n    - echo hello > setup-marker.txt\n',
    )
    // commit it (worktrees need a clean ref)
    const { $ } = await import('bun')
    await $`git add .legion.yaml`.cwd(repo.path).quiet()
    await $`git commit -m legion-config`.cwd(repo.path).quiet()
    const wt = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const queryMock = (): AsyncIterable<unknown> =>
      (async function* () {
        yield { type: 'result', subtype: 'success' }
      })()
    const adapter = new ClaudeCodeAgentSDKProvider({ query: queryMock })
    const store = new InstanceStore(db)
    const agentInstanceStore = new AgentInstanceStore(db)
    const log = new EventLog(db)
    const result = await triggerWorkflow({
      template: TEMPLATE,
      userPrompt: 'x',
      repoPath: repo.path,
      baseRef: 'HEAD',
      workspaceProvider: wt,
      providersByName: new Map([['claude-code', adapter]]),
      instanceStore: store,
      agentInstanceStore,
      eventLog: log,
      blackboardStore: blackboard,
    })
    await new Promise((r) => setTimeout(r, 50))
    // The worktree path is the per-instance directory; marker should be there
    const worktreePath = (await wt.list(result.workflowInstanceId))[0]?.path
    expect(worktreePath).toBeDefined()
    const marker = await readFile(join(worktreePath!, 'setup-marker.txt'), 'utf-8')
    expect(marker.trim()).toBe('hello')
  })

  test('persists Director into agent_instances', async () => {
    const wt = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const queryMock = (): AsyncIterable<unknown> =>
      (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'm' }
        yield { type: 'result', subtype: 'success' }
      })()
    const adapter = new ClaudeCodeAgentSDKProvider({ query: queryMock })
    const store = new InstanceStore(db)
    const agentInstanceStore = new AgentInstanceStore(db)
    const log = new EventLog(db)
    const result = await triggerWorkflow({
      template: DIRECTOR_TEMPLATE,
      userPrompt: 'do work',
      repoPath: repo.path,
      baseRef: 'HEAD',
      workspaceProvider: wt,
      providersByName: new Map([['claude-code', adapter]]),
      instanceStore: store,
      agentInstanceStore,
      eventLog: log,
      blackboardStore: blackboard,
    })
    // Wait for the streaming consumer to drain
    await new Promise((r) => setTimeout(r, 50))
    const rows = agentInstanceStore.listByWorkflow(result.workflowInstanceId)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.roleNodeId).toBe('director')
    expect(rows[0]!.parentAgentInstanceId).toBeNull()
    expect(rows[0]!.spawnEdgeId).toBeNull()
    expect(rows[0]!.workspaceKind).toBe('owned')
    // Director worktree is --detach, so branchName must be null.
    expect(rows[0]!.branchName).toBeNull()
    expect(rows[0]!.endedAt).not.toBeNull()
  })
})
