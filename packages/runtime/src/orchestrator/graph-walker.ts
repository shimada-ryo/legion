import type { WorkflowTemplate, TemplateNode, RoleNode } from '@legion/core'

function isRole(n: TemplateNode): n is RoleNode {
  return n.type === 'role'
}

/**
 * Resolve role nodes reachable from any trigger node via a 'triggers' edge.
 * Phase 2 narrow scope: returns exactly one role (the Director). The plural
 * shape is kept for Phase 3+ where multiple roles might be triggered.
 */
export function resolveTriggerTargets(template: WorkflowTemplate): RoleNode[] {
  const triggerIds = new Set(
    template.nodes.filter((n) => n.type === 'trigger').map((n) => n.id),
  )
  const targetIds = new Set<string>()
  for (const e of template.edges) {
    if (e.type === 'triggers' && triggerIds.has(e.from)) {
      targetIds.add(e.to)
    }
  }
  return template.nodes.filter(isRole).filter((n) => targetIds.has(n.id))
}

export interface DelegateTarget {
  roleNodeId: string
  roleName: string
  edgeType: 'delegates' | 'reviews'
}

/**
 * Resolve role nodes reachable from the given role via a 'delegates' or
 * 'reviews' edge. Used by DelegateToolHandler to validate that the caller
 * really has an outgoing edge to the requested role in the template snapshot.
 * Phase 3: includes 'reviews' edges in addition to 'delegates'.
 */
export function resolveDelegateTargets(
  template: WorkflowTemplate,
  fromRoleNodeId: string,
): DelegateTarget[] {
  const targets: DelegateTarget[] = []
  for (const e of template.edges) {
    if (e.from !== fromRoleNodeId) continue
    if (e.type !== 'delegates' && e.type !== 'reviews') continue
    const node = template.nodes.find((n) => n.id === e.to)
    if (node && isRole(node)) {
      targets.push({ roleNodeId: node.id, roleName: node.role, edgeType: e.type })
    }
  }
  return targets
}
