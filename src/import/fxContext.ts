import { db, type PortfolioDatabase } from '../data/db.ts'
import { localToday } from '../market/dates.ts'
import { FxRates } from '../market/fx.ts'
import { syncFx } from '../market/staticData.ts'
import type { ImportContext } from './types.ts'

/**
 * Exchange rates for adapters whose exports have no EUR amounts. Brings the cached ECB rates up
 * to date first; offline, the cached rates are used and missing ones are reported per row.
 */
export async function loadImportContext(database: PortfolioDatabase = db): Promise<ImportContext> {
  await syncFx(database, localToday())
  const rates = new FxRates(await database.fxDays.toArray())
  return { toEur: (amount, currency, date) => rates.toEur(amount, currency, date) }
}
