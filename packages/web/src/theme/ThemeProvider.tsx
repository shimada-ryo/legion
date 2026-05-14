import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Mode = 'light' | 'dark' | 'system'
export type Resolved = 'light' | 'dark'

const STORAGE_KEY = 'legion.web.theme'

interface ThemeContextValue {
  mode: Mode
  resolved: Resolved
  setMode: (m: Mode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function readStoredMode(): Mode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {}
  return 'system'
}

function osPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

function resolve(mode: Mode): Resolved {
  if (mode === 'system') return osPrefersDark() ? 'dark' : 'light'
  return mode
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>(() => readStoredMode())
  const [resolved, setResolved] = useState<Resolved>(() => resolve(readStoredMode()))

  // Apply data-theme to <html> whenever resolved changes.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved)
  }, [resolved])

  // Persist mode and recompute resolved on every change.
  const setMode = (next: Mode) => {
    try { localStorage.setItem(STORAGE_KEY, next) } catch {}
    setModeState(next)
    setResolved(resolve(next))
  }

  // Subscribe to OS change only while mode === 'system'.
  useEffect(() => {
    if (mode !== 'system') return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setResolved(e.matches ? 'dark' : 'light')
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [mode])

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
