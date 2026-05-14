import { Link } from 'react-router-dom'
import type { InstanceSummary } from '../types'

const STATUS_COLOR: Record<string, string> = {
  running: 'var(--status-running)',
  waiting: 'var(--status-warning)',
  completed: 'var(--status-success)',
  failed: 'var(--status-error)',
}

export default function InstanceCard({ instance }: { instance: InstanceSummary }) {
  const statusColor = STATUS_COLOR[instance.status] ?? 'var(--fg-muted)'
  return (
    <Link
      to={`/instances/${instance.id}`}
      style={{
        display: 'block',
        padding: 12,
        border: '1px solid var(--border-default)',
        borderRadius: 6,
        textDecoration: 'none',
        color: 'inherit',
        background: 'var(--bg-surface)',
      }}
    >
      <div style={{ fontWeight: 600 }}>{instance.templateId}</div>
      <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 4 }}>
        <span style={{ color: statusColor }}>{instance.status}</span>
        {' · '}
        <span>{new Date(instance.startedAt).toLocaleString()}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--fg-subtle)', marginTop: 4 }}>{instance.id.slice(0, 8)}</div>
    </Link>
  )
}
