import { Link } from 'react-router-dom'
import type { TemplateSummary } from '../types'

export default function TemplateCard({ template }: { template: TemplateSummary }) {
  return (
    <Link
      to={`/templates/${encodeURIComponent(template.id)}`}
      style={{
        display: 'block',
        padding: 16,
        border: '1px solid var(--border-default)',
        borderRadius: 8,
        textDecoration: 'none',
        color: 'inherit',
        background: 'var(--bg-surface)',
        minHeight: 120,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 16 }}>{template.name}</div>
      <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 6 }}>{template.id}</div>
      {template.description && (
        <div style={{ fontSize: 13, marginTop: 10, color: 'var(--fg-primary)' }}>
          {template.description}
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--fg-subtle)', marginTop: 12 }}>
        {template.nodeCount} nodes
      </div>
    </Link>
  )
}
