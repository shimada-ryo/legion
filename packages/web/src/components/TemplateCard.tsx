import { Link } from 'react-router-dom'
import type { TemplateSummary } from '../types'

export default function TemplateCard({ template }: { template: TemplateSummary }) {
  return (
    <Link
      to={`/templates/${encodeURIComponent(template.id)}`}
      style={{
        display: 'block',
        padding: 16,
        border: '1px solid #ddd',
        borderRadius: 8,
        textDecoration: 'none',
        color: 'inherit',
        background: 'white',
        minHeight: 120,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 16 }}>{template.name}</div>
      <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>{template.id}</div>
      {template.description && (
        <div style={{ fontSize: 13, marginTop: 10, color: '#444' }}>
          {template.description}
        </div>
      )}
      <div style={{ fontSize: 11, color: '#999', marginTop: 12 }}>
        {template.nodeCount} nodes
      </div>
    </Link>
  )
}
