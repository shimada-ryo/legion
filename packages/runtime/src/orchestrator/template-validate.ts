import type { WorkflowTemplate, TemplateNode } from '@legion/core'

export interface TemplateValidationResult {
  errors: string[]
  warnings: string[]
}

const DEFERRED_EDGE_TYPES = new Set(['subscribes', 'synthesizes'])

// Phase 3 constraint: codex provider may only be used for reviewer roles.
const CODEX_FORBIDDEN_ROLES = new Set(['director', 'implementer'])

export function validateTemplate(
  template: WorkflowTemplate,
  registeredProviders: Set<string>,
): TemplateValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const nodesById = new Map<string, TemplateNode>(template.nodes.map((n) => [n.id, n]))

  for (const node of template.nodes) {
    if (node.type !== 'role') continue

    // node is narrowed to RoleNode; access fields directly.
    // Runtime guards below defend against malformed YAML/JSON input where
    // provider/role may be missing or empty despite the type declaration.
    if (!node.provider) {
      errors.push(`role node '${node.id}' must declare a 'provider' field`)
      continue
    }
    if (!registeredProviders.has(node.provider)) {
      errors.push(
        `role node '${node.id}' uses unknown provider '${node.provider}' (registered: ${[...registeredProviders].join(', ')})`,
      )
    }
    if (node.provider === 'codex' && CODEX_FORBIDDEN_ROLES.has(node.role)) {
      errors.push(
        `provider=codex is not allowed for role '${node.role}' (Phase 3 constraint; codex is reviewer-only)`,
      )
    }
  }

  for (const edge of template.edges) {
    if (edge.type === 'reviews') {
      const target = nodesById.get(edge.to)
      const targetRole = target?.type === 'role' ? target.role : undefined
      if (targetRole !== 'reviewer') {
        errors.push(
          `reviews edge target '${edge.to}' must be a reviewer role node (got: ${targetRole ?? 'unknown'})`,
        )
      }
    }

    if (edge.type === 'publishes') {
      const target = nodesById.get(edge.to)
      if (target?.type !== 'blackboard') {
        errors.push(`publishes edge target '${edge.to}' must be a blackboard node`)
      }
    }

    if (DEFERRED_EDGE_TYPES.has(edge.type)) {
      warnings.push(
        `edge type '${edge.type}' (${edge.from}→${edge.to}) is deferred to Phase 4 and will be ignored at runtime`,
      )
    }
  }

  return { errors, warnings }
}
