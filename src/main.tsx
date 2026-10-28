import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import { App } from './app/App.tsx'
import { db } from './data/db.ts'
import { isDemo } from './demo/demoMode.ts'
import { seedDemo } from './demo/demoPortfolio.ts'
import { localToday } from './market/dates.ts'
import { applyStoredTheme } from './theme/theme.ts'
import './theme/global.css'

applyStoredTheme()

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root not found')

// The demo portfolio is filled before the first render, so the dashboard never flashes empty.
const ready = isDemo() ? seedDemo(db, localToday()).catch((error: unknown) => console.error('Demo data', error)) : Promise.resolve()

void ready.then(() =>
  createRoot(root).render(
    <StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </StrictMode>,
  ),
)
