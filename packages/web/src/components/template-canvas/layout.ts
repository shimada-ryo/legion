import type { WorkflowTemplate } from '@legion/core'

const COL_W = 200
const ROW_H = 120

export function layoutTemplate(
  t: WorkflowTemplate,
): Record<string, { x: number; y: number }> {
  const cols: Record<string, number> = {}
  const incoming = new Map<string, string[]>()
  for (const n of t.nodes) incoming.set(n.id, [])
  for (const e of t.edges) {
    if (!incoming.has(e.to)) incoming.set(e.to, [])
    incoming.get(e.to)!.push(e.from)
  }
  for (let pass = 0; pass < t.nodes.length + 1; pass++) {
    for (const n of t.nodes) {
      const parents = incoming.get(n.id) ?? []
      if (parents.length === 0) {
        cols[n.id] = 0
        continue
      }
      const parentCol = Math.max(...parents.map((p) => cols[p] ?? 0))
      cols[n.id] = parentCol + 1
    }
  }
  const byCol = new Map<number, string[]>()
  for (const n of t.nodes) {
    const c = cols[n.id]!
    if (!byCol.has(c)) byCol.set(c, [])
    byCol.get(c)!.push(n.id)
  }
  const result: Record<string, { x: number; y: number }> = {}
  for (const [c, ids] of byCol) {
    ids.forEach((id, i) => {
      result[id] = { x: c * COL_W, y: i * ROW_H }
    })
  }
  return result
}
