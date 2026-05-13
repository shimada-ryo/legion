// D-033: Default allowedTools profile per role. Workflow YAML can override via RoleNode.allowedTools.

const READ_TOOLS = ['Read', 'Glob', 'Grep'] as const
const EDIT_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep'] as const

const IMPLEMENTER_BASH_WHITELIST = [
  'Bash(bun test*)',
  'Bash(bun run typecheck*)',
  'Bash(bun run lint*)',
  'Bash(bun build*)',
  'Bash(npm test*)',
  'Bash(npm run typecheck*)',
  'Bash(yarn test*)',
  'Bash(pnpm test*)',
  'Bash(pytest*)',
  'Bash(cargo test*)',
  'Bash(go test*)',
] as const

const PROFILES: Record<string, readonly string[]> = {
  director: READ_TOOLS,
  implementer: [...EDIT_TOOLS, ...IMPLEMENTER_BASH_WHITELIST],
  reviewer: READ_TOOLS,
}

export function defaultAllowedToolsFor(role: string): string[] {
  return [...(PROFILES[role] ?? [])]
}
