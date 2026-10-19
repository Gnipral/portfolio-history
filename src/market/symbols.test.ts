import { describe, expect, it } from 'vitest'
import { chooseListing } from './openFigi.ts'
import { isValidSymbol, micForSymbol, preferredFigiExchanges, splitSymbol, yahooSymbol } from './symbols.ts'

describe('symbols', () => {
  it('prefers the broker exchange, then the home exchange, then the US', () => {
    expect(preferredFigiExchanges('NL0010273215', 'EAM')).toEqual(['NA', 'US'])
    expect(preferredFigiExchanges('US22788C1053', 'TDG')).toEqual(['US'])
    expect(preferredFigiExchanges('DE0007030009', 'XET')).toEqual(['GY', 'GR', 'US'])
    expect(preferredFigiExchanges('IE000OJ5TQP4', 'XET')).toEqual(['GY', 'GR', 'US'])
    expect(preferredFigiExchanges('KYG6683N1034', 'TDG')).toEqual(['US'])
    expect(preferredFigiExchanges('GB0009697037', 'LSE')).toEqual(['LN', 'US'])
  })

  it('builds Yahoo symbols', () => {
    expect(yahooSymbol('ASML', 'NA')).toBe('ASML.AS')
    expect(yahooSymbol('BRK/B', 'US')).toBe('BRK-B')
    expect(yahooSymbol('X', 'ZZ')).toBeUndefined()
  })

  it('splits suffixes only for known exchanges', () => {
    expect(splitSymbol('RHM.DE')).toEqual({ ticker: 'RHM', suffix: '.DE' })
    expect(splitSymbol('BRK-B')).toEqual({ ticker: 'BRK-B', suffix: '' })
    expect(splitSymbol('BF.B')).toEqual({ ticker: 'BF.B', suffix: '' })
    expect(micForSymbol('ASML.AS')).toBe('XAMS')
    expect(micForSymbol('AAPL')).toBeUndefined()
  })

  it('validates manual input', () => {
    expect(isValidSymbol('VWCE.DE')).toBe(true)
    expect(isValidSymbol('crypto:bitcoin')).toBe(false)
    expect(isValidSymbol('a b')).toBe(false)
  })
})

describe('chooseListing', () => {
  const listings = [
    { ticker: 'ASML', exchCode: 'US', name: 'ASML HOLDING NV-NY REG SHS' },
    { ticker: 'ASML', exchCode: 'NA', name: 'ASML HOLDING NV' },
    { ticker: 'ASME', exchCode: 'GY', name: 'ASML HOLDING NV' },
  ]

  it('picks the listing on the broker exchange', () => {
    expect(chooseListing({ isin: 'NL0010273215', brokerExchange: 'EAM' }, listings)).toEqual({
      symbol: 'ASML.AS',
      name: 'ASML HOLDING NV',
    })
  })

  it('uses the German composite listing for Xetra ETFs', () => {
    const etf = [
      { ticker: 'NATO', exchCode: 'LN' },
      { ticker: 'ASWC', exchCode: 'GR' },
    ]
    expect(chooseListing({ isin: 'IE000OJ5TQP4', brokerExchange: 'XET' }, etf)?.symbol).toBe('ASWC.DE')
  })

  it('falls back to the US listing, then any supported listing', () => {
    expect(chooseListing({ isin: 'US0000000000' }, listings)?.symbol).toBe('ASML')
    expect(chooseListing({ isin: 'XX0000000000' }, [{ ticker: 'ABC', exchCode: 'GY' }])?.symbol).toBe('ABC.DE')
    expect(chooseListing({ isin: 'XX0000000000' }, [{ ticker: 'ABC', exchCode: 'ZZ' }])).toBeUndefined()
  })
})
