import { describe, test, expect } from 'bun:test'
import { join, resolve } from 'node:path'
import { TemplateRegistry } from '@legion/runtime/template/registry'

const REPO_ROOT = resolve(import.meta.dir, '../../../..')

describe('TemplateRegistry', () => {
  test('discovers YAML files under workflows/', async () => {
    const reg = new TemplateRegistry(join(REPO_ROOT, 'workflows'))
    await reg.refresh()
    const ids = reg.list().map((t) => t.id)
    expect(ids).toContain('feature-implementation')
  })

  test('get returns the template by id', async () => {
    const reg = new TemplateRegistry(join(REPO_ROOT, 'workflows'))
    await reg.refresh()
    const t = reg.get('feature-implementation')
    expect(t).toBeDefined()
    expect(t!.nodes.some((n) => n.type === 'role')).toBe(true)
  })

  test('get returns undefined for unknown id', async () => {
    const reg = new TemplateRegistry(join(REPO_ROOT, 'workflows'))
    await reg.refresh()
    expect(reg.get('nope')).toBeUndefined()
  })

  test('sourcePathOf returns the YAML path for known templates', async () => {
    const reg = new TemplateRegistry(join(REPO_ROOT, 'workflows'))
    await reg.refresh()
    const p = reg.sourcePathOf('feature-implementation')
    expect(p).toMatch(/feature-implementation\.yaml$/)
  })

  test('sourcePathOf returns undefined for unknown id', async () => {
    const reg = new TemplateRegistry(join(REPO_ROOT, 'workflows'))
    await reg.refresh()
    expect(reg.sourcePathOf('nope')).toBeUndefined()
  })

  test('refreshOne reloads a single template from disk', async () => {
    const reg = new TemplateRegistry(join(REPO_ROOT, 'workflows'))
    await reg.refresh()
    const before = reg.get('feature-with-review')!
    const dir1 = before.nodes.find((n) => n.id === 'director')!
    expect(dir1.position).toBeUndefined()

    await reg.refreshOne('feature-with-review')
    const after = reg.get('feature-with-review')!
    expect(after.id).toBe('feature-with-review')
  })

  test('refreshOne throws for unknown id', async () => {
    const reg = new TemplateRegistry(join(REPO_ROOT, 'workflows'))
    await reg.refresh()
    await expect(reg.refreshOne('nope')).rejects.toThrow(/unknown template/)
  })
})
