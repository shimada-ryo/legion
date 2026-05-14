// packages/core/src/types/delegate.ts
// D-037, D-038, D-053: Director / Implementer の custom tool。
// Phase 3 で Reviewer 向け decision/feedback を追加 (D-050)。
// 同期 blocking で spawned agent の完了まで戻らない。

export interface DelegateToolInput {
  /** Role to spawn. Phase 3 は 'implementer' (Director→Implementer) と 'reviewer' (Implementer→Reviewer) を受理。 */
  role: string
  /** Self-contained prompt for the spawned agent. spawned agent は original user prompt を見ない。 */
  prompt: string
  /** Optional one-line rationale. event log にのみ書く。 */
  rationale?: string
}

export interface DelegateToolOutput {
  /** The spawned AgentInstance.id. */
  agentInstanceId: string
  /** Reviewer の場合: review 対象 branch (= caller の branch)。Implementer の場合: Implementer が commit した branch。 */
  branchName: string
  /** 'completed' = session ended normally; 'failed' = provider threw. */
  status: 'completed' | 'failed'
  /** Reviewer のみセット。outputSchema で構造化された JSON から抽出。 */
  decision?: 'approve' | 'request-changes' | 'reject'
  /** decision='request-changes' のときの修正指示。Reviewer のみセット。 */
  feedback?: string
  /** Last assistant message from the spawned agent, truncated to ~500 chars. Reviewer の場合は decision を含む raw JSON ではなく自由記述部分。 */
  summary: string
  /** status='failed' のときのみ。 */
  error?: string
}
