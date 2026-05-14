// D-033 / D-042 / D-037: Default profile per role. Workflow YAML may override.
//
// Bash is allowed via a catch-all entry rather than a curated subcommand list.
// Real agents reach for `cd`, `ls`, `mkdir`, `git rev-parse`, etc. routinely,
// and a narrow whitelist turns into permission-prompt whac-a-mole that hangs
// non-interactive flows. The legion direction is to sandbox each agent in
// Docker (memory: project_sandbox_direction); per-tool gating at this layer
// is therefore unnecessary. The launcher pairs this with permissionMode
// 'bypassPermissions' so the SDK does not prompt either.

const READ_TOOLS = ['Read', 'Glob', 'Grep'] as const
const EDIT_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep'] as const

const PROFILES: Record<string, readonly string[]> = {
  director: [...READ_TOOLS, 'mcp__legion__delegate', 'mcp__legion__publish'],
  implementer: [
    ...EDIT_TOOLS,
    'Bash',
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
