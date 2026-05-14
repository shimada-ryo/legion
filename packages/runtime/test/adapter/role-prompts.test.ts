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

describe('IMPLEMENTER_PROMPT (Phase 3 retry loop)', () => {
  test('instructs Implementer to call delegate(role=reviewer) after committing', () => {
    const p = defaultSystemPromptFor('implementer')
    expect(p).toContain("delegate(role='reviewer'")
    expect(p).toContain('After you commit')
  })

  test('explains all three decision outcomes', () => {
    const p = defaultSystemPromptFor('implementer')
    expect(p).toContain('approve')
    expect(p).toContain('request-changes')
    expect(p).toContain('reject')
  })

  test('enforces a soft cap of 3 review iterations', () => {
    const p = defaultSystemPromptFor('implementer')
    expect(p).toContain('3')
    expect(p).toContain('iterations')
  })

  test('describes the no-reviewer fallback so Phase 2 workflows still work', () => {
    const p = defaultSystemPromptFor('implementer')
    expect(p).toContain('Reviewer is not wired')
  })

  test('retains Phase 2 commit-required instructions', () => {
    const p = defaultSystemPromptFor('implementer')
    expect(p).toContain('git add -A && git commit')
    expect(p).toContain('worktree')
    expect(p).toContain('MUST commit before ending')
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
