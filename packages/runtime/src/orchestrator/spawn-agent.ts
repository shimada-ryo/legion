import type { RoleNode, WorkflowTemplate } from '@legion/core'
import { defaultSystemPromptFor } from '../adapter/role-prompts'

// firstRoleNode is removed in Task 12; keep it here until then.
export function firstRoleNode(template: WorkflowTemplate): RoleNode | null {
  // Find a Role that is the direct target of a 'triggers' edge from a trigger node.
  const triggers = template.nodes.filter((n) => n.type === 'trigger').map((n) => n.id)
  for (const e of template.edges) {
    if (e.type !== 'triggers') continue
    if (!triggers.includes(e.from)) continue
    const target = template.nodes.find((n) => n.id === e.to)
    if (target && target.type === 'role') return target
  }
  // Fallback: first Role in document order.
  const r = template.nodes.find((n) => n.type === 'role')
  return r && r.type === 'role' ? r : null
}

export function buildInitialPrompt(input: { role: string; userPrompt: string }): string {
  const sys = defaultSystemPromptFor(input.role)
  if (sys) return `${sys}\n\nTask: ${input.userPrompt}`
  return [
    `You are operating as the "${input.role}" role in a legion workflow.`,
    `Your task:`,
    input.userPrompt,
  ].join('\n\n')
}
