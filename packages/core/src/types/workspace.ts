// D-024: One Agent Instance owns one WorkspaceRef.
// In Phase 1 only the `owned` variant is implemented at runtime; `shared` is reserved.

export type WorkspaceRef =
  | { kind: 'owned'; path: string; branch?: string }
  | { kind: 'shared'; targetInstanceId: string; mode: 'ro' | 'rw' }
