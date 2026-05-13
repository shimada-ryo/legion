import { Routes, Route, Navigate } from 'react-router-dom'
import TopNav from './components/TopNav'
import TemplatesList from './pages/TemplatesList'
import TemplateDetail from './pages/TemplateDetail'
import InstancesList from './pages/InstancesList'
import InstanceDetail from './pages/InstanceDetail'
import Settings from './pages/Settings'

export default function App() {
  return (
    <div className="app">
      <TopNav />
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/instances" replace />} />
          <Route path="/templates" element={<TemplatesList />} />
          <Route path="/templates/:id" element={<TemplateDetail />} />
          <Route path="/instances" element={<InstancesList />} />
          <Route path="/instances/:id" element={<InstanceDetail />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}
