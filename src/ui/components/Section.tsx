import type { ReactNode } from 'react'

interface Props {
  /** Position on the page, shown as `01`, `02`, … */
  number: number
  title: string
  /** A short note or control at the right of the heading. */
  aside?: ReactNode
  children: ReactNode
  className?: string
  id?: string
}

/** A numbered section of a page: "01  Title", a rule, and its content. */
export function Section({ number, title, aside, children, className, id }: Props) {
  const headingId = id ? `${id}-title` : undefined
  return (
    <section className={`section${className ? ` ${className}` : ''}`} id={id} aria-labelledby={headingId}>
      <div className="section-head">
        <span className="section-number" aria-hidden="true">
          {String(number).padStart(2, '0')}
        </span>
        <h3 className="section-title" id={headingId}>
          {title}
        </h3>
        {aside && <div className="section-aside">{aside}</div>}
      </div>
      {children}
    </section>
  )
}

interface FigureProps {
  label: string
  value: ReactNode
  note?: ReactNode
  /** The benchmark's figure: in the benchmark colour. */
  benchmark?: boolean
}

/** One cell of a row of key figures. */
export function Figure({ label, value, note, benchmark }: FigureProps) {
  return (
    <div className={`figure-cell${benchmark ? ' is-benchmark' : ''}`}>
      <span className="label-caps">{label}</span>
      <span className="figure">{value}</span>
      {note && <span className="figure-note">{note}</span>}
    </div>
  )
}
