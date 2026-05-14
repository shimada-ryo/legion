import { useTheme } from './ThemeProvider'

export function ThemeToggle() {
  const { resolved, setMode } = useTheme()
  const next = resolved === 'light' ? 'dark' : 'light'
  const glyph = resolved === 'light' ? '☀' : '☾'
  const label = `Switch to ${next} theme`

  return (
    <button
      type="button"
      onClick={() => setMode(next)}
      aria-label={label}
      title={label}
      style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        border: '1px solid var(--border-default)',
        background: 'var(--bg-surface)',
        color: 'var(--fg-primary)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 13,
        lineHeight: 1,
        padding: 0,
      }}
    >
      {glyph}
    </button>
  )
}
