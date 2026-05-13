import { LocalWorktreeProvider } from '@legion/runtime/workspace/local-worktree-provider'
import { runCleanup } from '@legion/runtime/cleanup/cleanup'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface CleanupArgs {
  repoPath: string
  workflowInstanceId?: string
  yes?: boolean
}

export async function cleanupCommand(args: CleanupArgs): Promise<void> {
  const baseDir = process.env['LEGION_WT_BASE'] ?? join(homedir(), '.legion', 'worktrees')
  const provider = new LocalWorktreeProvider({ repoPath: args.repoPath, baseDir })
  const result = await runCleanup({
    provider,
    repoPath: args.repoPath,
    mode: args.yes ? 'confirm-each' : 'safe-only',
    ...(args.workflowInstanceId !== undefined ? { workflowInstanceId: args.workflowInstanceId } : {}),
    ...(args.yes ? { onConfirm: async (): Promise<boolean> => true } : {}),
  })
  console.log(`removed: ${result.removed.length}`)
  for (const r of result.removed) console.log(`  - ${r.path}`)
  if (result.skipped.length > 0) {
    console.log(`skipped (unmerged): ${result.skipped.length}`)
    for (const s of result.skipped) console.log(`  - ${s.desc.path}: ${s.reason}`)
    console.log('Run with --yes to force-remove unmerged branches.')
  }
}
