import { describe, test, expect } from 'bun:test'
import { SessionStore, EventInjector, type SessionState } from '@legion/runtime/adapter/session-store'
import { ApprovalOrchestrator } from '@legion/runtime/adapter/approval'

function fakeSession(id: string): SessionState {
  return {
    sessionId: id,
    iter: (async function* () {})(),
    approval: new ApprovalOrchestrator([]),
    workdir: '/tmp',
    role: 'implementer',
    injector: new EventInjector(),
  }
}

describe('SessionStore', () => {
  test('set then get returns the same state', () => {
    const store = new SessionStore()
    const s = fakeSession('a')
    store.set(s)
    expect(store.get('a').sessionId).toBe('a')
  })

  test('has reports existence', () => {
    const store = new SessionStore()
    store.set(fakeSession('a'))
    expect(store.has('a')).toBe(true)
    expect(store.has('b')).toBe(false)
  })

  test('get on unknown id throws', () => {
    const store = new SessionStore()
    expect(() => store.get('missing')).toThrow(/missing/)
  })

  test('delete removes the entry', () => {
    const store = new SessionStore()
    store.set(fakeSession('a'))
    store.delete('a')
    expect(store.has('a')).toBe(false)
  })

  test('list returns all states', () => {
    const store = new SessionStore()
    store.set(fakeSession('a'))
    store.set(fakeSession('b'))
    const list = store.list()
    expect(list.map((s) => s.sessionId).sort()).toEqual(['a', 'b'])
  })
})
