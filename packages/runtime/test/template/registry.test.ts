import { describe, test, expect } from 'bun:test'
import { join } from 'node:path'
import { TemplateRegistry } from '@legion/runtime/template/registry'

describe('TemplateRegistry', () => {
  test('discovers YAML files under workflows/', async () => {
    const reg = new TemplateRegistry(join(process.cwd(), 'workflows'))
    await reg.refresh()
    const ids = reg.list().map((t) => t.id)
    expect(ids).toContain('feature-implementation')
  })

  test('get returns the template by id', async () => {
    const reg = new TemplateRegistry(join(process.cwd(), 'workflows'))
    await reg.refresh()
    const t = reg.get('feature-implementation')
    expect(t).toBeDefined()
    expect(t!.nodes.some((n) => n.type === 'role')).toBe(true)
  })

  test('get returns undefined for unknown id', async () => {
    const reg = new TemplateRegistry(join(process.cwd(), 'workflows'))
    await reg.refresh()
    expect(reg.get('nope')).toBeUndefined()
  })
})
