import { $ } from 'bun'
import { normalize } from 'node:path'

export interface WorktreeAddOptions {
  path: string
  commit: string
  branch?: string
  detach?: boolean
}

export interface WorktreeListEntry {
  path: string
  head: string
  branch?: string
  detached: boolean
}

export async function resolveCommitSha(repoCwd: string, ref: string): Promise<string> {
  const out = await $`git rev-parse ${ref}`.cwd(repoCwd).quiet().text()
  const sha = out.trim()
  if (!/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error(`resolveCommitSha: unexpected output for ref ${ref}: ${sha}`)
  }
  return sha
}

export async function worktreeAdd(repoCwd: string, opts: WorktreeAddOptions): Promise<void> {
  if (opts.branch && opts.detach) {
    throw new Error('worktreeAdd: cannot use both branch and detach')
  }
  if (opts.branch) {
    await $`git worktree add -b ${opts.branch} ${opts.path} ${opts.commit}`
      .cwd(repoCwd)
      .quiet()
    return
  }
  if (opts.detach) {
    await $`git worktree add --detach ${opts.path} ${opts.commit}`.cwd(repoCwd).quiet()
    return
  }
  throw new Error('worktreeAdd: must specify branch or detach=true')
}

export async function worktreeRemove(repoCwd: string, wtPath: string): Promise<void> {
  await $`git worktree remove ${wtPath}`.cwd(repoCwd).quiet()
}

export async function worktreeList(repoCwd: string): Promise<WorktreeListEntry[]> {
  const out = await $`git worktree list --porcelain`.cwd(repoCwd).quiet().text()
  return parseWorktreeListPorcelain(out)
}

function flushEntry(current: Partial<WorktreeListEntry>, entries: WorktreeListEntry[]): void {
  const { path, head, branch, detached } = current
  if (!path || !head) return
  const entry: WorktreeListEntry = { path, head, detached: detached ?? false }
  if (branch !== undefined) entry.branch = branch
  entries.push(entry)
}

function parseWorktreeListPorcelain(text: string): WorktreeListEntry[] {
  const entries: WorktreeListEntry[] = []
  let current: Partial<WorktreeListEntry> = {}
  for (const line of text.split('\n')) {
    if (line === '' || line === '\r') {
      flushEntry(current, entries)
      current = {}
      continue
    }
    const trimmed = line.trimEnd()
    const spaceIdx = trimmed.indexOf(' ')
    const key = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
    const value = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1)
    if (key === 'worktree') current.path = normalize(value)
    else if (key === 'HEAD') current.head = value
    else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '')
    else if (key === 'detached') current.detached = true
  }
  flushEntry(current, entries)
  return entries
}

export async function branchExists(repoCwd: string, branch: string): Promise<boolean> {
  const proc = await $`git show-ref --verify --quiet refs/heads/${branch}`
    .cwd(repoCwd)
    .quiet()
    .nothrow()
  return proc.exitCode === 0
}

export async function branchDelete(repoCwd: string, branch: string): Promise<void> {
  await $`git branch -D ${branch}`.cwd(repoCwd).quiet()
}
