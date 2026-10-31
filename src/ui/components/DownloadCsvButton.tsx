import { type CsvValue, downloadCsv } from '../../data/csv.ts'
import { t } from '../../i18n/i18n.ts'

interface Props {
  /** Built only on a click: the rows of a long table are not made on every render. */
  rows: () => CsvValue[][]
  /** File name without extension, e.g. `positions-2026-03-10`. */
  name: string
  /** What is downloaded, for screen readers and the tooltip, e.g. "the positions". */
  what: string
}

/** A small button next to a table heading that saves the table as CSV for Excel. */
export function DownloadCsvButton({ rows, name, what }: Props) {
  const label = t('Download {what} as CSV', { what })
  return (
    <button type="button" className="csv-button" title={label} aria-label={label} onClick={() => downloadCsv(rows(), `${name}.csv`)}>
      <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
      </svg>
      CSV
    </button>
  )
}
