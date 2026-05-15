// Integration test for Template position save round-trip.
// Boots a real @legion/server in a subprocess (no UI rendering — purely API-layer
// through client.ts). The subprocess runs without happy-dom, so Bun.serve's native
// Response/fetch are clean; we use Bun.fetch from the test side to redirect '/api'
// URLs (which client.ts emits) to the subprocess port.
//
// Why subprocess (not in-process): happy-dom's GlobalRegistrator.register() replaces
// global Response/Request/fetch. Bun.serve, running in the same process, then
// receives a happy-dom Response from its handler and rejects it. The same constraint
// applies to the diff-tab.integration.test.tsx; see its header comment for details.
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test'
import { join, resolve } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { patchTemplatePositions, getTemplate } from '../../src/api/client'

const FIXTURE_PATH = resolve(import.meta.dir, '_template-save-fixture.ts')
const REPO_ROOT = resolve(import.meta.dir, '../../../..')
const YAML_PATH = join(REPO_ROOT, 'workflows', 'feature-with-review.yaml')

interface FixtureState {
  proc: ReturnType<typeof Bun.spawn>
  port: number
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
  const m = buffer.match(/READY PORT=(\d+)/)
  if (!m) throw new Error(`fixture did not print READY line: got ${JSON.stringify(buffer)}`)
  const port = Number(m[1])

  // Redirect client.ts relative '/api/...' URLs to the subprocess server.
  // Use Bun.fetch (native) so the subprocess receives a native Bun Response.
  const originalFetch = globalThis.fetch
  const baseUrl = `http://localhost:${port}`
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/')) {
      return Bun.fetch(baseUrl + input, init)
    }
    return Bun.fetch(input as string, init)
  }) as typeof fetch

  return { proc, port, originalFetch }
}

async function stopFixture(f: FixtureState): Promise<void> {
  globalThis.fetch = f.originalFetch
  f.proc.kill()
  await f.proc.exited
}

let fixture: FixtureState
let originalYaml: string

beforeAll(async () => {
  fixture = await startFixture()
})

afterAll(async () => {
  await stopFixture(fixture)
})

beforeEach(async () => {
  originalYaml = await readFile(YAML_PATH, 'utf-8')
})
afterEach(async () => {
  await writeFile(YAML_PATH, originalYaml)
})

describe('template save round-trip via client.ts', () => {
  test('PATCH then GET returns the persisted position', async () => {
    const updated = await patchTemplatePositions('feature-with-review', {
      director: { x: 42, y: 84 },
    })
    const dir = updated.nodes.find((n) => n.id === 'director')!
    expect(dir.position).toEqual({ x: 42, y: 84 })

    const refetched = await getTemplate('feature-with-review')
    const dir2 = refetched.nodes.find((n) => n.id === 'director')!
    expect(dir2.position).toEqual({ x: 42, y: 84 })
  })

  test('YAML on disk still contains the description comment after save', async () => {
    await patchTemplatePositions('feature-with-review', {
      reviewer: { x: 9, y: 9 },
    })
    const after = await readFile(YAML_PATH, 'utf-8')
    expect(after).toContain('Director delegates to Implementer')
    expect(after).toContain('position: { x: 9, y: 9 }')
  })

  test('400 on unknown node id', async () => {
    await expect(
      patchTemplatePositions('feature-with-review', { ghost: { x: 0, y: 0 } }),
    ).rejects.toThrow(/400/)
  })
})
