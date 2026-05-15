import type { WorkflowTemplate, TemplateNode, TemplateEdge, NodePosition } from '@legion/core'

const COL_W = 200
const ROW_H = 120

export function layoutTemplate(
  t: WorkflowTemplate,
): Record<string, NodePosition> {
  const explicit: Record<string, NodePosition> = {}
  const needsAuto: TemplateNode[] = []
  for (const n of t.nodes) {
    if (n.position) explicit[n.id] = n.position
    else needsAuto.push(n)
  }
  const auto = autoLayout(needsAuto, t.edges)
  return { ...auto, ...explicit }
}

function autoLayout(
  nodes: TemplateNode[],
  allEdges: TemplateEdge[],
): Record<string, NodePosition> {
  const cols: Record<string, number> = {}
  const incoming = new Map<string, string[]>()
  for (const n of nodes) incoming.set(n.id, [])
  const targetIds = new Set(nodes.map((n) => n.id))
  for (const e of allEdges) {
    if (!targetIds.has(e.to)) continue
    if (!incoming.has(e.to)) incoming.set(e.to, [])
    incoming.get(e.to)!.push(e.from)
  }
  for (let pass = 0; pass < nodes.length + 1; pass++) {
    for (const n of nodes) {
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
  for (const n of nodes) {
    const c = cols[n.id]!
    if (!byCol.has(c)) byCol.set(c, [])
    byCol.get(c)!.push(n.id)
  }
  const result: Record<string, NodePosition> = {}
  for (const [c, ids] of byCol) {
    ids.forEach((id, i) => {
      result[id] = { x: c * COL_W, y: i * ROW_H }
    })
  }
  return result
}
