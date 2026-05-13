import { $ } from 'bun'
import type { AppRuntime } from '../../app'

export async function handleInstanceDiff(
  instanceId: string,
  ctx: AppRuntime,
): Promise<Response> {
  const inst = ctx.store.get(instanceId)
  if (!inst) return new Response('Not Found', { status: 404 })
  const list = await ctx.worktree.list(instanceId)
  const out: Array<{ agentPath: string; branch: string | null; diff: string }> = []
  for (const w of list) {
    const branch = (w.ref as { branch?: string }).branch ?? null
    if (!branch) {
      out.push({ agentPath: w.path, branch: null, diff: '' })
      continue
    }
    const diffProc = await $`git diff ${'main'}..${branch}`
      .cwd(ctx.options.repoPath)
      .quiet()
      .nothrow()
    const diff = diffProc.exitCode === 0 ? diffProc.stdout.toString() : ''
    out.push({ agentPath: w.path, branch, diff })
  }
  return Response.json(out)
}
