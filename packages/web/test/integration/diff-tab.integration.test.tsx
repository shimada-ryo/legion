import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { resolve } from 'node:path'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import DiffTab from '../../src/components/sidebar-tabs/DiffTab'

// Cross-package integration test: spawn the real @legion/server in a clean
// subprocess (no happy-dom pollution there), point DiffTab's fetch at it.
//
// Why a subprocess: happy-dom's GlobalRegistrator replaces Response/Request/
// fetch globally. Bun.serve, running in the same process, then receives a
// happy-dom Response from its handler and rejects it with "Expected a Response
// object". The only way to get a clean Response constructor for the server is
// to run it in a separate process.

const FIXTURE_PATH = resolve(import.meta.dir, '_server-fixture.ts')

interface FixtureState {
  proc: ReturnType<typeof Bun.spawn>
  port: number
  workflowInstanceId: string
  originalFetch: typeof fetch
}

async function startFixture(): Promise<FixtureState> {
  const proc = Bun.spawn(['bun', 'run', FIXTURE_PATH], {
    stdout: 'pipe',
    stderr: 'inherit',
  })
  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (!buffer.includes('\n')) {
    const { value, done } = await reader.read()
    if (done) throw new Error('fixture exited before READY line')
    buffer += decoder.decode(value)
  }
  reader.releaseLock()
  const m = buffer.match(/READY PORT=(\d+) WFID=([0-9A-Z]+)/)
  if (!m) throw new Error(`fixture did not print READY line: got ${JSON.stringify(buffer)}`)
  const port = Number(m[1])
  const workflowInstanceId = m[2]!

  // Re-route DiffTab's relative fetch to the subprocess server using Bun's
  // native fetch (happy-dom's wrapper mis-parses Bun.serve responses).
  const originalFetch = globalThis.fetch
  const baseUrl = `http://localhost:${port}`
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/')) {
      return Bun.fetch(baseUrl + input, init)
    }
    return Bun.fetch(input as string, init)
  }) as typeof fetch

  return { proc, port, workflowInstanceId, originalFetch }
}

async function stopFixture(s: FixtureState): Promise<void> {
  globalThis.fetch = s.originalFetch
  s.proc.kill()
  await s.proc.exited
}

let fixture: FixtureState

beforeEach(async () => {
  fixture = await startFixture()
})

afterEach(async () => {
  cleanup()
  await stopFixture(fixture)
})

describe('DiffTab ↔ server integration (subprocess)', () => {
  test('clicking one branch toggles only that branch — verifies per-entry state keying', async () => {
    const { findByText, container } = render(
      <DiffTab instanceId={fixture.workflowInstanceId} />,
    )

    // Both pre-seeded Implementers must render as separate buttons.
    const btnA = await findByText(/legion\/test\/branch-A/)
    const btnB = await findByText(/legion\/test\/branch-B/)
    expect(btnA.tagName).toBe('BUTTON')
    expect(btnB.tagName).toBe('BUTTON')

    // Initially both branches are collapsed: no <pre> elements visible.
    expect(container.querySelectorAll('pre').length).toBe(0)

    // Click branch A. Its diff body should appear; B should remain collapsed.
    // If DiffTab uses a wrong field as state key (e.g. `d.agentPath` which is
    // undefined for every row), clicking A toggles a SHARED state slot and
    // both bodies expand together — pre count would be 2 instead of 1.
    fireEvent.click(btnA)
    await waitFor(() => {
      expect(container.querySelectorAll('pre').length).toBe(1)
    })

    // Click branch B as well. Both should now be expanded.
    fireEvent.click(btnB)
    await waitFor(() => {
      expect(container.querySelectorAll('pre').length).toBe(2)
    })

    // Click branch A again to collapse it. Only B should remain expanded.
    fireEvent.click(btnA)
    await waitFor(() => {
      expect(container.querySelectorAll('pre').length).toBe(1)
    })
  })
})
