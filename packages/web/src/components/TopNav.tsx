import type { CSSProperties } from 'react'
import { NavLink } from 'react-router-dom'
import { ThemeToggle } from '../theme/ThemeToggle'

export default function TopNav() {
  return (
    <nav
      className="topnav"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        borderBottom: '1px solid var(--border-default)',
        padding: 8,
        background: 'var(--bg-surface)',
      }}
    >
      <span style={{ fontWeight: 600, marginRight: 16 }}>LEGION</span>
      <NavLink to="/templates" style={navStyle}>Templates</NavLink>
      <NavLink to="/instances" style={navStyle}>Instances</NavLink>
      <NavLink to="/settings" style={navStyle}>Settings</NavLink>
      <div style={{ marginLeft: 'auto' }}>
        <ThemeToggle />
      </div>
    </nav>
  )
}

const navStyle = ({ isActive }: { isActive: boolean }): CSSProperties => ({
  color: isActive ? 'var(--accent)' : 'var(--fg-muted)',
  textDecoration: 'none',
  fontWeight: isActive ? 600 : 400,
})
