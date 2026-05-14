import { describe, test, expect } from 'bun:test'
import { buildInitialPrompt } from '@legion/runtime/orchestrator/spawn-agent'

describe('buildInitialPrompt', () => {
  test('embeds the user prompt and role context', () => {
    const p = buildInitialPrompt({ role: 'director', userPrompt: 'Add a /health endpoint.' })
    expect(p.toLowerCase()).toContain('director')
    expect(p).toContain('Add a /health endpoint.')
  })

  test('prepends the director system prompt', () => {
    const p = buildInitialPrompt({ role: 'director', userPrompt: 'do X' })
    expect(p).toContain('You are the Director agent')
    expect(p).toContain('Task: do X')
  })

  test('prepends the implementer system prompt', () => {
    const p = buildInitialPrompt({ role: 'implementer', userPrompt: 'do Y' })
    expect(p).toContain('You are an Implementer agent')
  })

  test('falls back to a generic line for unknown roles', () => {
    expect(buildInitialPrompt({ role: 'xyz', userPrompt: 'do Z' })).toContain('"xyz"')
  })
})
