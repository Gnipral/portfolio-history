/**
 * Instruments are priced by a Yahoo-style symbol: `TICKER` for US listings, `TICKER.SUFFIX` elsewhere
 * (e.g. `ASML.AS`, `RHM.DE`). Providers translate it to their own format.
 */

interface Venue {
  /** OpenFIGI / Bloomberg exchange code. */
  figi: string
  /** Yahoo Finance suffix, empty for US. */
  yahoo: string
  /** ISO 10383 market identifier, used by Twelve Data. */
  mic?: string
}

const VENUES: Venue[] = [
  { figi: 'US', yahoo: '' },
  { figi: 'NA', yahoo: '.AS', mic: 'XAMS' },
  { figi: 'GY', yahoo: '.DE', mic: 'XETR' },
  // German composite: ETFs on Xetra are often listed only under GR.
  { figi: 'GR', yahoo: '.DE', mic: 'XETR' },
  { figi: 'GF', yahoo: '.F', mic: 'XFRA' },
  { figi: 'FP', yahoo: '.PA', mic: 'XPAR' },
  { figi: 'BB', yahoo: '.BR', mic: 'XBRU' },
  { figi: 'LN', yahoo: '.L', mic: 'XLON' },
  { figi: 'IM', yahoo: '.MI', mic: 'XMIL' },
  { figi: 'SM', yahoo: '.MC', mic: 'XMAD' },
  { figi: 'SW', yahoo: '.SW', mic: 'XSWX' },
  { figi: 'SS', yahoo: '.ST', mic: 'XSTO' },
  { figi: 'DC', yahoo: '.CO', mic: 'XCSE' },
  { figi: 'NO', yahoo: '.OL', mic: 'XOSL' },
  { figi: 'FH', yahoo: '.HE', mic: 'XHEL' },
  { figi: 'PL', yahoo: '.LS', mic: 'XLIS' },
  { figi: 'AV', yahoo: '.VI', mic: 'XWBO' },
  { figi: 'CN', yahoo: '.TO', mic: 'XTSE' },
  { figi: 'AT', yahoo: '.AX', mic: 'XASX' },
  { figi: 'HK', yahoo: '.HK', mic: 'XHKG' },
]

/**
 * DEGIRO reference exchange codes. EAM, XET, EPA, LSE, NDQ and NSY are verified with a real export;
 * TDG (Tradegate) quotes foreign shares in EUR, so the home listing is used instead.
 */
const DEGIRO_EXCHANGES: Record<string, string[]> = {
  NDQ: ['US'],
  NSY: ['US'],
  ASE: ['US'],
  EAM: ['NA'],
  XET: ['GY', 'GR'],
  FRA: ['GF', 'GR'],
  EPA: ['FP'],
  EBR: ['BB'],
  LSE: ['LN'],
  MIL: ['IM'],
  MAD: ['SM'],
  SWX: ['SW'],
}

/** Home exchange by ISIN country, used when the broker's exchange has no own listing (e.g. Tradegate). */
const HOME_EXCHANGE: Record<string, string> = {
  US: 'US',
  NL: 'NA',
  DE: 'GY',
  FR: 'FP',
  BE: 'BB',
  GB: 'LN',
  IT: 'IM',
  ES: 'SM',
  CH: 'SW',
  SE: 'SS',
  DK: 'DC',
  NO: 'NO',
  FI: 'FH',
  PT: 'PL',
  AT: 'AV',
  CA: 'CN',
  AU: 'AT',
  HK: 'HK',
}

export function preferredFigiExchanges(isin: string | undefined, brokerExchange: string | undefined): string[] {
  const preferred: string[] = []
  const fromBroker = brokerExchange ? DEGIRO_EXCHANGES[brokerExchange.toUpperCase()] : undefined
  if (fromBroker) preferred.push(...fromBroker)
  const home = isin ? HOME_EXCHANGE[isin.slice(0, 2).toUpperCase()] : undefined
  if (home && !preferred.includes(home)) preferred.push(home)
  // Companies registered elsewhere (e.g. Cayman Islands) are often listed in the US.
  if (!preferred.includes('US')) preferred.push('US')
  return preferred
}

export function yahooSymbol(ticker: string, figiExchange: string): string | undefined {
  const venue = VENUES.find((v) => v.figi === figiExchange)
  if (!venue) return undefined
  return `${ticker.trim().replace(/[/ ]/g, '-')}${venue.yahoo}`
}

export function splitSymbol(symbol: string): { ticker: string; suffix: string } {
  const dot = symbol.lastIndexOf('.')
  // Class shares such as BRK-B have no suffix; a suffix is a known exchange code.
  if (dot > 0 && VENUES.some((v) => v.yahoo === symbol.slice(dot))) {
    return { ticker: symbol.slice(0, dot), suffix: symbol.slice(dot) }
  }
  return { ticker: symbol, suffix: '' }
}

export function micForSymbol(symbol: string): string | undefined {
  const { suffix } = splitSymbol(symbol)
  return VENUES.find((v) => v.yahoo === suffix)?.mic
}

/** Valid manual input: letters, digits and . - ^ = _ (as accepted by the proxy). */
export function isValidSymbol(symbol: string): boolean {
  return /^[A-Za-z0-9.^=_-]{1,20}$/.test(symbol)
}
