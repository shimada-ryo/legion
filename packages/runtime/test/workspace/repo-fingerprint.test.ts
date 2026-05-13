import { describe, test, expect } from 'bun:test'
import { repoFingerprint } from '@legion/runtime/workspace/repo-fingerprint'

describe('repoFingerprint', () => {
  test('combines basename and short hash of absolute path', () => {
    const fp = repoFingerprint('/home/me/code/legion')
    expect(fp).toMatch(/^legion-[a-f0-9]{8}$/)
  })

  test('same path produces same fingerprint (deterministic)', () => {
    const a = repoFingerprint('/home/me/code/legion')
    const b = repoFingerprint('/home/me/code/legion')
    expect(a).toBe(b)
  })

  test('different paths with same basename produce different fingerprints', () => {
    const a = repoFingerprint('/home/me/code/legion')
    const b = repoFingerprint('/tmp/other/legion')
    expect(a).not.toBe(b)
  })

  test('Windows-style path is accepted (normalized)', () => {
    const fp = repoFingerprint('D:\\Projects\\Misc\\legion')
    expect(fp).toMatch(/^legion-[a-f0-9]{8}$/)
  })
})
