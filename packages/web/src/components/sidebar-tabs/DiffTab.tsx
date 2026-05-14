import { useEffect, useState } from 'react'

interface DiffEntry {
  agentInstanceId: string
  branch: string
  diff: string
}

export default function DiffTab({ instanceId }: { instanceId: string }) {
  const [items, setItems] = useState<DiffEntry[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let alive = true
    setErr(null)
    fetch(`/api/instances/${encodeURIComponent(instanceId)}/diff`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<DiffEntry[]>
      })
      .then((d) => {
        if (alive) setItems(d)
      })
      .catch((e) => {
        if (alive) setErr(String(e))
      })
    return () => {
      alive = false
    }
  }, [instanceId])

  if (err) return <div style={{ color: '#b00' }}>Error: {err}</div>
  if (!items) return <div>Loading…</div>
  if (items.length === 0) return <div>No agent diffs yet.</div>
  return (
    <div>
      {items.map((d) => (
        <div key={d.agentInstanceId} style={{ marginBottom: 12 }}>
          <button
            onClick={() =>
              setOpen((o) => ({ ...o, [d.agentInstanceId]: !o[d.agentInstanceId] }))
            }
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {open[d.agentInstanceId] ? '▼' : '▶'} {d.agentInstanceId} ({d.branch})
          </button>
          {open[d.agentInstanceId] && (
            <pre
              style={{
                fontSize: 11,
                background: '#1e1e1e',
                color: '#ddd',
                padding: 8,
                overflow: 'auto',
              }}
            >
              {d.diff || '(no changes)'}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}
