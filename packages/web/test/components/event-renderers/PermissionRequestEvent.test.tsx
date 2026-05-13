import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { render, fireEvent } from '@testing-library/react'
import PermissionRequestEvent from '../../../src/components/event-renderers/PermissionRequestEvent'

let capturedFetchArgs: { url: string; init: { body?: string; method?: string } }[] = []

beforeEach(() => {
  capturedFetchArgs = []
  ;(globalThis as { fetch: typeof fetch }).fetch = mock(
    (url: string, init: { body?: string; method?: string }) => {
      capturedFetchArgs.push({ url, init })
      return Promise.resolve(new Response(null, { status: 204 }))
    },
  ) as unknown as typeof fetch
})

describe('PermissionRequestEvent', () => {
  test('renders Approve and Deny buttons', () => {
    const { getByText } = render(
      <PermissionRequestEvent
        instanceId="inst-1"
        event={{
          id: 'e1',
          sessionId: 's1',
          type: 'permission_request',
          payload: { approvalId: 'a1', tool: 'Edit', input: { path: '/x' } },
          timestamp: new Date(),
        }}
      />,
    )
    expect(getByText('Approve')).toBeDefined()
    expect(getByText('Deny')).toBeDefined()
  })

  test('clicking Approve POSTs to approval endpoint with decision=approve', async () => {
    const { getByText } = render(
      <PermissionRequestEvent
        instanceId="inst-1"
        event={{
          id: 'e1',
          sessionId: 's1',
          type: 'permission_request',
          payload: { approvalId: 'a1', tool: 'Edit', input: {} },
          timestamp: new Date(),
        }}
      />,
    )
    fireEvent.click(getByText('Approve'))
    await new Promise((r) => setTimeout(r, 5))
    expect(capturedFetchArgs).toHaveLength(1)
    expect(capturedFetchArgs[0]?.url).toBe('/instances/inst-1/approvals/a1')
    const body = JSON.parse(capturedFetchArgs[0]?.init.body ?? '{}')
    expect(body.decision).toBe('approve')
  })
})
