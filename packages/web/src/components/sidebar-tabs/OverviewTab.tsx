import type { WorkflowTemplate } from '@legion/core'

export default function OverviewTab(props: {
  template: WorkflowTemplate
  selectedNodeId: string | null
}) {
  if (!props.selectedNodeId) return <div>Select a node to inspect.</div>
  const n = props.template.nodes.find((x) => x.id === props.selectedNodeId)
  if (!n) return <div>Unknown node.</div>
  return (
    <dl style={{ margin: 0 }}>
      <dt>ID</dt>
      <dd>{n.id}</dd>
      <dt>Type</dt>
      <dd>{n.type}</dd>
      {n.type === 'role' && (
        <>
          <dt>Role</dt>
          <dd>{n.role}</dd>
          <dt>Provider</dt>
          <dd>{n.provider}</dd>
          <dt>Lifetime</dt>
          <dd>{n.lifetime}</dd>
        </>
      )}
      {n.type === 'trigger' && (
        <>
          <dt>Kind</dt>
          <dd>{n.kind}</dd>
        </>
      )}
      {n.type === 'blackboard' && (
        <>
          <dt>Schema</dt>
          <dd>
            <pre>{JSON.stringify(n.schema, null, 2)}</pre>
          </dd>
        </>
      )}
      {n.type === 'human-gate' && (
        <>
          <dt>Label</dt>
          <dd>{n.label}</dd>
        </>
      )}
      {n.type === 'sink' && (
        <>
          <dt>Kind</dt>
          <dd>{n.kind}</dd>
        </>
      )}
    </dl>
  )
}
