import { lazy, Suspense, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router'
import { t } from '../i18n/i18n.ts'
import { useSettings } from '../settings/settings.ts'
import { AccountButton } from '../ui/components/AccountButton.tsx'
import { DemoBanner } from '../ui/components/DemoBanner.tsx'
import { HeaderValue } from '../ui/components/HeaderValue.tsx'
import { HideAmountsToggle } from '../ui/components/HideAmountsToggle.tsx'
import { NavIcon, type NavIconName } from '../ui/components/NavIcon.tsx'
import { OfflineBadge } from '../ui/components/OfflineBadge.tsx'
import { ThemeToggle } from '../ui/components/ThemeToggle.tsx'
import { UpdateBanner } from '../ui/components/UpdateBanner.tsx'
import { PortfolioProvider } from '../ui/dashboard/PortfolioProvider.tsx'
import { ErrorBoundary } from '../ui/errors/ErrorBoundary.tsx'
import { setAmountsHidden, setDisplayCurrency } from '../ui/format.ts'
import { NoticeHostProvider, NoticeStrip } from '../ui/notices/Notices.tsx'
import { DashboardPage } from '../ui/pages/DashboardPage.tsx'
import { PeriodProvider } from '../ui/period/PeriodProvider.tsx'
import { useHideAmounts } from '../ui/privacy.ts'

// The dashboard comes first; every other page loads when it is opened.
const AnalysisPage = lazy(() => import('../ui/pages/AnalysisPage.tsx').then((m) => ({ default: m.AnalysisPage })))
const DataCheckPage = lazy(() => import('../ui/pages/DataCheckPage.tsx').then((m) => ({ default: m.DataCheckPage })))
const ComparePage = lazy(() => import('../ui/pages/ComparePage.tsx').then((m) => ({ default: m.ComparePage })))
const ImportPage = lazy(() => import('../ui/pages/ImportPage.tsx').then((m) => ({ default: m.ImportPage })))
const PricesPage = lazy(() => import('../ui/pages/PricesPage.tsx').then((m) => ({ default: m.PricesPage })))
const SettingsPage = lazy(() => import('../ui/pages/SettingsPage.tsx').then((m) => ({ default: m.SettingsPage })))
const SharedCardPage = lazy(() => import('../ui/pages/SharedCardPage.tsx').then((m) => ({ default: m.SharedCardPage })))
const TransactionsPage = lazy(() => import('../ui/pages/TransactionsPage.tsx').then((m) => ({ default: m.TransactionsPage })))

const NAV: { to: string; label: string; icon: NavIconName }[] = [
  { to: '/', label: t('Dashboard'), icon: 'dashboard' },
  { to: '/analysis', label: t('Analysis'), icon: 'analysis' },
  { to: '/import', label: t('Import'), icon: 'import' },
  { to: '/transactions', label: t('Transactions'), icon: 'transactions' },
  { to: '/prices', label: t('Prices'), icon: 'prices' },
  { to: '/settings', label: t('Settings'), icon: 'settings' },
]

export function App() {
  const settings = useSettings()
  // Set while rendering, before any page below formats an amount.
  setDisplayCurrency(settings?.baseCurrency ?? 'EUR', settings?.decimals ?? 2)
  const [hidden, setHidden] = useHideAmounts()
  setAmountsHidden(hidden)
  const { pathname } = useLocation()
  const [noticeHost, setNoticeHost] = useState<HTMLElement | null>(null)

  return (
    <PortfolioProvider>
      <PeriodProvider>
        <NoticeHostProvider element={noticeHost}>
          <header className="shell-header">
            <div className="shell-bar">
              <NavLink to="/" end className="shell-brand" aria-label={t('Portfolio History, dashboard')}>
                <img src={`${import.meta.env.BASE_URL}brand/gnipral-mark.svg`} alt="" width={28} height={28} />
                <span className="shell-brand-name">
                  <strong>Gnipral</strong>
                  <span>{t('Portfolio History')}</span>
                </span>
              </NavLink>
              <nav className="app-nav" aria-label={t('Pages')}>
                {NAV.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.to === '/'}>
                    <NavIcon name={item.icon} />
                    {item.label}
                  </NavLink>
                ))}
              </nav>
              <div className="shell-tools">
                <HeaderValue />
                <HideAmountsToggle hidden={hidden} onChange={setHidden} />
                <OfflineBadge />
                <ThemeToggle />
                <AccountButton />
              </div>
            </div>
          </header>
          <NoticeStrip host={setNoticeHost}>
            <UpdateBanner />
            <DemoBanner />
          </NoticeStrip>
          {/* Drawn again from scratch when amounts are hidden or shown, so the charts pick up the change too. */}
          <main className="app-main" key={hidden ? 'hidden' : 'shown'}>
            <ErrorBoundary resetKey={pathname}>
              <Suspense fallback={null}>
                <Routes>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/analysis" element={<AnalysisPage />} />
                  <Route path="/import" element={<ImportPage />} />
                  <Route path="/transactions" element={<TransactionsPage />} />
                  <Route path="/prices" element={<PricesPage />} />
                  <Route path="/check" element={<DataCheckPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/s/:data" element={<SharedCardPage />} />
                  <Route path="/c/:data" element={<ComparePage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </main>
        </NoticeHostProvider>
      </PeriodProvider>
    </PortfolioProvider>
  )
}
