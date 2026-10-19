import type { Cell, RawTable } from '../../types.ts'

/** Header row of a Dutch DEGIRO Transactions export, including the two unnamed currency columns. */
export const DUTCH_HEADER: Cell[] = [
  'Datum',
  'Tijd',
  'Product',
  'ISIN',
  'Beurs',
  'Uitvoeringsplaats',
  'Aantal',
  'Koers ',
  null,
  'Lokale waarde',
  null,
  'Waarde EUR',
  'Wisselkoers',
  'AutoFX Kosten',
  'Transactiekosten en/of kosten van derden EUR',
  'Totaal EUR',
  'Order ID',
]

export const ENGLISH_HEADER: Cell[] = [
  'Date',
  'Time',
  'Product',
  'ISIN',
  'Reference exchange',
  'Venue',
  'Quantity',
  'Price',
  null,
  'Local value',
  null,
  'Value EUR',
  'Exchange rate',
  'AutoFX Fee',
  'Transaction and/or third party fees EUR',
  'Total EUR',
  'Order ID',
]

/** Synthetic rows (fictional amounts) in DEGIRO's newest-first order. */
export const SAMPLE_ROWS: Cell[][] = [
  // 4:1 split, booked as a sell/buy pair without order ID
  ['02-07-2026', '00:00', 'EXAMPLE SOFTWARE INC', 'US0000000001', 'TDG', null, 8, 50, 'EUR', -400, 'EUR', -400, 0, 0, null, -400, null],
  ['02-07-2026', '00:00', 'EXAMPLE SOFTWARE INC', 'US0000000001', 'TDG', null, -2, 200, 'EUR', 400, 'EUR', 400, 0, 0, null, 400, null],
  // USD sell with AutoFX
  ['10-03-2026', '15:40', 'EXAMPLE INDUSTRIES CORP', 'US0000000002', 'NSY', 'XNYS', -4, 150, 'USD', 600, 'USD', 500, 1.2, -1.25, -2, 496.75, 'order-3'],
  // GBX buy (price in pence, rate in pence per EUR)
  ['13-02-2026', '09:11', 'EXAMPLE UK PLC', 'GB0000000003', 'LSE', 'XLON', 2, 1000, 'GBX', -2000, 'GBX', -23.25, 86, -0.06, -4.9, -28.21, 'order-2'],
  // 1:40 reverse split with ISIN change
  ['16-01-2026', '00:00', 'EXAMPLE BIOTECH NEW', 'US0000000005', 'NDQ', null, 5, 8, 'USD', -40, 'USD', -33.33, 1.2, 0, null, -33.33, null],
  ['16-01-2026', '00:00', 'EXAMPLE BIOTECH', 'US0000000004', 'NDQ', null, -200, 0.2, 'USD', 40, 'USD', 33.33, 1.2, 0, null, 33.33, null],
  // USD buy with AutoFX
  ['05-01-2026', '16:44', 'EXAMPLE INDUSTRIES CORP', 'US0000000002', 'NSY', 'XNYS', 10, 120, 'USD', -1200, 'USD', -1000, 1.2, -2.5, -2, -1004.5, 'order-1'],
  ['04-01-2026', '10:00', 'EXAMPLE BIOTECH', 'US0000000004', 'NDQ', 'XNAS', 200, 0.25, 'USD', -50, 'USD', -41.67, 1.2, -0.1, -2, -43.77, 'order-0'],
  // EUR buy, ETF
  ['03-01-2026', '09:00', 'EXAMPLE WORLD UCITS ETF', 'IE0000000006', 'EAM', 'XAMS', 3, 100, 'EUR', -300, 'EUR', -300, 0, 0, -1, -301, 'order-e'],
  ['02-01-2026', '15:30', 'EXAMPLE SOFTWARE INC', 'US0000000001', 'TDG', 'XGAT', 2, 180, 'EUR', -360, 'EUR', -360, 0, 0, -3.9, -363.9, 'order-s'],
]

export function table(rows: Cell[][], header: Cell[] = DUTCH_HEADER, fileName = 'Transactions.csv'): RawTable {
  return { fileName, rows: [header, ...rows] }
}
