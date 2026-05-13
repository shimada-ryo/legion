import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getTemplate } from '../api/client'
import type { WorkflowTemplate } from '@legion/core'
import TemplateCanvas from '../components/TemplateCanvas'

export default function TemplateDetail() {
  const { id } = useParams<{ id: string }>()
  const [template, setTemplate] = useState<WorkflowTemplate | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    getTemplate(id)
      .then(setTemplate)
      .catch((e) => setError((e as Error).message))
  }, [id])

  if (error) return <div style={{ padding: 16, color: '#c22' }}>Error: {error}</div>
  if (!template) return <div style={{ padding: 16 }}>Loading…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: 12, borderBottom: '1px solid #ddd', background: '#fafafa' }}>
        <Link to="/templates" style={{ marginRight: 12 }}>
          ← Templates
        </Link>
        <strong>{template.name}</strong>
        <span style={{ color: '#666', marginLeft: 8 }}>({template.id})</span>
        <span style={{ marginLeft: 16, fontSize: 12, color: '#888' }}>
          (read-only mockup — Phase 1 では編集不可)
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <TemplateCanvas template={template} />
      </div>
    </div>
  )
}
