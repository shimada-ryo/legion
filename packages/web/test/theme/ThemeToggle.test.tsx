import { describe, test, expect, afterEach } from 'bun:test'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ThemeProvider } from '../../src/theme/ThemeProvider'
import { ThemeToggle } from '../../src/theme/ThemeToggle'

function setup(mode: 'light' | 'dark' | 'system' = 'system', prefersDark = false) {
  localStorage.clear()
  if (mode !== 'system') localStorage.setItem('legion.web.theme', mode)
  ;(window as any).matchMedia = (q: string) => ({
    matches: q.includes('dark') ? prefersDark : false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
  })
  return render(<ThemeProvider><ThemeToggle /></ThemeProvider>)
}

describe('ThemeToggle', () => {
  afterEach(cleanup)

  test('renders sun glyph when resolved=light', () => {
    setup('light')
    expect(screen.getByRole('button').textContent).toContain('☀')
  })

  test('renders moon glyph when resolved=dark', () => {
    setup('dark')
    expect(screen.getByRole('button').textContent).toContain('☾')
  })

  test('aria-label reflects the next state', () => {
    setup('light')
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('Switch to dark theme')
  })

  test('click flips to opposite of current resolved', () => {
    setup('light')
    fireEvent.click(screen.getByRole('button'))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem('legion.web.theme')).toBe('dark')
  })
})
