import { describe, test, expect } from 'bun:test'
import { $ } from 'bun'
import { makeTempRepo } from './temp-repo'

describe('makeTempRepo', () => {
  test('initializes a git repo on main with one commit', async () => {
    const repo = await makeTempRepo()
    try {
      const result = await $`git rev-parse --abbrev-ref HEAD`.cwd(repo.path).quiet().text()
      expect(result.trim()).toBe('main')
      const count = await $`git rev-list --count HEAD`.cwd(repo.path).quiet().text()
      expect(parseInt(count.trim(), 10)).toBe(1)
    } finally {
      await repo.cleanup()
    }
  })
})
