import type { CSSProperties } from 'react'
import { NavLink } from 'react-router-dom'

export default function TopNav() {
  return (
    <nav className="topnav" style={{ borderBottom: '1px solid #ddd', padding: 8 }}>
      <span style={{ fontWeight: 600, marginRight: 16 }}>LEGION</span>
      <NavLink to="/templates" style={navStyle}>Templates</NavLink>
      <NavLink to="/instances" style={navStyle}>Instances</NavLink>
      <NavLink to="/settings" style={navStyle}>Settings</NavLink>
    </nav>
  )
}

const navStyle = ({ isActive }: { isActive: boolean }): CSSProperties => ({
  marginRight: 12,
  color: isActive ? '#0066cc' : '#333',
  textDecoration: 'none',
  fontWeight: isActive ? 600 : 400,
})
