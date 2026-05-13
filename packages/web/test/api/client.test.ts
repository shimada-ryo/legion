import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { triggerWorkflow, resolveApproval } from '../../src/api/client'

let captured: { url: string; init: { method?: string; body?: string } }[] = []

beforeEach(() => {
  captured = []
  ;(globalThis as { fetch: typeof fetch }).fetch = mock(
    (url: string, init: { method?: string; body?: string }) => {
      captured.push({ url, init })
      return Promise.resolve(
        new Response(JSON.stringify({ workflowInstanceId: 'x' }), { status: 200 }),
      )
    },
  ) as unknown as typeof fetch
})

describe('triggerWorkflow', () => {
  test('POSTs to /api/workflows/trigger with templateId and userPrompt', async () => {
    await triggerWorkflow('feature-implementation', 'do thing')
    expect(captured[0]?.url).toBe('/api/workflows/trigger')
    expect(captured[0]?.init.method).toBe('POST')
    const body = JSON.parse(captured[0]?.init.body ?? '{}')
    expect(body).toEqual({
      templateId: 'feature-implementation',
      userPrompt: 'do thing',
    })
  })
})

describe('resolveApproval', () => {
  test('POSTs decision=approve to the right URL', async () => {
    ;(globalThis as { fetch: typeof fetch }).fetch = mock(
      (url: string, init: { method?: string; body?: string }) => {
        captured.push({ url, init })
        return Promise.resolve(new Response(null, { status: 204 }))
      },
    ) as unknown as typeof fetch
    await resolveApproval('inst-1', 'app-1', 'approve')
    expect(captured[0]?.url).toBe('/api/instances/inst-1/approvals/app-1')
    const body = JSON.parse(captured[0]?.init.body ?? '{}')
    expect(body.decision).toBe('approve')
  })
})
