#!/usr/bin/env bun
import { Database } from 'bun:sqlite'
import { $ } from 'bun'
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
const port =
  portIdx >= 0 && portIdx + 1 < args.length ? parseInt(args[portIdx + 1]!, 10) : 5500
const repoPath = process.cwd()

await preflight(repoPath)

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
  adapterFactory: () =>
    new ClaudeCodeAgentSDKProvider({ query: query as unknown as (input: unknown) => AsyncIterable<unknown> }),
})

console.log(`legion server listening on http://localhost:${handle.port}`)

async function preflight(repoPath: string): Promise<void> {
  if (!existsSync(join(repoPath, '.git'))) {
    console.error(
      `legion: '${repoPath}' is not a git repository.\n` +
        `legion creates a git worktree per agent, so cwd must be a git repo with at least one commit.\n` +
        `Run 'git init' (and make a commit) before starting the server.`,
    )
    process.exit(1)
  }
  const workflowsDir = join(repoPath, 'workflows')
  if (!existsSync(workflowsDir)) {
    console.error(
      `legion: '${workflowsDir}' not found.\n` +
        `legion reads workflow templates from <cwd>/workflows/.\n` +
        `Copy workflow YAMLs there (e.g. from the legion repo) and try again.`,
    )
    process.exit(1)
  }
  const head = await $`git rev-parse --verify HEAD`.cwd(repoPath).quiet().nothrow()
  if (head.exitCode !== 0) {
    console.error(
      `legion: '${repoPath}' has no commits yet.\n` +
        `legion uses a base commit to create worktrees from.\n` +
        `Make at least one commit before starting the server.`,
    )
    process.exit(1)
  }
}
