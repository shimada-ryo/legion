import { AppearanceSection } from '../theme/AppearanceSection'

export default function Settings() {
  return (
    <div style={{ padding: 16 }}>
      <h2>Settings</h2>
      <AppearanceSection />
      <p style={{ color: 'var(--fg-muted)' }}>
        Provider 設定 / auth 状態 / port 等は Phase 1.5 以降で実装します。
      </p>
    </div>
  )
}
