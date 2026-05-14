// D-033 / D-042 / D-037: Default profile per role. Workflow YAML may override.

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

const IMPLEMENTER_GIT_WHITELIST = [
  'Bash(git add*)',
  'Bash(git commit*)',
  'Bash(git status*)',
  'Bash(git diff*)',
] as const

const DIRECTOR_TOOLS = [...READ_TOOLS, 'mcp__legion__delegate'] as const

const PROFILES: Record<string, readonly string[]> = {
  director: DIRECTOR_TOOLS,
  implementer: [...EDIT_TOOLS, ...IMPLEMENTER_BASH_WHITELIST, ...IMPLEMENTER_GIT_WHITELIST],
  reviewer: READ_TOOLS,
}

export function defaultAllowedToolsFor(role: string): string[] {
  return [...(PROFILES[role] ?? [])]
}
