import { lazy, Suspense } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router'
import { t } from '../i18n/i18n.ts'
import { useSettings } from '../settings/settings.ts'
import { DemoBanner } from '../ui/components/DemoBanner.tsx'
import { NavIcon } from '../ui/components/NavIcon.tsx'
import { OfflineBadge } from '../ui/components/OfflineBadge.tsx'
import { ThemeToggle } from '../ui/components/ThemeToggle.tsx'
import { UpdateBanner } from '../ui/components/UpdateBanner.tsx'
import { ErrorBoundary } from '../ui/errors/ErrorBoundary.tsx'
import { setDisplayCurrency } from '../ui/format.ts'
import { DashboardPage } from '../ui/pages/DashboardPage.tsx'

// The dashboard comes first; every other page loads when it is opened.
const AnalysisPage = lazy(() => import('../ui/pages/AnalysisPage.tsx').then((m) => ({ default: m.AnalysisPage })))
const ComparePage = lazy(() => import('../ui/pages/ComparePage.tsx').then((m) => ({ default: m.ComparePage })))
const ImportPage = lazy(() => import('../ui/pages/ImportPage.tsx').then((m) => ({ default: m.ImportPage })))
const PricesPage = lazy(() => import('../ui/pages/PricesPage.tsx').then((m) => ({ default: m.PricesPage })))
const SettingsPage = lazy(() => import('../ui/pages/SettingsPage.tsx').then((m) => ({ default: m.SettingsPage })))
const SharedCardPage = lazy(() => import('../ui/pages/SharedCardPage.tsx').then((m) => ({ default: m.SharedCardPage })))
const TransactionsPage = lazy(() => import('../ui/pages/TransactionsPage.tsx').then((m) => ({ default: m.TransactionsPage })))

export function App() {
  // Set while rendering, before any page below formats an amount.
  setDisplayCurrency(useSettings()?.baseCurrency ?? 'EUR')
  const { pathname } = useLocation()
  return (
    <>
      <UpdateBanner />
      <DemoBanner />
      <header className="app-header">
        <h1 className="brand">
          <img src={`${import.meta.env.BASE_URL}brand/gnipral-mark.svg`} alt="Gnipral" width={28} height={28} />
          Portfolio History
        </h1>
        <nav className="app-nav">
          <NavLink to="/" end>
            <NavIcon name="dashboard" />
            {t('Dashboard')}
          </NavLink>
          <NavLink to="/analysis">
            <NavIcon name="analysis" />
            {t('Analysis')}
          </NavLink>
          <NavLink to="/import">
            <NavIcon name="import" />
            {t('Import')}
          </NavLink>
          <NavLink to="/prices">
            <NavIcon name="prices" />
            {t('Prices')}
          </NavLink>
          <NavLink to="/settings">
            <NavIcon name="settings" />
            {t('Settings')}
          </NavLink>
        </nav>
        <OfflineBadge />
        <ThemeToggle />
      </header>
      <main className="app-main">
        <ErrorBoundary resetKey={pathname}>
          <Suspense fallback={null}>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/analysis" element={<AnalysisPage />} />
              <Route path="/import" element={<ImportPage />} />
              <Route path="/transactions" element={<TransactionsPage />} />
              <Route path="/prices" element={<PricesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/s/:data" element={<SharedCardPage />} />
              <Route path="/c/:data" element={<ComparePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
    </>
  )
}
