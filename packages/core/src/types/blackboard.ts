// Phase 3 (D-049): Blackboard auto-publish + agent publish ツール用の message 型。
// publishes エッジで宣言された topic (user-defined) と runtime auto-publish (system.*) の両方を表す。
//
// D-014, D-016: Channel-based pub/sub contract (BlackboardChannelMessage / Blackboard).
// BlackboardMessage<T> was renamed to BlackboardChannelMessage<T> in Phase 3 to avoid
// conflict with the new topic-based BlackboardMessage introduced by D-049.

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

export interface BlackboardChannelMessage<T = unknown> {
  id: string
  channelId: string
  publisherAgentInstanceId: string
  workflowInstanceId: string
  payload: T
  publishedAt: Date
}

export interface BlackboardSubscription {
  id: string
  channelId: string
  subscriberAgentInstanceId: string
  workflowInstanceId: string
  createdAt: Date
}

export interface Blackboard {
  publish<T>(
    channelId: string,
    workflowInstanceId: string,
    publisherAgentInstanceId: string,
    payload: T,
  ): Promise<BlackboardChannelMessage<T>>

  subscribe(
    channelId: string,
    workflowInstanceId: string,
    subscriberAgentInstanceId: string,
  ): Promise<BlackboardSubscription>

  unsubscribe(subscriptionId: string): Promise<void>

  poll(
    subscriptionId: string,
    afterMessageId?: string,
    limit?: number,
  ): Promise<BlackboardChannelMessage[]>

  stream(subscriptionId: string): AsyncIterable<BlackboardChannelMessage>
}
