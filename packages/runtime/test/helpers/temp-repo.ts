import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { $ } from 'bun'

export interface TempRepo {
  path: string
  cleanup: () => Promise<void>
}

/**
 * Initializes a git repo in a fresh temp directory with one initial commit on
 * a branch named "main". Returns the absolute path and a cleanup function.
 */
export async function makeTempRepo(): Promise<TempRepo> {
  const path = await mkdtemp(join(tmpdir(), 'legion-test-'))
  await $`git init -b main`.cwd(path).quiet()
  await $`git config user.email test@legion.local`.cwd(path).quiet()
  await $`git config user.name "legion test"`.cwd(path).quiet()
  await writeFile(join(path, 'README.md'), '# scratch\n')
  await $`git add README.md`.cwd(path).quiet()
  await $`git commit -m "initial"`.cwd(path).quiet()
  return {
    path,
    cleanup: async () => {
      await rm(path, { recursive: true, force: true })
    },
  }
}
