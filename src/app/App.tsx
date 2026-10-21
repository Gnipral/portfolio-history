import { NavLink, Navigate, Route, Routes } from 'react-router'
import { OfflineBadge } from '../ui/components/OfflineBadge.tsx'
import { ThemeToggle } from '../ui/components/ThemeToggle.tsx'
import { UpdateBanner } from '../ui/components/UpdateBanner.tsx'
import { AnalysisPage } from '../ui/pages/AnalysisPage.tsx'
import { DashboardPage } from '../ui/pages/DashboardPage.tsx'
import { ImportPage } from '../ui/pages/ImportPage.tsx'
import { PricesPage } from '../ui/pages/PricesPage.tsx'
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
          <NavLink to="/analysis">Analysis</NavLink>
          <NavLink to="/import">Import</NavLink>
          <NavLink to="/prices">Prices</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <OfflineBadge />
        <ThemeToggle />
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/analysis" element={<AnalysisPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/prices" element={<PricesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  )
}
