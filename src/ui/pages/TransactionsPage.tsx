import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { db } from '../../data/db.ts'
import { DownloadCsvButton } from '../components/DownloadCsvButton.tsx'
import { transactionRows } from '../csvTables.ts'
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
import { formatDate, formatEur, formatQuantity } from '../format.ts'
import { t } from '../../i18n/i18n.ts'
import { Rich } from '../../i18n/Rich.tsx'
import { useAccountSync } from '../components/AccountSync.tsx'

const PAGE = 50

const TYPE_LABELS: Record<string, string> = {
  buy: t('Buy'),
  sell: t('Sell'),
  dividend: t('Dividend'),
  deposit: t('Deposit'),
  withdrawal: t('Withdrawal'),
  fee: t('Fee'),
  tax: t('Tax'),
  fx: t('Currency exchange'),
  split: t('Split'),
  transferIn: t('Transfer in'),
  transferOut: t('Transfer out'),
  other: t('Other'),
}

const ASSET_CLASSES: [AssetClass, string][] = [
  ['etf', 'ETF'],
  ['stock', t('Stock')],
  ['fund', t('Fund')],
  ['bond', t('Bond')],
  ['crypto', t('Crypto')],
  ['unknown', t('Other')],
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
  // The transaction whose delete button was pressed once: a second press deletes it.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const account = useAccountSync()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!transactions || !q) return transactions ?? []
    return transactions.filter((t) =>
      [t.product, t.isin, t.ticker, TYPE_LABELS[t.type], t.source.broker, t.date].some((v) => v?.toLowerCase().includes(q)),
    )
  }, [transactions, query])

  if (!transactions) return <p role="status">{t('Loading…')}</p>

  return (
    <section className="stack">
      <h2>{t('Transactions')}</h2>
      <p className="muted">
        {t('Add a transaction by hand, for a broker without an export or a row that is missing, or correct an imported one.')}
      </p>
      {account.notice}

      {editing ? (
        <TransactionForm key={editing.base?.id ?? 'new'} editing={editing} onSaved={account.sync} onDone={() => setEditing(null)} />
      ) : (
        <div className="actions">
          <button type="button" className="primary" onClick={() => setEditing({ input: emptyInput() })}>
            {t('Add transaction')}
          </button>
          {transactions.length === 0 && (
            <span className="muted">
              <Rich text={t('or <link>import a broker export</link>')} tags={{ link: (s) => <Link to="/import">{s}</Link> }} />
            </span>
          )}
        </div>
      )}

      {transactions.length > 0 && (
        <>
          <div className="csv-row">
            <input
              type="search"
              className="transactions-search"
              aria-label={t('Search transactions')}
              placeholder={t('Search product, ISIN, type or broker')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {filtered.length > 0 && (
              <DownloadCsvButton
                rows={() => transactionRows(filtered)}
                name={query.trim() ? `transactions-${localToday()}-search` : `transactions-${localToday()}`}
                what={query.trim() ? t('the transactions found') : t('every transaction')}
              />
            )}
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Date')}</th>
                  <th>{t('Type')}</th>
                  <th>{t('Product')}</th>
                  <th className="num">{t('Quantity')}</th>
                  <th className="num">{t('Net (EUR)')}</th>
                  <th>{t('Source')}</th>
                  <th aria-label={t('Actions')} />
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, shown).map((tx) => (
                  <tr key={tx.id}>
                    <td>{formatDate(tx.date)}</td>
                    <td>{TYPE_LABELS[tx.type] ?? tx.type}</td>
                    <td>{tx.product}</td>
                    <td className="num">{tx.quantity ? formatQuantity(tx.quantity) : ''}</td>
                    <td className="num">{formatEur(tx.totalEur)}</td>
                    <td className="muted small">{tx.source.broker}</td>
                    <td className="row-actions">
                      {confirmDelete === tx.id ? (
                        <>
                          <span className="small">{t('Delete for good?')}</span>
                          <button
                            type="button"
                            className="link-button danger-text"
                            onClick={() => {
                              setConfirmDelete(null)
                              void deleteTransaction(tx.id).then(account.sync)
                            }}
                          >
                            {t('Yes, delete')}
                          </button>
                          <button type="button" className="link-button" onClick={() => setConfirmDelete(null)}>
                            {t('Cancel')}
                          </button>
                        </>
                      ) : (
                        <>
                          {isEditable(tx) && (
                            <button type="button" className="link-button" onClick={() => setEditing({ input: toInput(tx), base: tx })}>
                              {t('Edit')}
                            </button>
                          )}
                          <button
                            type="button"
                            className="link-button"
                            aria-label={t('Delete {type} {product} of {date}', { type: TYPE_LABELS[tx.type] ?? tx.type, product: tx.product, date: formatDate(tx.date) })}
                            onClick={() => setConfirmDelete(tx.id)}
                          >
                            {t('Delete')}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            {t('{shown} of {total} transactions', { shown: Math.min(shown, filtered.length), total: filtered.length })}
            {filtered.length > shown && (
              <>
                {' · '}
                <button type="button" className="link-button" onClick={() => setShown(shown + PAGE)}>
                  {t('Show more')}
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

function TransactionForm({ editing, onSaved, onDone }: { editing: Editing; onSaved: () => void; onDone: () => void }) {
  const [input, setInput] = useState(editing.input)
  const [error, setError] = useState<string>()
  const set = (changes: Partial<ManualInput>) => setInput({ ...input, ...changes })
  const trade = TRADE_TYPES.includes(input.type)
  const needsProduct = trade || input.type === 'dividend'
  const title = editing.base ? t('Edit transaction') : t('Add transaction')

  async function submit(event: FormEvent) {
    event.preventDefault()
    const problem = validate(input)
    if (problem) return setError(problem)
    try {
      const context = input.currency.trim().toUpperCase() === 'EUR' ? { toEur: (amount: number) => amount } : await loadImportContext()
      await saveTransaction(buildTransaction(input, context, editing.base))
      onSaved()
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
            {t('Type')}
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
            {t('Date')}
            <input type="date" required max={localToday()} value={input.date} onChange={(e) => set({ date: e.target.value })} />
          </label>
          {needsProduct && (
            <>
              <label>
                {t('Product')}
                <input value={input.product} placeholder={t('e.g. iShares Core MSCI World')} onChange={(e) => set({ product: e.target.value })} />
              </label>
              <label>
                ISIN
                <input value={input.isin} placeholder="IE00B4L5Y983" autoCapitalize="characters" onChange={(e) => set({ isin: e.target.value })} />
                <span className="muted small">{t('Needed to find prices, or fill in the ticker')}</span>
              </label>
              <label>
                {t('Ticker (optional)')}
                <input value={input.ticker} placeholder="IWDA.AS" onChange={(e) => set({ ticker: e.target.value })} />
              </label>
              <label>
                {t('Kind')}
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
              <NumberInput label={t('Quantity')} value={input.quantity} onChange={(quantity) => set({ quantity })} />
              <NumberInput label={t('Price per unit')} value={input.price} onChange={(price) => set({ price })} />
            </>
          ) : (
            <NumberInput
              label={t('Amount')}
              value={input.amount}
              onChange={(amount) => set({ amount })}
              hint={input.type === 'dividend' ? t('Gross, before withholding tax') : undefined}
            />
          )}
          <label>
            {t('Currency')}
            <input value={input.currency} maxLength={3} autoCapitalize="characters" onChange={(e) => set({ currency: e.target.value })} />
            <span className="muted small">{t('Converted at the ECB rate of that day')}</span>
          </label>
          {input.type !== 'fee' && input.type !== 'tax' && (
            <>
              <NumberInput label={t('Costs (EUR)')} value={input.costsEur} onChange={(costsEur) => set({ costsEur })} />
              <NumberInput
                label={t('Taxes (EUR)')}
                value={input.taxesEur}
                onChange={(taxesEur) => set({ taxesEur })}
                hint={input.type === 'dividend' ? t('Withholding tax') : trade ? t('e.g. the Belgian TOB') : undefined}
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
            {editing.base ? t('Save changes') : t('Add')}
          </button>
          <button type="button" onClick={onDone}>
            {t('Cancel')}
          </button>
        </div>
      </fieldset>
    </form>
  )
}
