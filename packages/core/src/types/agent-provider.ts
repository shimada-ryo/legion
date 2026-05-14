// Provider adapter contract. Each coding-agent CLI (Claude Code, Codex, Gemini, ...)
// implements AgentProvider so the runtime can drive them uniformly.

export interface AgentCapabilities {
  supportsCheckpoint: boolean
  supportsResume: boolean
  supportsAttach: boolean
  supportsApprovalFlow: boolean
}

export interface ProviderDetection {
  installed: boolean
  version?: string
  path?: string
}

export interface AuthStatus {
  authenticated: boolean
  account?: string
}

export interface LaunchRequest {
  workdir: string
  role: string
  initialPrompt: string
  model?: string
  env?: Record<string, string>
  /**
   * D-037: In-process MCP server map. Keys are server names, values are
   * `McpSdkServerConfigWithInstance` (or other McpServerConfig types) from
   * `@anthropic-ai/claude-agent-sdk`. Treated as opaque here so this package
   * stays free of an SDK dependency. The Claude Code provider forwards this
   * straight to the SDK's `mcpServers` option.
   */
  mcpServers?: Record<string, unknown>
}

export interface SessionHandle {
  sessionId: string
  pid?: number
}

export interface SendOptions {
  approveAll?: boolean
}

export interface PtyHandle {
  write(data: string): void
  resize(cols: number, rows: number): void
  close(): void
}

export interface Checkpoint {
  id: string
  createdAt: Date
  metadata: Record<string, unknown>
}

export type AgentEventType =
  | 'output'
  | 'tool_call'
  | 'permission_request'
  | 'status_change'
  | 'message'
  | 'error'

export interface AgentEvent {
  id: string
  sessionId: string
  type: AgentEventType
  payload: unknown
  timestamp: Date
}

export interface Transcript {
  sessionId: string
  events: AgentEvent[]
}

export interface AgentProvider {
  id: string
  displayName: string
  capabilities: AgentCapabilities

  detect(): Promise<ProviderDetection>
  authenticate(): Promise<AuthStatus>

  launch(input: LaunchRequest): Promise<SessionHandle>
  send(sessionId: string, message: string, options?: SendOptions): Promise<void>
  interrupt(sessionId: string): Promise<void>
  approve(sessionId: string, approvalId: string): Promise<void>
  deny(sessionId: string, approvalId: string, reason?: string): Promise<void>

  status(sessionId: string): Promise<unknown>
  stream(sessionId: string): AsyncIterable<AgentEvent>
  // D-032: attach() and PtyHandle are unused in Phase 1 (Agent SDK has no PTY).
  // Implementations whose capabilities.supportsAttach is false may omit this method.
  attach?(sessionId: string): Promise<PtyHandle>

  checkpoint(sessionId: string): Promise<Checkpoint>
  resume(sessionId: string, checkpoint?: string): Promise<SessionHandle>
  shutdown(sessionId: string): Promise<void>

  exportTranscript(sessionId: string): Promise<Transcript>
}
