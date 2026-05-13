import { access, copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { $ } from 'bun'
import type { LegionConfig } from '@legion/core'

export interface RunWorktreeSetupInput {
  mainRepoPath: string
  worktreePath: string
  config: LegionConfig
}

export async function runWorktreeSetup(input: RunWorktreeSetupInput): Promise<void> {
  const wt = input.config.worktree
  if (!wt) return

  if (wt.copyFiles) {
    for (const rel of wt.copyFiles) {
      const src = join(input.mainRepoPath, rel)
      const dst = join(input.worktreePath, rel)
      try {
        await access(src)
      } catch {
        throw new Error(`copyFiles: source not found: ${rel}`)
      }
      await mkdir(dirname(dst), { recursive: true })
      await copyFile(src, dst)
    }
  }

  if (wt.setup) {
    for (const cmd of wt.setup) {
      // Bun shell `$` is a cross-platform POSIX-like parser bundled with Bun.
      // Using `$({ raw: [cmd] })` passes the command string as a raw shell expression
      // without delegating to /bin/sh, so this works on Windows too.
      // Redirects (>) and other shell syntax are supported by Bun's built-in parser.
      const proc = await $({ raw: [cmd] } as unknown as TemplateStringsArray)
        .cwd(input.worktreePath)
        .quiet()
        .nothrow()
      if (proc.exitCode !== 0) {
        throw new Error(
          `setup command failed (exit ${proc.exitCode}): ${cmd}\nstderr: ${proc.stderr.toString()}`,
        )
      }
    }
  }
}
