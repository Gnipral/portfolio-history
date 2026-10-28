import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { db } from '../../data/db.ts'
import {
  buildTransaction,
  deleteTransaction,
  EDITABLE_TYPES,
  isEditable,
  saveTransaction,
  toInput,
  TRADE_TYPES,
  validate,
  type ManualInput,
} from '../../data/manual.ts'
import { loadImportContext } from '../../import/fxContext.ts'
import { localToday } from '../../market/dates.ts'
import type { AssetClass, Transaction } from '../../model/transaction.ts'
import { formatDate, formatEur } from '../format.ts'

const PAGE = 50

const TYPE_LABELS: Record<string, string> = {
  buy: 'Buy',
  sell: 'Sell',
  dividend: 'Dividend',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  fee: 'Fee',
  tax: 'Tax',
  fx: 'Currency exchange',
  split: 'Split',
  transferIn: 'Transfer in',
  transferOut: 'Transfer out',
  other: 'Other',
}

const ASSET_CLASSES: [AssetClass, string][] = [
  ['etf', 'ETF'],
  ['stock', 'Stock'],
  ['fund', 'Fund'],
  ['bond', 'Bond'],
  ['crypto', 'Crypto'],
  ['unknown', 'Other'],
]

function emptyInput(): ManualInput {
  return { date: localToday(), type: 'buy', product: '', isin: '', ticker: '', assetClass: 'etf', quantity: 0, price: 0, amount: 0, currency: 'EUR', costsEur: 0, taxesEur: 0 }
}

type Editing = { input: ManualInput; base?: Transaction }

