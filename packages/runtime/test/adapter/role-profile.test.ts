import { describe, test, expect } from 'bun:test'
import { defaultAllowedToolsFor } from '@legion/runtime/adapter/role-profile'

describe('defaultAllowedToolsFor', () => {
  test('director gets read-only tools', () => {
    const tools = defaultAllowedToolsFor('director')
    expect(tools).toEqual(expect.arrayContaining(['Read', 'Glob', 'Grep']))
    expect(tools).not.toContain('Edit')
    expect(tools).not.toContain('Write')
  })

  test('implementer gets edit + read tools', () => {
    const tools = defaultAllowedToolsFor('implementer')
    expect(tools).toEqual(
      expect.arrayContaining(['Read', 'Edit', 'Write', 'Glob', 'Grep']),
    )
  })

  test('reviewer gets read-only tools (same shape as director)', () => {
    const tools = defaultAllowedToolsFor('reviewer')
    expect(tools).toEqual(expect.arrayContaining(['Read', 'Glob', 'Grep']))
    expect(tools).not.toContain('Edit')
  })

  test('unknown role returns empty profile (deny by default)', () => {
    const tools = defaultAllowedToolsFor('mystery')
    expect(tools).toEqual([])
  })

  test('implementer has at least one Bash subcommand pattern allowed', () => {
    const tools = defaultAllowedToolsFor('implementer')
    expect(tools.some((t) => t.startsWith('Bash('))).toBe(true)
  })
})
