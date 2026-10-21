import { describe, expect, it } from 'vitest'
import type { Transaction } from '../../model/transaction.ts'
import { readCsv, readFlexXml } from '../readFile.ts'
import { importTables } from '../registry.ts'
import { finalHoldings } from '../summary.ts'
import { fixedRates } from './kit.ts'
import { yahooTicker } from './xtb.ts'
import { krakenAsset } from './kraken.ts'

/** Synthetic rows in each broker's layout; all names, ids and amounts are made up. */
const RATES = fixedRates({ USD: 1.25, GBX: 85 })

function load(name: string, ...files: string[]) {
  const tables = files.flatMap((content, i) => readCsv(`${name}-${i}.csv`, content))
  return importTables(tables, { context: RATES })
}

function only(transactions: Transaction[], type: Transaction['type']): Transaction[] {
  return transactions.filter((t) => t.type === type)
}

function errors(result: ReturnType<typeof load>) {
  return result.issues.filter((i) => i.severity === 'error')
}

describe('Trade Republic', () => {
  const csv = [
    '"datetime","date","account_type","category","type","asset_class","name","symbol","shares","price","amount","fee","tax","currency","original_amount","original_currency","fx_rate","description","transaction_id"',
    '"2025-01-02T09:00:00.000Z","2025-01-02","DEFAULT","CASH","CUSTOMER_INPAYMENT","","","","","","1000.00","","","EUR","","","","Deposit","a1"',
    '"2025-01-03T10:00:00.000Z","2025-01-03","DEFAULT","TRADING","BUY","STOCK","Example Corp","US0000000001","4.0000000000","100.000000","-400.00","-1.00","","EUR","","","","BUY","a2"',
    '"2025-03-01T07:30:00.000Z","2025-03-01","DEFAULT","CORPORATE_ACTION","DIVIDEND","STOCK","Example Corp","US0000000001","4.0000000000","","2.00","","-0.30","EUR","","","","Dividend","a3"',
    '"2025-04-01T00:00:00.000Z","2025-04-01","DEFAULT","CORPORATE_ACTION","SPLIT","STOCK","Example Corp","US0000000001","12.0000000000","","","","","EUR","","","","SPLIT","a4"',
    '"2025-04-02T12:00:00.000Z","2025-04-02","DEFAULT","CASH","CARD_TRANSACTION","","Shop","","","","-20.00","","","EUR","","","","Card","a5"',
  ].join('\n')

  it('reads trades, dividends with tax, splits as added shares and card payments', () => {
    const result = load('tr', csv)
    expect(result.broker).toBe('Trade Republic')
    expect(errors(result)).toEqual([])
    expect(only(result.transactions, 'buy')[0]).toMatchObject({ quantity: 4, amountEur: -400, costsEur: 1, isin: 'US0000000001' })
    expect(only(result.transactions, 'dividend')[0]).toMatchObject({ amountEur: 2, taxesEur: 0.3 })
    expect(only(result.transactions, 'split')[0]).toMatchObject({ quantity: 16, split: { ratio: 4, fromQuantity: 4 } })
    expect(only(result.transactions, 'withdrawal')[0]?.amountEur).toBe(-20)
    expect(finalHoldings(result.transactions)[0]?.quantity).toBe(16)
  })

  const header = csv.split('\n')[0] as string
  it('cancels a reversed dividend, also from a later file, and books a deposit fee separately', () => {
    const first = [
      header,
      '"2025-01-02T09:00:00.000Z","2025-01-02","DEFAULT","CASH","CUSTOMER_INPAYMENT","","","","","","352.45","-2.45","","EUR","","","","Card top-up","b1"',
      '"2025-03-01T07:30:00.000Z","2025-03-01","DEFAULT","CASH","DIVIDEND","STOCK","Example Corp","US0000000001","4.0000000000","","2.00","","-0.30","EUR","","","","Dividend","b2"',
    ].join('\n')
    const later = [
      header,
      '"2025-03-05T07:30:00.000Z","2025-03-01","DEFAULT","CASH","DIVIDEND","STOCK","Example Corp","US0000000001","4.0000000000","","-2.00","","0.30","EUR","","","","Dividend","b3"',
      '"2025-03-05T07:31:00.000Z","2025-03-01","DEFAULT","CASH","DIVIDEND","STOCK","Example Corp","US0000000001","4.0000000000","","2.00","","-0.20","EUR","","","","Dividend","b4"',
    ].join('\n')
    const result = load('tr', first, later)
    expect(only(result.transactions, 'dividend')).toEqual([expect.objectContaining({ amountEur: 2, taxesEur: 0.2 })])
    expect(only(result.transactions, 'deposit')[0]?.amountEur).toBe(352.45)
    expect(only(result.transactions, 'fee')[0]?.amountEur).toBe(-2.45)
  })

  it('books a bond redemption once: the CASH row pays, the CORPORATE_ACTION row only moves units', () => {
    const bond = [
      header,
      '"2025-01-27T00:00:00.000Z","2025-01-27","DEFAULT","TRADING","BUY","BOND","Bond 2025","DE0000000002","20.0000000000","1.000000","-20.00","","","EUR","","","","BUY","c1"',
      '"2025-03-13T00:00:00.000Z","2025-03-13","DEFAULT","CASH","FINAL_MATURITY","BOND","Bond 2025","DE0000000002","20.0000000000","","20.00","","","EUR","","","","Final Maturity","c2"',
      '"2025-03-13T00:00:00.000Z","2025-03-13","DEFAULT","CORPORATE_ACTION","FINAL_MATURITY","BOND","Bond 2025","DE0000000002","-20.0000000000","","","","","","","","","FINAL_MATURITY","c3"',
    ].join('\n')
    const result = load('tr', bond)
    expect(only(result.transactions, 'sell')).toEqual([expect.objectContaining({ quantity: 20, amountEur: 20 })])
    expect(finalHoldings(result.transactions)).toEqual([])
  })
})

