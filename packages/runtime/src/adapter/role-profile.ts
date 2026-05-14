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

const PROFILES: Record<string, readonly string[]> = {
  director: [...READ_TOOLS, 'mcp__legion__delegate', 'mcp__legion__publish'],
  implementer: [
    ...EDIT_TOOLS,
    ...IMPLEMENTER_BASH_WHITELIST,
    ...IMPLEMENTER_GIT_WHITELIST,
    'mcp__legion__delegate', // Phase 3: self-delegate to reviewer (runtime-restricted)
    'mcp__legion__publish',  // Phase 3: Blackboard publish
  ],
  reviewer: [
    ...READ_TOOLS,
    'mcp__legion__publish',  // Phase 3: reviewer can publish (subscribe deferred to Phase 4)
  ],
}

export function defaultAllowedToolsFor(role: string): string[] {
  return [...(PROFILES[role] ?? [])]
}
