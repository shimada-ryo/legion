import { Link } from 'react-router-dom'
import type { InstanceSummary } from '../types'

const STATUS_COLOR: Record<string, string> = {
  running: '#0066cc',
  waiting: '#cc8800',
  completed: '#00aa44',
  failed: '#cc2222',
}

export default function InstanceCard({ instance }: { instance: InstanceSummary }) {
  const statusColor = STATUS_COLOR[instance.status] ?? '#666'
  return (
    <Link
      to={`/instances/${instance.id}`}
      style={{
        display: 'block',
        padding: 12,
        border: '1px solid #ddd',
        borderRadius: 6,
        textDecoration: 'none',
        color: 'inherit',
        background: 'white',
      }}
    >
      <div style={{ fontWeight: 600 }}>{instance.templateId}</div>
      <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
        <span style={{ color: statusColor }}>{instance.status}</span>
        {' · '}
        <span>{new Date(instance.startedAt).toLocaleString()}</span>
      </div>
      <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>{instance.id.slice(0, 8)}</div>
    </Link>
  )
}