describe('Trading 212', () => {
  const csv = [
    'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Notes,ID,Currency conversion fee,Currency (Currency conversion fee)',
    'Deposit,2025-01-02 09:00:00,,,,,,,,,,1000.00,EUR,,,Bank Transfer,d1,,',
    'Market buy,2025-01-03 15:00:00.123,US0000000001,EXMP,Example Corp,2.0000000000,125.00,USD,1.25000,,,200.30,EUR,,,,EOF1,0.30,EUR',
    'Dividend (Dividend),2025-03-01 07:30:00,US0000000001,EXMP,Example Corp,2.0000000000,1.00,USD,1.25000,,,1.36,EUR,0.30,USD,,,,',
    'Stock split close,2025-04-01 07:00:00,US0000000001,EXMP,Example Corp,2.0000000000,130.00,USD,1.25,,,208.00,EUR,,,,EOF2,,',
    'Stock split open,2025-04-01 07:00:01,US0000000001,EXMP,Example Corp,20.0000000000,13.00,USD,1.25,,,208.00,EUR,,,,EOF3,,',
  ].join('\n')

  it('separates fees from the total and converts withholding tax with the row rate', () => {
    const result = load('t212', csv)
    expect(result.broker).toBe('Trading 212')
    expect(errors(result)).toEqual([])
    expect(only(result.transactions, 'buy')[0]).toMatchObject({ amountEur: -200, fxCostsEur: 0.3, totalEur: -200.3, ticker: 'EXMP' })
    expect(only(result.transactions, 'dividend')[0]).toMatchObject({ amountEur: 1.6, taxesEur: 0.24 })
    expect(only(result.transactions, 'split')[0]).toMatchObject({ quantity: 20, split: { ratio: 10, fromQuantity: 2 } })
  })
})