/** All stored transactions, with a form to add one by hand or correct one. */
export function TransactionsPage() {
  const transactions = useLiveQuery(() => db.transactions.orderBy('date').reverse().toArray())
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [editing, setEditing] = useState<Editing | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!transactions || !q) return transactions ?? []
    return transactions.filter((t) =>
      [t.product, t.isin, t.ticker, TYPE_LABELS[t.type], t.source.broker, t.date].some((v) => v?.toLowerCase().includes(q)),
    )
  }, [transactions, query])

  if (!transactions) return <p role="status">Loading…</p>

  return (
    <section className="stack">
      <h2>Transactions</h2>
      <p className="muted">
        Add a transaction by hand, for a broker without an export or a row that is missing, or correct an imported one.
      </p>

      {editing ? (
        <TransactionForm key={editing.base?.id ?? 'new'} editing={editing} onDone={() => setEditing(null)} />
      ) : (
        <div className="actions">
          <button type="button" className="primary" onClick={() => setEditing({ input: emptyInput() })}>
            Add transaction
          </button>
          {transactions.length === 0 && (
            <span className="muted">
              or <Link to="/import">import a broker export</Link>
            </span>
          )}
        </div>
      )}

      {transactions.length > 0 && (
        <>
          <input
            type="search"
            className="transactions-search"
            aria-label="Search transactions"
            placeholder="Search product, ISIN, type or broker"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Product</th>
                  <th className="num">Quantity</th>
                  <th className="num">Net (EUR)</th>
                  <th>Source</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, shown).map((t) => (
                  <tr key={t.id}>
                    <td>{formatDate(t.date)}</td>
                    <td>{TYPE_LABELS[t.type] ?? t.type}</td>
                    <td>{t.product}</td>
                    <td className="num">{t.quantity ? t.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 }) : ''}</td>
                    <td className="num">{formatEur(t.totalEur)}</td>
                    <td className="muted small">{t.source.broker}</td>
                    <td className="row-actions">
                      {isEditable(t) && (
                        <button type="button" className="link-button" onClick={() => setEditing({ input: toInput(t), base: t })}>
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        className="link-button"
                        aria-label={`Delete ${TYPE_LABELS[t.type] ?? t.type} ${t.product} of ${formatDate(t.date)}`}
                        onClick={() => void deleteTransaction(t.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            {Math.min(shown, filtered.length)} of {filtered.length} transactions
            {filtered.length > shown && (
              <>
                {' · '}
                <button type="button" className="link-button" onClick={() => setShown(shown + PAGE)}>
                  Show more
                </button>
              </>
            )}
          </p>
        </>
      )}
    </section>
  )
}

function NumberInput({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string | undefined }) {
  return (
    <label>
      {label}
      <input type="number" min={0} step="any" inputMode="decimal" value={value || ''} onChange={(e) => onChange(Number(e.target.value) || 0)} />
      {hint && <span className="muted small">{hint}</span>}
    </label>
  )
}

function TransactionForm({ editing, onDone }: { editing: Editing; onDone: () => void }) {
  const [input, setInput] = useState(editing.input)
  const [error, setError] = useState<string>()
  const set = (changes: Partial<ManualInput>) => setInput({ ...input, ...changes })
  const trade = TRADE_TYPES.includes(input.type)
  const needsProduct = trade || input.type === 'dividend'
  const title = editing.base ? 'Edit transaction' : 'Add transaction'

  async function submit(event: FormEvent) {
    event.preventDefault()
    const problem = validate(input)
    if (problem) return setError(problem)
    try {
      const context = input.currency.trim().toUpperCase() === 'EUR' ? { toEur: (amount: number) => amount } : await loadImportContext()
      await saveTransaction(buildTransaction(input, context, editing.base))
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <form className="stack settings-form" onSubmit={(e) => void submit(e)} aria-label={title}>
      <fieldset>
        <legend>{title}</legend>
        <div className="form-grid">
          <label>
            Type
            <select
              value={input.type}
              onChange={(e) => {
                const type = e.target.value as ManualInput['type']
                set(type === 'fee' || type === 'tax' ? { type, costsEur: 0, taxesEur: 0 } : { type })
              }}
            >
              {EDITABLE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input type="date" required max={localToday()} value={input.date} onChange={(e) => set({ date: e.target.value })} />
          </label>
          {needsProduct && (
            <>
              <label>
                Product
                <input value={input.product} placeholder="e.g. iShares Core MSCI World" onChange={(e) => set({ product: e.target.value })} />
              </label>
              <label>
                ISIN
                <input value={input.isin} placeholder="IE00B4L5Y983" autoCapitalize="characters" onChange={(e) => set({ isin: e.target.value })} />
                <span className="muted small">Needed to find prices, or fill in the ticker</span>
              </label>
              <label>
                Ticker (optional)
                <input value={input.ticker} placeholder="IWDA.AS" onChange={(e) => set({ ticker: e.target.value })} />
              </label>
              <label>
                Kind
                <select value={input.assetClass} onChange={(e) => set({ assetClass: e.target.value as AssetClass })}>
                  {ASSET_CLASSES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {trade ? (
            <>
              <NumberInput label="Quantity" value={input.quantity} onChange={(quantity) => set({ quantity })} />
              <NumberInput label="Price per unit" value={input.price} onChange={(price) => set({ price })} />
            </>
          ) : (
            <NumberInput
              label="Amount"
              value={input.amount}
              onChange={(amount) => set({ amount })}
              hint={input.type === 'dividend' ? 'Gross, before withholding tax' : undefined}
            />
          )}
          <label>
            Currency
            <input value={input.currency} maxLength={3} autoCapitalize="characters" onChange={(e) => set({ currency: e.target.value })} />
            <span className="muted small">Converted at the ECB rate of that day</span>
          </label>
          {input.type !== 'fee' && input.type !== 'tax' && (
            <>
              <NumberInput label="Costs (EUR)" value={input.costsEur} onChange={(costsEur) => set({ costsEur })} />
              <NumberInput
                label="Taxes (EUR)"
                value={input.taxesEur}
                onChange={(taxesEur) => set({ taxesEur })}
                hint={input.type === 'dividend' ? 'Withholding tax' : trade ? 'e.g. the Belgian TOB' : undefined}
              />
            </>
          )}
        </div>
        {error && (
          <p className="callout error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="submit" className="primary">
            {editing.base ? 'Save changes' : 'Add'}
          </button>
          <button type="button" onClick={onDone}>
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  )
}
