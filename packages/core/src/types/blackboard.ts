// D-014, D-016: Blackboard is the unified substrate for cross-instance communication.
// Local and remote variants share this interface; local-bus is an implementation optimization.

export interface BlackboardMessage<T = unknown> {
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
  ): Promise<BlackboardMessage<T>>

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
  ): Promise<BlackboardMessage[]>

  stream(subscriptionId: string): AsyncIterable<BlackboardMessage>
}
