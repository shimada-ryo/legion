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

describe('REVIEWER_PROMPT (Phase 3)', () => {
  test('reviewer prompt mentions structured output and decision values', () => {
    const p = defaultSystemPromptFor('reviewer')
    expect(p.length).toBeGreaterThan(0)
    expect(p).toContain('Reviewer')
    expect(p).toContain('decision')
    expect(p).toContain('approve')
    expect(p).toContain('request-changes')
    expect(p).toContain('reject')
    expect(p).toContain('JSON')
  })

  test('reviewer prompt does NOT instruct edits or commits', () => {
    const p = defaultSystemPromptFor('reviewer')
    expect(p).not.toContain('git add')
    expect(p).not.toContain('git commit')
    expect(p).not.toContain('Edit files')
  })
})