describe('Interactive Brokers', () => {
  const trades = [
    '"CurrencyPrimary","AssetClass","Symbol","Description","ISIN","DateTime","Buy/Sell","Quantity","TradePrice","TradeMoney","IBCommission","IBCommissionCurrency"',
    '"USD","STK","EXMP","EXAMPLE CORP","US0000000001","20250103;150000","BUY","10","50.00","500.00","-2.00","EUR"',
    '"USD","CASH","EUR.USD","EUR.USD","","20250103;150100","SELL","-400","1.25","-500.00","-1.00","EUR"',
  ].join('\n')
  const cash = [
    '"CurrencyPrimary","Symbol","Description","ISIN","SettleDate","Type","Amount"',
    '"USD","EXMP","EXMP(US0000000001) CASH DIVIDEND USD 0.50 PER SHARE (Ordinary Dividend)","US0000000001","20250301","Dividends","5.00"',
    '"USD","EXMP","EXMP(US0000000001) CASH DIVIDEND USD 0.50 PER SHARE - US TAX","US0000000001","20250301","Withholding Tax","-0.75"',
  ].join('\n')
  const corporate = [
    '"CurrencyPrimary","AssetClass","Symbol","Description","ISIN","ReportDate","DateTime","Quantity","Amount","Proceeds","Type"',
    '"USD","STK","EXMP","EXMP(US0000000001) SPLIT 4 FOR 1 (EXMP, EXAMPLE CORP, US0000000001)","US0000000001","20250401","20250331;202500","30","0","0","FS"',
  ].join('\n')

  it('combines the three Flex Queries and converts commissions to the trade currency', () => {
    const result = load('ibkr', trades, cash, corporate)
    expect(result.broker).toBe('Interactive Brokers')
    expect(errors(result)).toEqual([])
    // 500 USD = 400 EUR; the 2 EUR commission = 2.50 USD = 2 EUR.
    expect(only(result.transactions, 'buy')).toHaveLength(1)
    expect(only(result.transactions, 'buy')[0]).toMatchObject({ amountEur: -400, costsEur: 2, ticker: 'EXMP' })
    expect(only(result.transactions, 'dividend')[0]).toMatchObject({ amountEur: 4, isin: 'US0000000001' })
    expect(only(result.transactions, 'tax')[0]?.amountEur).toBe(-0.6)
    expect(only(result.transactions, 'split')[0]).toMatchObject({ quantity: 40, split: { ratio: 4, fromQuantity: 10 } })
    expect(result.capabilities.dividends).toBe(true)
  })

  it('reads the Flex XML and skips summaries and cancelled trades', () => {
    const xml = `<FlexQueryResponse><FlexStatements count="1"><FlexStatement accountId="U1">
      <Trades>
        <Trade currency="USD" assetCategory="STK" symbol="EXMP" description="EXAMPLE CORP" isin="US0000000001" tradeDate="20250103" tradeTime="150000" quantity="10" tradePrice="50" tradeMoney="500" ibCommission="-2" ibCommissionCurrency="USD" buySell="BUY" transactionID="1" levelOfDetail="EXECUTION" />
        <Trade currency="USD" assetCategory="STK" symbol="EXMP" description="EXAMPLE CORP" isin="US0000000001" tradeDate="20250103" quantity="10" tradePrice="50" tradeMoney="500" buySell="BUY" levelOfDetail="SYMBOL_SUMMARY" />
        <Trade currency="USD" assetCategory="STK" symbol="EXMP" description="EXAMPLE CORP" isin="US0000000001" tradeDate="20250104" tradeTime="100000" quantity="-5" tradePrice="55" tradeMoney="-275" buySell="SELL" transactionID="2" levelOfDetail="EXECUTION" />
        <Trade currency="USD" assetCategory="STK" symbol="EXMP" description="EXAMPLE CORP" isin="US0000000001" tradeDate="20250104" tradeTime="100500" quantity="5" tradePrice="55" tradeMoney="275" buySell="SELL (Ca.)" transactionType="TradeCancel" origTransactionID="2" levelOfDetail="EXECUTION" />
      </Trades>
      <CashTransactions>
        <CashTransaction currency="USD" symbol="EXMP" description="EXMP(US0000000001) CASH DIVIDEND USD 0.50 PER SHARE" isin="US0000000001" dateTime="2025-03-01, 20:20:00" amount="5" type="Dividends" levelOfDetail="DETAIL" />
        <CashTransaction currency="USD" symbol="EXMP" description="EXMP(US0000000001) CASH DIVIDEND USD 0.50 PER SHARE" isin="US0000000001" dateTime="2025-03-02, 20:20:00" amount="-5" type="Dividends" levelOfDetail="DETAIL" />
        <CashTransaction currency="USD" description="CASH RECEIPTS &amp; TRANSFERS" reportDate="20250102" amount="1000" type="Deposits/Withdrawals" levelOfDetail="DETAIL" />
      </CashTransactions>
    </FlexStatement></FlexStatements></FlexQueryResponse>`
    const result = importTables(readFlexXml('flex.xml', xml), { context: RATES })
    expect(result.broker).toBe('Interactive Brokers')
    expect(errors(result)).toEqual([])
    expect(only(result.transactions, 'buy')).toEqual([expect.objectContaining({ quantity: 10, amountEur: -400, costsEur: 1.6, dateTime: '2025-01-03T15:00' })])
    expect(only(result.transactions, 'sell')).toEqual([])
    expect(only(result.transactions, 'dividend')).toEqual([])
    expect(only(result.transactions, 'deposit')[0]?.amountEur).toBe(800)
  })
})

