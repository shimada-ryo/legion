// Phase 3 (D-049): Blackboard auto-publish + agent publish ツール用の message 型。
// publishes エッジで宣言された topic (user-defined) と runtime auto-publish (system.*) の両方を表す。

export interface BlackboardMessage {
  /** ULID. */
  id: string
  /** 関連付けされた workflow instance。 */
  workflowInstanceId: string
  /** topic 名。system 系は 'system.' プレフィックス (system.delegate.start, system.delegate.result, system.review.decision)、ユーザー定義は任意文字列。 */
  topic: string
  /** publish した agent_instance.id。runtime auto-publish の場合 null。 */
  publisherAgentId: string | null
  /** JSON.parse 可能な任意の payload。 */
  payload: unknown
  /** UNIX epoch milliseconds。 */
  publishedAt: number
}
