import { useEffect, useState } from 'react'
import { listTemplates } from '../api/client'
import type { TemplateSummary } from '../types'
import TemplateCard from '../components/TemplateCard'

export default function TemplatesList() {
  const [items, setItems] = useState<TemplateSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listTemplates()
      .then(setItems)
      .catch((e) => setError((e as Error).message))
  }, [])

  if (error) return <div style={{ padding: 16, color: '#c22' }}>Error: {error}</div>
  if (!items) return <div style={{ padding: 16 }}>Loading…</div>

  return (
    <div
      style={{
        padding: 16,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 16,
      }}
    >
      {items.map((t) => (
        <TemplateCard key={t.id} template={t} />
      ))}
    </div>
  )
}
