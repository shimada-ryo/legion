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
const port =
  portIdx >= 0 && portIdx + 1 < args.length ? parseInt(args[portIdx + 1]!, 10) : 5500
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
  adapterFactory: () =>
    new ClaudeCodeAgentSDKProvider({ query: query as unknown as (input: unknown) => AsyncIterable<unknown> }),
})

console.log(`legion server listening on http://localhost:${handle.port}`)
