import { $ } from 'bun'
import type { AppRuntime } from '../../app'

export async function handleInstanceDiff(
  instanceId: string,
  ctx: AppRuntime,
): Promise<Response> {
  const inst = ctx.store.get(instanceId)
  if (!inst) return new Response('Not Found', { status: 404 })

  const rows = ctx.agentInstanceStore
    .listByWorkflow(instanceId)
    .filter((r) => r.branchName !== null)

  const out: Array<{ agentInstanceId: string; branch: string; diff: string }> = []
  for (const r of rows) {
    const branch = r.branchName!
    const diffProc = await $`git diff ${inst.baseCommitSha}..${branch}`
      .cwd(ctx.options.repoPath)
      .quiet()
      .nothrow()
    const diff = diffProc.exitCode === 0 ? diffProc.stdout.toString() : ''
    out.push({ agentInstanceId: r.id, branch, diff })
  }
  return Response.json(out)
}
