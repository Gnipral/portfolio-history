/** Pure helpers for the weekly maintenance: data-quality report and changelog. */
import type { BenchmarkFile, CloseRow, FxFile, MetaFile } from './snapshot.ts'

/** Longer than Easter (Thursday to Tuesday) or Christmas (23 to 29 December), so normal market holidays are no gap. */
export const MAX_GAP_DAYS = 6
/** A last date older than this (calendar days) means the daily snapshot stopped updating the file. */
export const MAX_STALE_DAYS = 5
/** Gaps this recent count as a warning; older ones are history and only listed. */
export const RECENT_DAYS = 90
/** Day-to-day moves above this are listed for a manual check (unadjusted splits, bad ticks). */
export const JUMP_THRESHOLD = 0.15

export interface Gap {
  from: string
  to: string
  days: number
}

export interface Jump {
  date: string
  /** Series name: the currency for FX, the symbol for benchmarks. */
  series: string
  change: number
}

export interface FileReport {
  rows: number
  firstDate: string | null
  lastDate: string | null
  staleDays: number | null
  gaps: Gap[]
  jumps: Jump[]
  /** Dates without a value (FX: per currency); only FX rows can have nulls. */
  missingValues: number
}

export interface QualityReport {
  generated: string
  status: 'ok' | 'warning'
  warnings: string[]
  files: Record<string, FileReport>
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

function round(value: number): number {
  return Number(value.toFixed(4))
}

function findGaps(dates: string[]): Gap[] {
  const gaps: Gap[] = []
  for (let i = 1; i < dates.length; i++) {
    const days = daysBetween(dates[i - 1]!, dates[i]!)
    if (days > MAX_GAP_DAYS) gaps.push({ from: dates[i - 1]!, to: dates[i]!, days })
  }
  return gaps
}

function findJumps(series: string, points: [string, number | null][]): Jump[] {
  const jumps: Jump[] = []
  let previous: number | null = null
  for (const [date, value] of points) {
    if (value === null) continue
    if (previous !== null && previous > 0) {
      const change = value / previous - 1
      if (Math.abs(change) > JUMP_THRESHOLD) jumps.push({ date, series, change: round(change) })
    }
    previous = value
  }
  return jumps
}

function baseReport(dates: string[], today: string): Omit<FileReport, 'jumps' | 'missingValues'> {
  const lastDate = dates.at(-1) ?? null
  return {
    rows: dates.length,
    firstDate: dates[0] ?? null,
    lastDate,
    staleDays: lastDate ? daysBetween(lastDate, today) : null,
    gaps: findGaps(dates),
  }
}

export function fxReport(file: FxFile, today: string): FileReport {
  const dates = Object.keys(file.rates).sort()
  const rows = dates.map((d) => file.rates[d] ?? [])
  return {
    ...baseReport(dates, today),
    jumps: file.currencies
      .flatMap((currency, i) => findJumps(currency, dates.map((d, j) => [d, rows[j]?.[i] ?? null])))
      .sort((a, b) => a.date.localeCompare(b.date)),
    missingValues: rows.reduce((n, row) => n + row.filter((v) => v === null).length, 0),
  }
}

export function benchmarkReport(file: BenchmarkFile, today: string): FileReport {
  const closes: CloseRow[] = file.closes
  return {
    ...baseReport(
      closes.map(([d]) => d),
      today,
    ),
    // Adjusted closes, so dividends and splits do not show up as jumps.
    jumps: findJumps(
      file.symbol,
      closes.map(([d, , adjusted]) => [d, adjusted]),
    ),
    missingValues: 0,
  }
}

/** Collects the per-file reports and turns the actionable findings into warnings. */
export function qualityReport(
  files: Record<string, FileReport>,
  meta: MetaFile | null,
  now: Date,
): QualityReport {
  const today = now.toISOString().slice(0, 10)
  const warnings: string[] = []
  for (const [name, report] of Object.entries(files)) {
    if (report.staleDays === null) warnings.push(`${name}: no data`)
    else if (report.staleDays > MAX_STALE_DAYS) warnings.push(`${name}: last date ${report.lastDate} is ${report.staleDays} days old`)
    for (const gap of report.gaps) {
      if (daysBetween(gap.to, today) <= RECENT_DAYS) warnings.push(`${name}: no data between ${gap.from} and ${gap.to} (${gap.days} days)`)
    }
  }
  for (const error of meta?.errors ?? []) warnings.push(`last daily snapshot: ${error}`)
  return {
    generated: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    status: warnings.length > 0 ? 'warning' : 'ok',
    warnings,
    files,
  }
}

export interface MergedPullRequest {
  number: number
  title: string
  author: string
  /** ISO timestamp. */
  mergedAt: string
}

/** Monday of the ISO week of a date (UTC). */
export function weekStart(isoDate: string): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.toISOString().slice(0, 10)
}

/** CHANGELOG.md with the merged pull requests per week, newest first. */
export function renderChangelog(pulls: MergedPullRequest[]): string {
  const weeks = new Map<string, MergedPullRequest[]>()
  for (const pr of [...pulls].sort((a, b) => b.mergedAt.localeCompare(a.mergedAt) || b.number - a.number)) {
    const week = weekStart(pr.mergedAt)
    weeks.set(week, [...(weeks.get(week) ?? []), pr])
  }
  const sections = [...weeks].map(
    ([week, prs]) => `## Week of ${week}\n\n${prs.map((pr) => `- ${pr.title} (#${pr.number}) by @${pr.author}`).join('\n')}\n`,
  )
  return [
    '# Changelog',
    '',
    'Generated every week from the merged pull requests by the weekly maintenance workflow. Do not edit by hand.',
    '',
    ...sections,
  ].join('\n')
}

export function maintenanceCommitMessage(date: string, report: QualityReport, changelogChanged: boolean): string {
  const lines = [
    `- data quality: ${report.status === 'ok' ? 'no warnings' : `${report.warnings.length} ${report.warnings.length === 1 ? 'warning' : 'warnings'}`}`,
    ...report.warnings.map((w) => `  - ${w}`),
    `- changelog: ${changelogChanged ? 'updated' : 'no new pull requests'}`,
  ]
  return `chore: weekly maintenance for ${date}\n\n${lines.join('\n')}\n`
}
