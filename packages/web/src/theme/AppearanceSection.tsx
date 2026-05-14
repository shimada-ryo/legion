import type { Mode } from './ThemeProvider'
import { useTheme } from './ThemeProvider'

const OPTIONS: { value: Mode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System に追従' },
]

export function AppearanceSection() {
  const { mode, setMode } = useTheme()
  return (
    <section style={{ marginBottom: 24 }}>
      <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 14, color: 'var(--fg-muted)' }}>
        Appearance
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {OPTIONS.map((opt) => (
          <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="radio"
              name="theme-mode"
              value={opt.value}
              checked={mode === opt.value}
              onChange={() => setMode(opt.value)}
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </div>
    </section>
  )
}
