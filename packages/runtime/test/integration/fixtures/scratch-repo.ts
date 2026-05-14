import { $ } from 'bun'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface ScratchRepo {
  path: string
  cleanup: () => Promise<void>
}

/**
 * Create a throwaway git repo with one initial commit and a workflows/ directory
 * containing the legion sample workflow yamls. Caller is responsible for cleanup().
 */
export async function makeScratchRepo(): Promise<ScratchRepo> {
  const path = await mkdtemp(join(tmpdir(), 'legion-it-'))
  await $`git init -b main`.cwd(path).quiet()
  await $`git config user.email it@example.com`.cwd(path).quiet()
  await $`git config user.name "legion integration"`.cwd(path).quiet()
  await writeFile(join(path, 'README.md'), '# scratch\n\nplaceholder.\n')
  await mkdir(join(path, 'workflows'), { recursive: true })
  await writeFile(
    join(path, 'workflows', 'bug-fix.yaml'),
    [
      'id: bug-fix',
      'name: Bug Fix',
      'description: Single-Implementer fix.',
      'nodes:',
      '  - id: trigger',
      '    type: trigger',
      '    kind: manual',
      '  - id: director',
      '    type: role',
      '    role: director',
      '    provider: claude-code',
      '    lifetime: per-workflow',
      '  - id: implementer',
      '    type: role',
      '    role: implementer',
      '    provider: claude-code',
      '    lifetime: per-task',
      'edges:',
      '  - { from: trigger,  to: director,    type: triggers }',
      '  - { from: director, to: implementer, type: delegates }',
      '',
    ].join('\n'),
  )
  await $`git add -A`.cwd(path).quiet()
  await $`git commit -m initial`.cwd(path).quiet()
  return {
    path,
    cleanup: async () => {
      await $`rm -rf ${path}`.quiet().nothrow()
    },
  }
}
