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

  test('director profile includes the delegate tool', () => {
    expect(defaultAllowedToolsFor('director')).toContain('mcp__legion__delegate')
  })

  test('implementer profile includes git commit-related bash whitelisted entries', () => {
    const p = defaultAllowedToolsFor('implementer')
    expect(p).toContain('Bash(git add*)')
    expect(p).toContain('Bash(git commit*)')
    expect(p).toContain('Bash(git status*)')
    expect(p).toContain('Bash(git diff*)')
  })

  test('reviewer profile remains read-only (no delegate, no git)', () => {
    const p = defaultAllowedToolsFor('reviewer')
    expect(p).not.toContain('mcp__legion__delegate')
    expect(p.some((t) => t.startsWith('Bash('))).toBe(false)
  })

  test('director profile includes mcp__legion__delegate and mcp__legion__publish', () => {
    const tools = defaultAllowedToolsFor('director')
    expect(tools).toContain('mcp__legion__delegate')
    expect(tools).toContain('mcp__legion__publish')
  })

  test('implementer profile includes mcp__legion__delegate and mcp__legion__publish (Phase 3)', () => {
    const tools = defaultAllowedToolsFor('implementer')
    expect(tools).toContain('mcp__legion__delegate')
    expect(tools).toContain('mcp__legion__publish')
    // Phase 2 narrow already adds Bash(git*) — preserved
    expect(tools).toContain('Bash(git add*)')
    expect(tools).toContain('Bash(git commit*)')
  })

  test('reviewer profile is read-only plus mcp__legion__publish (no delegate)', () => {
    const tools = defaultAllowedToolsFor('reviewer')
    expect(tools).toContain('mcp__legion__publish')
    expect(tools).not.toContain('mcp__legion__delegate')
    expect(tools).not.toContain('Edit')
  })
})
