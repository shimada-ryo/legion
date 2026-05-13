// D-028: .legion.yaml schema. Phase 1 implements worktree.setup and worktree.copyFiles.
// worktree.ports is reserved for Phase 3 (D-029).

export interface LegionWorktreeConfig {
  setup?: string[]
  copyFiles?: string[]
  ports?: Record<string, unknown>
}

export interface LegionConfig {
  worktree?: LegionWorktreeConfig
}
