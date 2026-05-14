import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { render, screen, act, cleanup } from '@testing-library/react'
import { ThemeProvider, useTheme } from '../../src/theme/ThemeProvider'

function Probe() {
  const { mode, resolved, setMode } = useTheme()
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="resolved">{resolved}</span>
      <button onClick={() => setMode('dark')}>set-dark</button>
      <button onClick={() => setMode('system')}>set-system</button>
    </div>
  )
}

function mockMatchMedia(prefersDark: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>()
  const mql = {
    matches: prefersDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: 'change', fn: (e: { matches: boolean }) => void) => listeners.add(fn),
    removeEventListener: (_: 'change', fn: (e: { matches: boolean }) => void) => listeners.delete(fn),
    dispatchEvent: () => true,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
  }
  ;(window as any).matchMedia = (q: string) =>
    q.includes('dark') ? mql : { ...mql, matches: false }
  return {
    setPrefersDark(next: boolean) {
      mql.matches = next
      listeners.forEach((fn) => fn({ matches: next }))
    },
  }
}

describe('ThemeProvider', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  test('defaults to mode=system and resolves from prefers-color-scheme=dark', () => {
    mockMatchMedia(true)
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(screen.getByTestId('mode').textContent).toBe('system')
    expect(screen.getByTestId('resolved').textContent).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  test('reads existing localStorage value on mount', () => {
    localStorage.setItem('legion.web.theme', 'light')
    mockMatchMedia(true)
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(screen.getByTestId('mode').textContent).toBe('light')
    expect(screen.getByTestId('resolved').textContent).toBe('light')
  })

  test('setMode persists to localStorage and updates DOM', () => {
    mockMatchMedia(false)
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => { screen.getByText('set-dark').click() })
    expect(localStorage.getItem('legion.web.theme')).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(screen.getByTestId('mode').textContent).toBe('dark')
    expect(screen.getByTestId('resolved').textContent).toBe('dark')
  })

  test('mode=system follows OS preference change', () => {
    const ctrl = mockMatchMedia(false)
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(screen.getByTestId('resolved').textContent).toBe('light')
    act(() => { ctrl.setPrefersDark(true) })
    expect(screen.getByTestId('resolved').textContent).toBe('dark')
  })

  test('explicit mode does not follow OS preference change', () => {
    const ctrl = mockMatchMedia(false)
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => { screen.getByText('set-dark').click() })
    act(() => { ctrl.setPrefersDark(false) })
    expect(screen.getByTestId('resolved').textContent).toBe('dark')
  })
})
