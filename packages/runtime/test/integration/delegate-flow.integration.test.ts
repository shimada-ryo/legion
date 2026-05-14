// packages/runtime/test/integration/delegate-flow.integration.test.ts
import { describe, test, expect } from 'bun:test'
import { $ } from 'bun'
import { Database } from 'bun:sqlite'
import { query } from '@anthropic-ai/claude-agent-sdk'
import {
  InstanceStore,
  initInstanceSchema,
} from '@legion/runtime/orchestrator/instance-store'
import {
  AgentInstanceStore,
  initAgentInstanceSchema,
} from '@legion/runtime/store/agent-instance-store'
import { BlackboardStore } from '@legion/runtime/store/blackboard-store'
import { EventLog } from '@legion/runtime/eventlog/eventlog'
import { initEventLogSchema } from '@legion/runtime/eventlog/schema'
import { LocalWorktreeProvider } from '@legion/runtime/workspace/local-worktree-provider'
import { ClaudeCodeAgentSDKProvider } from '@legion/runtime/adapter/provider'
import { triggerWorkflow } from '@legion/runtime/orchestrator/trigger'
import { loadWorkflowTemplate } from '@legion/runtime/template/loader'
import { makeScratchRepo } from './fixtures/scratch-repo'

const HAS_AUTH =
  !!process.env['ANTHROPIC_API_KEY'] || !!process.env['CLAUDE_CODE_OAUTH_TOKEN']

async function awaitWorkflow(
  store: InstanceStore,
  wfId: string,
  timeoutMs: number,
): Promise<'completed' | 'failed'> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const s = store.get(wfId)?.status
    if (s === 'completed' || s === 'failed') return s
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`timed out after ${timeoutMs}ms; last status: ${store.get(wfId)?.status}`)
}

describe.skipIf(!HAS_AUTH)('Phase 2 delegate flow (real SDK)', () => {
  test(
    'Director calls delegate, Implementer commits, agent_instances has two rows',
    async () => {
      // NOTE: This test consumes real Anthropic API budget when run with auth.
      // Default-model cost; a few cents per run for the tiny prompt below.
      const repo = await makeScratchRepo()
      try {
        const db = new Database(':memory:')
        initInstanceSchema(db)
        initAgentInstanceSchema(db)
        initEventLogSchema(db)

        const store = new InstanceStore(db)
        const agentStore = new AgentInstanceStore(db)
        const log = new EventLog(db)
        const blackboard = new BlackboardStore(db)
        blackboard.initSchema()
        const worktree = new LocalWorktreeProvider({
          repoPath: repo.path,
          baseDir: `${repo.path}/.legion-worktrees`,
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const adapter = new ClaudeCodeAgentSDKProvider({ query: query as any })
        const template = await loadWorkflowTemplate(`${repo.path}/workflows/bug-fix.yaml`)

        const { workflowInstanceId } = await triggerWorkflow({
          template,
          userPrompt:
            'Append a single line "## smoke" to README.md and commit. Use the Implementer to do the edit.',
          repoPath: repo.path,
          baseRef: 'HEAD',
          workspaceProvider: worktree,
          adapter,
          instanceStore: store,
          agentInstanceStore: agentStore,
          eventLog: log,
          blackboardStore: blackboard,
        })

        const finalStatus = await awaitWorkflow(store, workflowInstanceId, 170_000)
        expect(finalStatus).toBe('completed')

        const rows = agentStore.listByWorkflow(workflowInstanceId)
        expect(rows.length).toBeGreaterThanOrEqual(2)

        const director = rows.find((r) => r.roleNodeId === 'director')
        const implementer = rows.find((r) => r.roleNodeId === 'implementer')
        expect(director).toBeDefined()
        expect(implementer).toBeDefined()
        expect(implementer!.parentAgentInstanceId).toBe(director!.id)
        expect(implementer!.branchName).toBeTruthy()

        // Verify Implementer actually committed on its branch.
        const branch = implementer!.branchName as string
        const log1 = await $`git log --oneline ${branch}`.cwd(repo.path).quiet().nothrow()
        expect(log1.exitCode).toBe(0)
        const lines = log1.stdout.toString().trim().split('\n')
        expect(lines.length).toBeGreaterThanOrEqual(2) // initial + ≥1 Implementer commit
      } finally {
        await repo.cleanup()
      }
    },
    { timeout: 180_000 }, // real SDK calls, allow 3 minutes (poll has 170s budget; some slack for cleanup)
  )
})
