import { describe, it, expect } from 'bun:test'
import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { $ } from 'bun'

// Contract test for the mock fixtures in:
//   - packages/runtime/test/adapter/codex/codex-provider.test.ts
//   - packages/runtime/test/adapter/codex/codex-stream.test.ts
//
// representing: @openai/codex-sdk Codex/Thread/ThreadEvent surface
// verified on:  2026-05-15, by SDK research (memory: reference_codex_sdk_integration)
// invalidated when:
//   - @openai/codex-sdk bumps ThreadEvent shape (item.completed / turn.completed / turn.failed)
//   - SDK changes ThreadOptions accepted fields (sandboxMode/approvalPolicy/workingDirectory)
//   - SDK introduces / removes outputSchema behavior on TurnOptions
//
// Run criteria: CODEX_INTEGRATION=1 AND (~/.codex/auth.json exists OR CODEX_API_KEY env set)
// Cost: ~10 seconds, a few cents on real OpenAI API.

const hasAuth =
  existsSync(join(homedir(), '.codex', 'auth.json')) ||
  Boolean(process.env['CODEX_API_KEY'])
const CONTRACT_ENABLED = process.env['CODEX_INTEGRATION'] === '1' && hasAuth

describe.skipIf(!CONTRACT_ENABLED)('@openai/codex-sdk contract', () => {
  it('startThread + runStreamed emits item.completed and turn.completed in this order', async () => {
    const { Codex } = await import('@openai/codex-sdk')
    const tmp = await mkdtemp(join(tmpdir(), 'codex-contract-'))
    try {
      // Codex requires a git repo, so init the minimum.
      await $`git init -q ${tmp}`.quiet()
      await writeFile(join(tmp, 'README.md'), '# contract test\n')
      await $`git -C ${tmp} add -A`.quiet()
      await $`git -C ${tmp} -c user.email=t@t -c user.name=t commit -qm init`.quiet()

      const codex = new Codex()
      const thread = codex.startThread({
        workingDirectory: tmp,
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
      })

      const { events } = await thread.runStreamed('Reply with exactly the string: OK')
      const seen: string[] = []
      for await (const ev of events) {
        seen.push(ev.type)
        if (ev.type === 'turn.failed') break
        if (ev.type === 'turn.completed') break
      }

      expect(seen).toContain('item.completed')
      expect(seen).toContain('turn.completed')
      // item.completed must appear before turn.completed
      const itemIdx = seen.indexOf('item.completed')
      const turnIdx = seen.lastIndexOf('turn.completed')
      expect(itemIdx).toBeLessThan(turnIdx)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }, 30_000)

  it('outputSchema on runStreamed yields schema-conformant final assistant message', async () => {
    const { Codex } = await import('@openai/codex-sdk')
    const tmp = await mkdtemp(join(tmpdir(), 'codex-contract-'))
    try {
      await $`git init -q ${tmp}`.quiet()
      await writeFile(join(tmp, 'README.md'), '# contract test\n')
      await $`git -C ${tmp} add -A`.quiet()
      await $`git -C ${tmp} -c user.email=t@t -c user.name=t commit -qm init`.quiet()

      const codex = new Codex()
      const thread = codex.startThread({
        workingDirectory: tmp,
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
      })

      const turn = await thread.run('Return decision=approve', {
        outputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            decision: { type: 'string', enum: ['approve', 'reject'] },
          },
          required: ['decision'],
        } as unknown,
      })

      // SDK's RunResult.finalResponse is a string; assert it's JSON-parsable.
      expect(typeof turn.finalResponse).toBe('string')
      const parsed = JSON.parse(turn.finalResponse) as { decision: string }
      expect(['approve', 'reject']).toContain(parsed.decision)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }, 30_000)
})