describe('Revolut', () => {
  const csv = [
    'Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate',
    '2025-01-02T09:00:00.000Z,,CASH TOP-UP,,,"$1,000.00",USD,1.25',
    '2025-01-03T15:00:00.000Z,EXMP,BUY - MARKET,2,$125.00,$250.00,USD,1.25',
    '2025-04-01T08:00:00.000Z,EXMP,STOCK SPLIT,6,,$0,USD,1.25',
    '2025-05-01T08:00:00.000Z,,CUSTODY FEE,,,-$1.25,USD,1.25',
  ].join('\n')

  it('reads amounts with currency signs and splits as added shares', () => {
    const result = load('revolut', csv)
    expect(result.broker).toBe('Revolut')
    expect(only(result.transactions, 'deposit')[0]?.amountEur).toBe(800)
    expect(only(result.transactions, 'buy')[0]).toMatchObject({ amountEur: -200, quantity: 2, ticker: 'EXMP' })
    expect(only(result.transactions, 'split')[0]).toMatchObject({ quantity: 8, split: { ratio: 4, fromQuantity: 2 } })
    expect(only(result.transactions, 'fee')[0]?.amountEur).toBe(-1)
  })
})

describe('Saxo', () => {
  const csv = [
    'Client ID,Trade Date,Value Date,Type,Instrument,Instrument ISIN,Instrument currency,Exchange Description,Instrument Symbol,Event,Amount,Order ID,Conversion Rate',
    '0000000,03-Jan-2025,07-Jan-2025,Trade,Example Corp,US0000000001,USD,NASDAQ,EXMP:xnas,Buy 4 @ 125.00 USD,-403.00,1,0.80000000',
    '0000000,04-feb-2025,06-feb-2025,Transactie,Example Corp,US0000000001,USD,NASDAQ,EXMP:xnas,Verkoop 1 @ 125.00 USD,97.00,2,0.80000000',
  ].join('\n')

  it('reads quantity and price from the event and the costs from the difference', () => {
    const result = load('saxo', csv)
    expect(result.broker).toBe('Saxo')
    expect(only(result.transactions, 'buy')[0]).toMatchObject({ quantity: 4, amountEur: -400, costsEur: 3, ticker: 'EXMP' })
    expect(only(result.transactions, 'sell')[0]).toMatchObject({ quantity: 1, amountEur: 100, costsEur: 3 })
  })
})

describe('eToro', () => {
  const csv = [
    'Date,Type,Details,Amount,Units,Realized Equity Change,Realized Equity,Balance,Position ID,Asset type,NWA',
    '02/01/2025 09:00:00,Deposit,,1250.00,-,0.00,"1,250.00","1,250.00",-,,0.00',
    '03/01/2025 15:00:00,Open Position,EXMP/USD,500.00,4.000000,0.00,"750.00","750.00",111,Stocks,0.00',
    '04/02/2025 15:00:00,Position closed,EXMP/USD,625.00,-,125.00,"1,375.00","1,375.00",111,Stocks,0.00',
  ].join('\n')

  it('closes the whole position when the closing row has no units, in the USD account currency', () => {
    const result = load('etoro', csv)
    expect(result.broker).toBe('eToro')
    expect(only(result.transactions, 'buy')[0]).toMatchObject({ quantity: 4, amountEur: -400, product: 'EXMP' })
    expect(only(result.transactions, 'sell')[0]).toMatchObject({ quantity: 4, amountEur: 500 })
  })
})

