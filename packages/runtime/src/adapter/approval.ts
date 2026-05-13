import { ulid } from 'ulid'

export interface ToolRequest {
  tool: string
  input: unknown
}

export interface PermissionRequest extends ToolRequest {
  approvalId: string
}

export interface Decision {
  allow: boolean
  reason?: string
}

type Listener = (req: PermissionRequest) => void

export class ApprovalOrchestrator {
  private listeners: Listener[] = []
  private pending = new Map<string, (d: Decision) => void>()

  constructor(private readonly allowedTools: string[]) {}

  on(_event: 'permission_request', l: Listener): void {
    this.listeners.push(l)
  }

  async decide(req: ToolRequest): Promise<Decision> {
    if (this.matchesAllowed(req)) return { allow: true }
    const approvalId = ulid()
    const permReq: PermissionRequest = { ...req, approvalId }
    const promise = new Promise<Decision>((resolve) => {
      this.pending.set(approvalId, resolve)
    })
    for (const l of this.listeners) l(permReq)
    return promise
  }

  resolve(approvalId: string, decision: Decision): void {
    const resolver = this.pending.get(approvalId)
    if (!resolver) throw new Error(`No pending approval with id: ${approvalId}`)
    this.pending.delete(approvalId)
    resolver(decision)
  }

  private matchesAllowed(req: ToolRequest): boolean {
    for (const pat of this.allowedTools) {
      if (pat === req.tool) return true
      if (pat.startsWith(`${req.tool}(`)) {
        if (matchBashPattern(pat, req)) return true
      }
    }
    return false
  }
}

function matchBashPattern(pat: string, req: ToolRequest): boolean {
  const m = pat.match(/^Bash\((.*)\)$/)
  if (!m) return false
  if (req.tool !== 'Bash') return false
  const input = req.input as { command?: string }
  const command = input?.command ?? ''
  const innerPat = m[1]!
  const regex = new RegExp(
    '^' + innerPat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
  )
  return regex.test(command)
}
