import { useEffect, useState } from 'react'
import { listInstances } from '../api/client'
import type { InstanceSummary } from '../types'
import InstanceCard from '../components/InstanceCard'

const STATUSES = ['running', 'waiting', 'completed', 'failed'] as const

export default function InstancesList() {
  const [items, setItems] = useState<InstanceSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const data = await listInstances()
        if (alive) setItems(data)
      } catch (e) {
        if (alive) setError((e as Error).message)
      }
    }
    void tick()
    const id = setInterval(() => void tick(), 2000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  if (error) return <div style={{ padding: 16, color: '#c22' }}>Error: {error}</div>

  return (
    <div
      style={{
        padding: 16,
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 16,
      }}
    >
      {STATUSES.map((s) => (
        <div key={s}>
          <h3 style={{ marginTop: 0 }}>{s}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items
              .filter((i) => i.status === s)
              .map((i) => (
                <InstanceCard key={i.id} instance={i} />
              ))}
          </div>
        </div>
      ))}
    </div>
  )
}
