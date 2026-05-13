import { $ } from 'bun'
import type { WorkspaceProvider, WorkspaceDescriptor } from '../workspace/provider'
import { branchDelete, branchExists } from '../workspace/git'

export type Classification =
  | { kind: 'safe' }
  | { kind: 'confirm-required'; reason: string }

export async function classifyForCleanup(
  repoCwd: string,
  desc: WorkspaceDescriptor,
): Promise<Classification> {
  const branch = (desc.ref as { branch?: string }).branch
  if (!branch) return { kind: 'safe' }
  if (!(await branchExists(repoCwd, branch))) return { kind: 'safe' }
  const aheadProc = await $`git rev-list --count main..${branch}`
    .cwd(repoCwd)
    .quiet()
    .nothrow()
  const ahead = aheadProc.exitCode === 0 ? aheadProc.stdout.toString() : '0'
  const aheadCount = parseInt(ahead.trim() || '0', 10)
  if (aheadCount === 0) return { kind: 'safe' }
  return {
    kind: 'confirm-required',
    reason: `branch ${branch} has ${aheadCount} unmerged commits`,
  }
}

export interface RunCleanupInput {
  provider: WorkspaceProvider
  repoPath: string
  /**
   * - 'safe-only': remove safe ones, skip confirm-required silently.
   * - 'confirm-each': call onConfirm per confirm-required entry.
   */
  mode: 'safe-only' | 'confirm-each'
  workflowInstanceId?: string
  onConfirm?: (desc: WorkspaceDescriptor, reason: string) => Promise<boolean>
}

export interface RunCleanupResult {
  removed: WorkspaceDescriptor[]
  skipped: { desc: WorkspaceDescriptor; reason: string }[]
}

export async function runCleanup(input: RunCleanupInput): Promise<RunCleanupResult> {
  const list = await input.provider.list(input.workflowInstanceId)
  const removed: WorkspaceDescriptor[] = []
  const skipped: { desc: WorkspaceDescriptor; reason: string }[] = []
  for (const desc of list) {
    const c = await classifyForCleanup(input.repoPath, desc)
    if (c.kind === 'safe') {
      await removeOne(input, desc)
      removed.push(desc)
      continue
    }
    if (input.mode === 'safe-only') {
      skipped.push({ desc, reason: c.reason })
      continue
    }
    const ok = input.onConfirm ? await input.onConfirm(desc, c.reason) : false
    if (!ok) {
      skipped.push({ desc, reason: c.reason })
      continue
    }
    await removeOne(input, desc)
    removed.push(desc)
  }
  return { removed, skipped }
}

async function removeOne(input: RunCleanupInput, desc: WorkspaceDescriptor): Promise<void> {
  await input.provider.destroy(desc)
  const branch = (desc.ref as { branch?: string }).branch
  if (branch && (await branchExists(input.repoPath, branch))) {
    await branchDelete(input.repoPath, branch)
  }
}
