import { mkdir } from 'node:fs/promises'
import { join, normalize } from 'node:path'
import type { WorkspaceRef } from '@legion/core'
import { worktreeAdd, worktreeRemove, worktreeList } from './git'
import { branchName, wfShortId } from './branch-naming'
import { repoFingerprint } from './repo-fingerprint'
import type {
  WorkspaceCreateInput,
  WorkspaceDescriptor,
  WorkspaceProvider,
} from './provider'

export interface LocalWorktreeProviderOptions {
  /** Path to the target repository. */
  repoPath: string
  /** Base directory where worktrees are created. Default: ~/.legion/worktrees */
  baseDir: string
}

const DETACHED_ROLES = new Set(['director', 'reviewer'])

export class LocalWorktreeProvider implements WorkspaceProvider {
  constructor(private readonly opts: LocalWorktreeProviderOptions) {}

  async create(input: WorkspaceCreateInput): Promise<WorkspaceDescriptor> {
    const path = this.pathFor(input)
    await mkdir(join(path, '..'), { recursive: true })
    if (DETACHED_ROLES.has(input.role)) {
      const target = input.reviewTargetBranch ?? input.baseCommitSha
      await worktreeAdd(this.opts.repoPath, {
        path,
        commit: target,
        detach: true,
      })
      return { ref: { kind: 'owned', path }, path }
    }
    const branch = branchName(wfShortId(input.workflowInstanceId), input.role, input.seq)
    await worktreeAdd(this.opts.repoPath, {
      path,
      commit: input.baseCommitSha,
      branch,
    })
    return { ref: { kind: 'owned', path, branch }, path }
  }

  async destroy(descriptor: WorkspaceDescriptor): Promise<void> {
    const list = await worktreeList(this.opts.repoPath)
    if (!list.some((w) => normalize(w.path) === normalize(descriptor.path))) return
    await worktreeRemove(this.opts.repoPath, descriptor.path)
  }

  async list(workflowInstanceId?: string): Promise<WorkspaceDescriptor[]> {
    const all = await worktreeList(this.opts.repoPath)
    const prefix = workflowInstanceId
      ? join(this.opts.baseDir, repoFingerprint(this.opts.repoPath), workflowInstanceId)
      : join(this.opts.baseDir, repoFingerprint(this.opts.repoPath))
    return all
      .filter((w) => normalize(w.path).startsWith(normalize(prefix)))
      .map((w) => ({
        path: w.path,
        ref: w.branch
          ? ({ kind: 'owned', path: w.path, branch: w.branch } as WorkspaceRef)
          : ({ kind: 'owned', path: w.path } as WorkspaceRef),
      }))
  }

  private pathFor(input: WorkspaceCreateInput): string {
    return join(
      this.opts.baseDir,
      repoFingerprint(this.opts.repoPath),
      input.workflowInstanceId,
      input.agentInstanceId,
    )
  }
}