describe('XTB', () => {
  const csv = [
    'Account number;0000000;;;;;;',
    'Cash Operations;;;;;;;',
    'Type;Ticker;Instrument;Time;Amount;ID;Comment;Product',
    'Deposit;;;2025-01-02 09:00:00;1000;1;Deposit;My Trades',
    'Stock purchase;EXMP.DE;Example ETF;2025-01-03 10:00:00;-50,25;2;OPEN BUY 2/3.5 @ 25.125;My Trades',
    'Stock sale;EXMP.DE;Example ETF;2025-01-04 10:00:00;26,00;3;CLOSE BUY 1 @ 26.00;My Trades',
    'Total;;;;975,75;;;',
  ].join('\n')

  it('skips the preamble and reads the quantity from the comment', () => {
    const result = load('xtb', csv)
    expect(result.broker).toBe('XTB')
    expect(errors(result)).toEqual([])
    expect(only(result.transactions, 'buy')[0]).toMatchObject({ quantity: 2, amountEur: -50.25, ticker: 'EXMP.DE' })
    expect(only(result.transactions, 'sell')[0]).toMatchObject({ quantity: 1, amountEur: 26 })
  })

  it('takes the account currency from the file name and skips transfers between sub-accounts', () => {
    const lines = csv.split('\n')
    const withTransfer = [
      ...lines.slice(0, 4),
      'Transfer;;;2025-01-06 08:40:00;5;5;Transfer between accounts;Investment Plans',
      'Transfer;;;2025-01-06 08:40:00;-5;6;Transfer between accounts;My Trades',
    ].join('\n')
    const result = importTables(readCsv('USD_12345_2025.csv', withTransfer), { context: RATES })
    expect(only(result.transactions, 'deposit')).toEqual([expect.objectContaining({ amountEur: 800, currency: 'USD' })])
    expect(only(result.transactions, 'withdrawal')).toEqual([])
  })

  it('maps XTB symbols to Yahoo tickers', () => {
    expect(yahooTicker('AAPL.US')).toBe('AAPL')
    expect(yahooTicker('ASML.NL')).toBe('ASML.AS')
    expect(yahooTicker('KBC.BE')).toBe('KBC.BR')
    expect(yahooTicker('VOD.UK')).toBe('VOD.L')
    expect(yahooTicker('GOLD')).toBeUndefined()
  })
})

describe('Bolero and Keytrade', () => {
  it('reads the Bolero net amounts and product names', () => {
    const result = load(
      'bolero',
      [
        'Datum transactie;Valutadatum;Omschrijving;Aantal;Prijs;Bedrag;Munt;Type rekening',
        '03/01/2025;07/01/2025;Aankoop 4 EXAMPLE CORP;4;100,00;-403,50;EUR;EUR-rekening',
        '01/03/2025;01/03/2025;Uitbetaling dividenden 4 EXAMPLE CORP;4;1,00;2,80;EUR;EUR-rekening',
      ].join('\n'),
    )
    expect(result.broker).toBe('Bolero')
    expect(only(result.transactions, 'buy')[0]).toMatchObject({ product: 'EXAMPLE CORP', quantity: 4, amountEur: -403.5 })
    expect(only(result.transactions, 'dividend')[0]).toMatchObject({ product: 'EXAMPLE CORP', amountEur: 2.8 })
  })

  it('splits the Keytrade net amount into gross, broker fee and stock exchange tax', () => {
    const result = load(
      'keytrade',
      [
        'Datum;Valutadatum;Type;Omschrijving;ISIN;Aantal;Koers;Munt;Brutobedrag;Makelaarsloon;Beurstaks;Roerende voorheffing;Nettobedrag EUR;Ref. Nummer',
        '03/01/2025;07/01/2025;Aankoop;EXAMPLE CORP;US0000000001;4;125,00;USD;500,00;2,00;1,40;;-403,40;1',
        '01/03/2025;01/03/2025;Dividend;EXAMPLE CORP;US0000000001;4;0,50;USD;2,00;;;0,60;1,00;2',
      ].join('\n'),
    )
    expect(result.broker).toBe('Keytrade Bank')
    expect(only(result.transactions, 'buy')[0]).toMatchObject({ amountEur: -400, costsEur: 2, taxesEur: 1.4, totalEur: -403.4 })
    expect(only(result.transactions, 'dividend')[0]).toMatchObject({ amountEur: 1.6, taxesEur: 0.6 })
  })
})

