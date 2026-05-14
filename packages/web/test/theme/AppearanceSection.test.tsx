import { describe, test, expect, afterEach } from 'bun:test'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ThemeProvider } from '../../src/theme/ThemeProvider'
import { AppearanceSection } from '../../src/theme/AppearanceSection'

function setup(initial: 'light' | 'dark' | 'system' = 'system') {
  localStorage.clear()
  if (initial !== 'system') localStorage.setItem('legion.web.theme', initial)
  ;(window as any).matchMedia = () => ({
    matches: false,
    media: '',
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
  })
  return render(<ThemeProvider><AppearanceSection /></ThemeProvider>)
}

describe('AppearanceSection', () => {
  afterEach(cleanup)

  test('renders all three radios', () => {
    setup()
    expect(screen.getByLabelText('Light')).toBeDefined()
    expect(screen.getByLabelText('Dark')).toBeDefined()
    expect(screen.getByLabelText(/System/)).toBeDefined()
  })

  test('checks the radio matching current mode', () => {
    setup('dark')
    expect((screen.getByLabelText('Dark') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Light') as HTMLInputElement).checked).toBe(false)
  })

  test('selecting Light updates state and persists', () => {
    setup('system')
    fireEvent.click(screen.getByLabelText('Light'))
    expect(localStorage.getItem('legion.web.theme')).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  test('selecting System restores system mode', () => {
    setup('dark')
    fireEvent.click(screen.getByLabelText(/System/))
    expect(localStorage.getItem('legion.web.theme')).toBe('system')
  })
})
