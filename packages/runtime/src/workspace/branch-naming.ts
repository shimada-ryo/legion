export function wfShortId(workflowInstanceId: string): string {
  return workflowInstanceId.slice(0, 8).toLowerCase()
}

const ROLE_ABBREVIATION: Record<string, string> = {
  implementer: 'impl',
}

export function branchName(wfShortId: string, role: string, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error(`branchName: seq must be a positive integer, got ${seq}`)
  }
  const abbr = ROLE_ABBREVIATION[role] ?? role
  return `legion/${wfShortId}/${abbr}-${seq}`
}
