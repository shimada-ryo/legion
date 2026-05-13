import { describe, test, expect } from 'bun:test'
import { ApprovalOrchestrator } from '@legion/runtime/adapter/approval'

describe('ApprovalOrchestrator', () => {
  test('allow when tool is in allowedTools (exact match)', async () => {
    const orch = new ApprovalOrchestrator(['Read', 'Glob'])
    const decision = await orch.decide({ tool: 'Read', input: { path: '/x' } })
    expect(decision).toEqual({ allow: true })
  })

  test('allow when tool matches a Bash pattern', async () => {
    const orch = new ApprovalOrchestrator(['Bash(bun test*)'])
    const d = await orch.decide({ tool: 'Bash', input: { command: 'bun test --watch' } })
    expect(d).toEqual({ allow: true })
  })

  test('emits permission_request and respects external deny decision', async () => {
    const orch = new ApprovalOrchestrator(['Bash(bun test*)'])
    let emittedRequest: unknown = null
    orch.on('permission_request', (req) => {
      emittedRequest = req
      orch.resolve(req.approvalId, { allow: false, reason: 'user denied' })
    })
    const d = await orch.decide({ tool: 'Bash', input: { command: 'rm -rf /' } })
    expect(d.allow).toBe(false)
    expect(emittedRequest).not.toBeNull()
  })

  test('emits permission_request and awaits external approve decision', async () => {
    const orch = new ApprovalOrchestrator(['Read'])
    const requests: { approvalId: string }[] = []
    orch.on('permission_request', (req) => {
      requests.push(req)
      setTimeout(() => orch.resolve(req.approvalId, { allow: true }), 5)
    })
    const d = await orch.decide({ tool: 'Edit', input: { path: '/x' } })
    expect(d).toEqual({ allow: true })
    expect(requests).toHaveLength(1)
  })

  test('multiple pending requests resolve independently by approvalId', async () => {
    const orch = new ApprovalOrchestrator([])
    const ids: string[] = []
    orch.on('permission_request', (req) => {
      ids.push(req.approvalId)
    })
    const p1 = orch.decide({ tool: 'A', input: {} })
    const p2 = orch.decide({ tool: 'B', input: {} })
    await new Promise((r) => setTimeout(r, 5))
    expect(ids.length).toBe(2)
    orch.resolve(ids[1]!, { allow: true })
    orch.resolve(ids[0]!, { allow: false })
    const [d1, d2] = await Promise.all([p1, p2])
    expect(d1.allow).toBe(false)
    expect(d2.allow).toBe(true)
  })
})
