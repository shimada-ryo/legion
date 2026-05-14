import type { WorkflowTemplate } from '@legion/core'
import type { AgentInstanceView, BlackboardMessage } from '../../types'

export interface OverviewTabProps {
  template: WorkflowTemplate
  selectedNodeId: string | null
  agentInstances?: AgentInstanceView[]
  blackboardMessages?: BlackboardMessage[]
}

interface ReviewDecision {
  decision: string
  feedback?: string
  notes?: string
}

function latestDecisionFor(
  agentInstanceId: string,
  blackboardMessages: BlackboardMessage[],
): ReviewDecision | undefined {
  for (let i = blackboardMessages.length - 1; i >= 0; i--) {
    const m = blackboardMessages[i]!
    if (m.topic !== 'system.review.decision') continue
    const p = m.payload as { agentInstanceId?: unknown } & Partial<ReviewDecision>
    if (p.agentInstanceId === agentInstanceId && typeof p.decision === 'string') {
      return {
        decision: p.decision,
        ...(typeof p.feedback === 'string' ? { feedback: p.feedback } : {}),
        ...(typeof p.notes === 'string' ? { notes: p.notes } : {}),
      }
    }
  }
  return undefined
}

export default function OverviewTab({
  template,
  selectedNodeId,
  agentInstances = [],
  blackboardMessages = [],
}: OverviewTabProps) {
  if (!selectedNodeId) return <div>Select a node to inspect.</div>
  const node = template.nodes.find((n) => n.id === selectedNodeId)
  if (!node) return <div>Unknown node.</div>

  const here = agentInstances.filter((a) => a.roleNodeId === selectedNodeId)
  const parents = here
    .map((a) => a.parentAgentInstanceId)
    .filter((p): p is string => Boolean(p))
    .map((pid) => agentInstances.find((a) => a.id === pid))
    .filter((a): a is AgentInstanceView => Boolean(a))
  const children = here.flatMap((a) => agentInstances.filter((b) => b.parentAgentInstanceId === a.id))

  return (
    <div style={{ fontSize: 13 }}>
      <dl style={{ margin: 0 }}>
        <dt>ID</dt>
        <dd>{node.id}</dd>
        <dt>Type</dt>
        <dd>{node.type}</dd>
        {node.type === 'role' && (
          <>
            <dt>Role</dt>
            <dd>{node.role}</dd>
            <dt>Provider</dt>
            <dd>{node.provider}</dd>
            <dt>Lifetime</dt>
            <dd>{node.lifetime}</dd>
          </>
        )}
        {node.type === 'trigger' && (
          <>
            <dt>Kind</dt>
            <dd>{node.kind}</dd>
          </>
        )}
        {node.type === 'blackboard' && (
          <>
            <dt>Schema</dt>
            <dd>
              <pre>{JSON.stringify(node.schema, null, 2)}</pre>
            </dd>
          </>
        )}
        {node.type === 'human-gate' && (
          <>
            <dt>Label</dt>
            <dd>{node.label}</dd>
          </>
        )}
        {node.type === 'sink' && (
          <>
            <dt>Kind</dt>
            <dd>{node.kind}</dd>
          </>
        )}
      </dl>
      {here.map((a) => {
        const decision = node.type === 'role' && node.role === 'reviewer'
          ? latestDecisionFor(a.id, blackboardMessages)
          : undefined
        return (
          <div key={a.id} style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #eee' }}>
            <div><strong>Agent:</strong> {a.id}</div>
            <div><strong>Status:</strong> {a.status}</div>
            {a.branchName && <div><strong>Branch:</strong> {a.branchName}</div>}
            <div><strong>Workspace:</strong> {a.workspace.path}</div>
            {decision && (
              <div style={{ marginTop: 6, padding: 6, background: '#f8f8ff', border: '1px solid #dde' }}>
                <div><strong>Decision:</strong> <span data-decision={decision.decision}>{decision.decision}</span></div>
                {decision.feedback && (
                  <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>
                    <strong>Feedback:</strong> {decision.feedback}
                  </div>
                )}
                {decision.notes && (
                  <div style={{ marginTop: 4, fontStyle: 'italic', color: '#666' }}>
                    {decision.notes}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
      {parents.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div><strong>Spawned by</strong></div>
          {parents.map((p) => (
            <div key={p.id}>· {p.roleNodeId} (id: {p.id})</div>
          ))}
        </div>
      )}
      {children.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div><strong>Spawned</strong></div>
          {children.map((c) => (
            <div key={c.id}>· {c.id} ({c.roleNodeId}, {c.status})</div>
          ))}
        </div>
      )}
    </div>
  )
}
