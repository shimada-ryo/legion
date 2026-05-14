import type { Codex } from '@openai/codex-sdk'
import type { LaunchRequest } from '@legion/core'
import type { CodexSession } from './codex-session-store'
import { ulid } from 'ulid'

export function launchCodexSession(codex: Codex, req: LaunchRequest): CodexSession {
  const sessionId = ulid()
  const thread = codex.startThread({
    workingDirectory: req.workdir,
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
    ...(req.model !== undefined ? { model: req.model } : {}),
  })
  return {
    sessionId,
    thread,
    prompt: req.initialPrompt,
    outputSchema: req.outputSchema,
    role: req.role,
    abort: new AbortController(),
  }
}
