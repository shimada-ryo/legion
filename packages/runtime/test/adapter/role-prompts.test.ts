import { describe, test, expect } from 'bun:test'
import { defaultSystemPromptFor } from '@legion/runtime/adapter/role-prompts'

describe('defaultSystemPromptFor', () => {
  test('director prompt mentions the delegate tool and the BLOCKING contract', () => {
    const p = defaultSystemPromptFor('director')
    expect(p).toContain('delegate(role, prompt)')
    expect(p).toContain('BLOCKING')
  })

  test('director prompt forbids editing files directly', () => {
    expect(defaultSystemPromptFor('director')).toContain('MUST NOT attempt to edit files')
  })

  test('implementer prompt requires a git commit before ending', () => {
    const p = defaultSystemPromptFor('implementer')
    expect(p).toContain('git add -A && git commit')
    expect(p).toContain('MUST commit before ending')
  })

  test('unknown roles return an empty string (legacy fallback)', () => {
    expect(defaultSystemPromptFor('unknown-role')).toBe('')
  })
})
