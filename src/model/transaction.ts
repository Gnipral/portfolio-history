export type TransactionType =
  | 'buy'
  | 'sell'
  | 'dividend'
  | 'deposit'
  | 'withdrawal'
  | 'fee'
  | 'tax'
  | 'fx'
  | 'split'
  | 'other'

export type AssetClass = 'stock' | 'etf' | 'fund' | 'bond' | 'crypto' | 'cash' | 'unknown'

/** Quantity change caused by a split, reverse split or ISIN change. */
export interface SplitInfo {
  /** New shares per old share, e.g. 4 for a 4:1 split, 0.025 for a 1:40 reverse split. */
  ratio: number
  /** Quantity held before the corporate action. */
  fromQuantity: number
  /** Set when the corporate action also changed the ISIN. */
  fromIsin?: string
}

/**
 * Broker-independent transaction. Amounts are signed from the portfolio's cash point of view:
 * money leaving the account is negative, money coming in is positive.
 */
export interface Transaction {
  id: string
  /** Local date and time as `YYYY-MM-DDTHH:mm`. */
  dateTime: string
  /** Local date as `YYYY-MM-DD`. */
  date: string
  type: TransactionType
  product: string
  isin?: string
  ticker?: string
  /** Reference exchange as reported by the broker (e.g. DEGIRO `NDQ`, `EAM`). */
  exchange?: string
  /** Execution venue MIC (e.g. `XNAS`). */
  venue?: string
  assetClass: AssetClass
  /** Always positive; direction follows from `type`. For splits: quantity after the split. */
  quantity: number
  /** Price per unit in `currency`. */
  price: number
  /** Currency of `price` and `localAmount`, as reported (can be `GBX`, pence). */
  currency: string
  /** Units of `currency` per 1 EUR, when the file contains it. */
  fxRate?: number
  /** Gross amount in `currency`, signed. */
  localAmount: number
  /** Gross amount in EUR, signed, without costs. */
  amountEur: number
  /** Broker transaction costs in EUR, positive. */
  costsEur: number
  /** Taxes such as the Belgian TOB in EUR, positive. */
  taxesEur: number
  /** Currency conversion costs (e.g. DEGIRO AutoFX) in EUR, positive. */
  fxCostsEur: number
  /** Net cash effect in EUR, signed: amountEur - costsEur - taxesEur - fxCostsEur. */
  totalEur: number
  orderId?: string
  split?: SplitInfo
  source: { broker: string; file: string; row: number }
}
