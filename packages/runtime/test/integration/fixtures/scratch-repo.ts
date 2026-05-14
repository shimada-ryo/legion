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
  // Pre-create src/ with placeholder files so Implementer agents do not need
  // `mkdir` (which is not in the role-profile Bash whitelist and would block
  // on a permission_request that no one can approve in tests).
  await mkdir(join(path, 'src'), { recursive: true })
  await writeFile(join(path, 'src', 'hello.ts'), 'export function hello(): string { return "hello" }\n')
  await writeFile(join(path, 'src', 'math.ts'), '// placeholder for math helpers\n')
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
  await writeFile(
    join(path, 'workflows', 'feature-with-review.yaml'),
    [
      'id: feature-with-review',
      'name: Feature with Reviewer (Phase 3)',
      'description: Director->Implementer->Reviewer with retry up to 3 times.',
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
      '  - id: reviewer',
      '    type: role',
      '    role: reviewer',
      '    provider: codex',
      '    lifetime: per-task',
      '  - id: review-results',
      '    type: blackboard',
      '    schema:',
      '      decision: string',
      '      feedback: string',
      'edges:',
      '  - { from: trigger,     to: director,       type: triggers }',
      '  - { from: director,    to: implementer,    type: delegates }',
      '  - { from: implementer, to: reviewer,       type: reviews }',
      '  - { from: reviewer,    to: review-results, type: publishes }',
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
