import { describe, test, expect } from 'bun:test'
import { branchName, wfShortId } from '@legion/runtime/workspace/branch-naming'

describe('wfShortId', () => {
  test('returns first 8 chars of a ULID-shaped string', () => {
    const ulid = '01J9X5Z8YK0123456789ABCDEF'
    expect(wfShortId(ulid)).toBe('01j9x5z8')
  })

  test('lower-cases the input', () => {
    expect(wfShortId('01J9X5Z8YK0000000000000000')).toBe('01j9x5z8')
  })
})

describe('branchName', () => {
  test('formats as legion/<wfShortId>/<role>-<seq>', () => {
    expect(branchName('01j9x5z8', 'implementer', 1)).toBe('legion/01j9x5z8/impl-1')
  })

  test('uses canonical role abbreviation', () => {
    expect(branchName('01j9x5z8', 'director', 1)).toBe('legion/01j9x5z8/director')
    expect(branchName('01j9x5z8', 'reviewer', 1)).toBe('legion/01j9x5z8/reviewer-1')
  })

  test('zero seq throws (sequence must be >= 1)', () => {
    expect(() => branchName('01j9x5z8', 'implementer', 0)).toThrow()
  })
})
