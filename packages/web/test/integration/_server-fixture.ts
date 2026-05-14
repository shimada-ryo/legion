// Subprocess fixture for DiffTab ↔ server integration test.
// Pre-seeds a workflow + branched Implementer, prints "PORT=N WFID=X" once,
// then waits for SIGTERM. Runs in a clean Bun process — no happy-dom pollution.

import { Database } from 'bun:sqlite'
import { join, resolve } from 'node:path'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { $ } from 'bun'
import { startApp } from '@legion/server/app'
import { TemplateRegistry } from '@legion/runtime/template/registry'
import { initEventLogSchema } from '@legion/runtime/eventlog/schema'
import { initInstanceSchema } from '@legion/runtime/orchestrator/instance-store'
import type { AgentProvider } from '@legion/core'

const REPO_ROOT = resolve(import.meta.dir, '../../../..')

function makeMockAdapter(): AgentProvider {
  return {
    id: 'claude-code',
    displayName: 'mock',
    capabilities: {
      supportsCheckpoint: false,
      supportsResume: false,
      supportsAttach: false,
      supportsApprovalFlow: false,
    },
    detect: async () => ({ installed: true }),
    authenticate: async () => ({ authenticated: true }),
    launch: async () => ({ sessionId: 'sess-fixture' }),
    stream: async function* () {
      yield {
        id: 'evt-1',
        sessionId: 'sess-fixture',
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
  }
}

async function makeTempRepo(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), 'legion-fixture-'))
  await $`git init -b main`.cwd(path).quiet()
  await $`git config user.email test@legion.local`.cwd(path).quiet()
  await $`git config user.name "legion test"`.cwd(path).quiet()
  await writeFile(join(path, 'README.md'), '# scratch\n')
  await $`git add README.md`.cwd(path).quiet()
  await $`git commit -m "initial"`.cwd(path).quiet()
  return { path, cleanup: async () => rm(path, { recursive: true, force: true }) }
}

async function main(): Promise<void> {
  const repo = await makeTempRepo()
  const baseDir = await mkdtemp(join(tmpdir(), 'legion-fixture-wt-'))
  const db = new Database(':memory:')
  initEventLogSchema(db)
  initInstanceSchema(db)
  const templates = new TemplateRegistry(join(REPO_ROOT, 'workflows'))
  await templates.refresh()
  const server = await startApp({
    port: 0,
    db,
    templates,
    repoPath: repo.path,
    worktreeBaseDir: baseDir,
    adapterFactory: () => makeMockAdapter(),
  })

  // Trigger a workflow so a real workflow_instance exists.
  const trig = await fetch(`http://localhost:${server.port}/api/workflows/trigger`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ templateId: 'feature-implementation', userPrompt: 'fixture' }),
  })
  if (trig.status !== 202) {
    process.stderr.write(`fixture: trigger failed status=${trig.status}\n`)
    process.exit(1)
  }
  const { workflowInstanceId } = (await trig.json()) as { workflowInstanceId: string }

  // Pre-seed two synthetic Implementers with distinct branches and distinct
  // diffs. The integration test will click ONE button and verify that ONLY
  // that entry's diff body becomes visible — this exercises the per-entry
  // state keying. A bug that uses an undefined field as the key collapses
  // both entries' state to the same slot.
  server.runtime.agentInstanceStore.insert({
    id: 'impl-fixture-a',
    workflowInstanceId,
    roleNodeId: 'implementer',
    sessionId: 'sess-impl-a',
    parentAgentInstanceId: null,
    spawnEdgeId: null,
    status: 'completed',
    workspaceKind: 'owned',
    workspacePath: '/tmp/wt/impl-a',
    branchName: 'legion/test/branch-A',
    startedAt: new Date(),
    endedAt: new Date(),
  })
  server.runtime.agentInstanceStore.insert({
    id: 'impl-fixture-b',
    workflowInstanceId,
    roleNodeId: 'implementer',
    sessionId: 'sess-impl-b',
    parentAgentInstanceId: null,
    spawnEdgeId: null,
    status: 'completed',
    workspaceKind: 'owned',
    workspacePath: '/tmp/wt/impl-b',
    branchName: 'legion/test/branch-B',
    startedAt: new Date(),
    endedAt: new Date(),
  })

  process.stdout.write(`READY PORT=${server.port} WFID=${workflowInstanceId}\n`)

  const cleanup = async (): Promise<void> => {
    await server.stop()
    await rm(baseDir, { recursive: true, force: true })
    await repo.cleanup()
    process.exit(0)
  }
  process.on('SIGTERM', cleanup)
  process.on('SIGINT', cleanup)
  // Keep alive
  await new Promise(() => {})
}

await main()