describe('crypto exchanges', () => {
  it('Bitvavo: fees, staking rewards as free coins, and coins sent away', () => {
    const result = load(
      'bitvavo',
      [
        'Timezone,Date,Time,Type,Currency,Amount,Quote Currency,Quote Price,Received / Paid Currency,Received / Paid Amount,Fee currency,Fee amount,Status,Transaction ID,Address',
        'Europe/Amsterdam,2025-01-03,10:00:00.000,buy,ETH,0.5,EUR,2000,EUR,-1000.00,EUR,2.50,Completed,b1,',
        'Europe/Amsterdam,2025-02-01,02:00:00.000,staking,ETH,0.001,,,,,,,Completed,b2,',
        'Europe/Amsterdam,2025-03-01,12:00:00.000,withdrawal,ETH,-0.1,,,,,ETH,0.001,Completed,b3,0xabc',
      ].join('\n'),
    )
    expect(result.broker).toBe('Bitvavo')
    const [buy, reward] = only(result.transactions, 'buy')
    expect(buy).toMatchObject({ product: 'ETH', ticker: 'ETH', assetClass: 'crypto', quantity: 0.5, amountEur: -1000, costsEur: 2.5 })
    expect(reward).toMatchObject({ quantity: 0.001, amountEur: 0 })
    expect(only(result.transactions, 'transferOut')[0]?.quantity).toBeCloseTo(0.101)
  })

  it('Coinbase: preamble, € signs and a convert into another coin', () => {
    const result = load(
      'coinbase',
      [
        'Transactions',
        'User,Example User,00000000-0000-0000-0000-000000000000',
        'ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes',
        'c1,2025-01-03 10:00:00 UTC,Buy,BTC,0.01,EUR,€50000.00,€500.00,€505.00,€5.00,Bought 0.01 BTC',
        'c2,2025-02-03 10:00:00 UTC,Convert,BTC,0.004,EUR,€50000.00,€200.00,€201.00,€1.00,Converted 0.004 BTC to 100 XRP',
      ].join('\n'),
    )
    expect(result.broker).toBe('Coinbase')
    expect(only(result.transactions, 'buy').map((t) => [t.product, t.quantity, t.amountEur])).toEqual([
      ['BTC', 0.01, -500],
      ['XRP', 100, -200],
    ])
    expect(only(result.transactions, 'sell')[0]).toMatchObject({ product: 'BTC', quantity: 0.004, amountEur: 200, costsEur: 1 })
  })

  it('Binance: groups the legs of a trade and books coin-to-coin conversions at cost', () => {
    const result = load(
      'binance',
      [
        'User_ID,UTC_Time,Account,Operation,Coin,Change,Remark',
        '1,2025-01-03 10:00:00,Spot,Transaction Spend,EUR,-1000.00000000,',
        '1,2025-01-03 10:00:00,Spot,Transaction Buy,ETH,0.50000000,',
        '1,2025-01-03 10:00:00,Spot,Transaction Fee,ETH,-0.00050000,',
        '1,2025-02-03 10:00:00,Spot,Binance Convert,ETH,-0.10000000,',
        '1,2025-02-03 10:00:00,Spot,Binance Convert,SOL,2.00000000,',
      ].join('\n'),
    )
    expect(result.broker).toBe('Binance')
    expect(only(result.transactions, 'buy')[0]).toMatchObject({ product: 'ETH', quantity: 0.4995, amountEur: -1000 })
    expect(only(result.transactions, 'split')[0]).toMatchObject({ product: 'SOL', quantity: 2, split: { fromIsin: 'ETH', fromQuantity: 0.1, ratio: 20 } })
  })

  it('Kraken: pairs trade rows by refid and normalizes asset codes', () => {
    const result = load(
      'kraken',
      [
        '"txid","refid","time","type","subtype","aclass","asset","wallet","amount","fee","balance"',
        '"L1","T1","2025-01-03 10:00:00","trade","tradespot","currency","ZEUR","spot / main","-500.00","1.30","0"',
        '"L2","T1","2025-01-03 10:00:00","trade","tradespot","currency","XXBT","spot / main","0.01","0","0.01"',
      ].join('\n'),
    )
    expect(result.broker).toBe('Kraken')
    expect(only(result.transactions, 'buy')[0]).toMatchObject({ product: 'BTC', quantity: 0.01, amountEur: -500, costsEur: 1.3 })
    expect(krakenAsset('ETH.S')).toBe('ETH')
    expect(krakenAsset('XETH')).toBe('ETH')
  })

  it('Bitpanda: preamble and buys with a fee in euro', () => {
    const result = load(
      'bitpanda',
      [
        '"Disclaimer: All data is without guarantee."',
        '"Account User ID: 00000000-0000-0000-0000-000000000000"',
        'Transaction ID,Timestamp,Transaction Type,In/Out,Amount Fiat,Fiat,Amount Asset,Asset,Asset market price,Asset market price currency,Asset class,Product ID,Fee,Fee asset,Spread,Spread Currency,Tax Fiat',
        'T1,2025-01-03T10:00:00+01:00,buy,outgoing,500.00,EUR,0.01000000,BTC,50000.00,EUR,Cryptocurrency,1,1.50,EUR,-,-,0.00',
      ].join('\n'),
    )
    expect(result.broker).toBe('Bitpanda')
    expect(only(result.transactions, 'buy')[0]).toMatchObject({ product: 'BTC', quantity: 0.01, amountEur: -500, costsEur: 1.5 })
  })
})
