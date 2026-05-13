import { useState } from 'react'
import type { AgentEvent } from '@legion/core'
import { resolveApproval } from '../../api/client'

export default function PermissionRequestEvent({
  event,
  instanceId,
}: {
  event: AgentEvent
  instanceId: string
}) {
  const p = event.payload as { approvalId?: string; tool?: string; input?: unknown }
  const [decided, setDecided] = useState<'approve' | 'deny' | null>(null)

  async function decide(d: 'approve' | 'deny') {
    if (!p.approvalId) return
    await resolveApproval(instanceId, p.approvalId, d)
    setDecided(d)
  }

  return (
    <div
      style={{
        padding: 8,
        background: '#fff5d6',
        border: '1px solid #cc8800',
        borderRadius: 6,
        margin: '4px 0',
      }}
    >
      <div style={{ fontSize: 11, color: '#664400' }}>permission request</div>
      <div style={{ marginTop: 4 }}>
        <strong>{p.tool ?? '?'}</strong>
      </div>
      <pre style={{ fontSize: 11, overflow: 'auto', maxHeight: 100 }}>
        {JSON.stringify(p.input, null, 2)}
      </pre>
      {decided ? (
        <div style={{ marginTop: 8, color: decided === 'approve' ? '#0a0' : '#a00' }}>
          {decided}d
        </div>
      ) : (
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <button onClick={() => decide('approve')}>Approve</button>
          <button onClick={() => decide('deny')}>Deny</button>
        </div>
      )}
    </div>
  )
}
