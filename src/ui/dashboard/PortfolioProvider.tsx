import { useContext, type ReactNode } from 'react'
import { PortfolioContext, useSharedPortfolio } from './usePortfolio.ts'

/** Loads the portfolio and keeps its prices up to date once for every page, and the header. */
export function PortfolioProvider({ children }: { children: ReactNode }) {
  const portfolio = useSharedPortfolio()
  return <PortfolioContext.Provider value={portfolio}>{children}</PortfolioContext.Provider>
}

/** The value of the portfolio today, with the options of the settings; undefined without data. */
export function useTotalValue(): number | undefined {
  return useContext(PortfolioContext)?.baseSeries?.points.at(-1)?.value
}
