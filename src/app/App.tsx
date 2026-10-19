import { NavLink, Navigate, Route, Routes } from 'react-router'
import { ThemeToggle } from '../ui/components/ThemeToggle.tsx'
import { UpdateBanner } from '../ui/components/UpdateBanner.tsx'
import { DashboardPage } from '../ui/pages/DashboardPage.tsx'
import { ImportPage } from '../ui/pages/ImportPage.tsx'
import { SettingsPage } from '../ui/pages/SettingsPage.tsx'

export function App() {
  return (
    <>
      <UpdateBanner />
      <header className="app-header">
        <h1 className="brand">
          <img src={`${import.meta.env.BASE_URL}brand/gnipral-mark.svg`} alt="Gnipral" width={28} height={28} />
          Portfolio History
        </h1>
        <nav className="app-nav">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/import">Import</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <ThemeToggle />
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  )
}
