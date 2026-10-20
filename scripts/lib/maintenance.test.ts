import { describe, expect, it } from 'vitest'
import {
  benchmarkReport,
  fxReport,
  maintenanceCommitMessage,
  qualityReport,
  renderChangelog,
  weekStart,
} from './maintenance.ts'
import type { BenchmarkFile, FxFile } from './snapshot.ts'

const benchmark = (closes: BenchmarkFile['closes']): BenchmarkFile => ({
  id: 'iwda',
  name: 'Test ETF',
  symbol: 'IWDA.AS',
  currency: 'EUR',
  source: 'test',
  closes,
})

describe('fxReport', () => {
  const fx: FxFile = {
    base: 'EUR',
    source: 'test',
    currencies: ['CHF', 'USD'],
    rates: {
      '2015-01-14': [1.2, 1.18],
      '2015-01-15': [0.98, 1.16],
      '2015-01-16': [null, 1.15],
      '2015-01-30': [1.04, 1.13],
    },
  }

  it('finds gaps, large moves per currency and missing values', () => {
    const report = fxReport(fx, '2015-02-02')
    expect(report).toMatchObject({ rows: 4, firstDate: '2015-01-14', lastDate: '2015-01-30', staleDays: 3, missingValues: 1 })
    expect(report.gaps).toEqual([{ from: '2015-01-16', to: '2015-01-30', days: 14 }])
    // CHF skips the missing day and compares with the last known rate.
    expect(report.jumps).toEqual([{ date: '2015-01-15', series: 'CHF', change: -0.1833 }])
  })
})

describe('benchmarkReport', () => {
  it('treats a long weekend as normal and uses adjusted closes for jumps', () => {
    const report = benchmarkReport(
      benchmark([
        ['2026-04-02', 100, 50],
        ['2026-04-07', 50, 50.5], // Easter: Thursday to Tuesday; a 2:1 split in the raw close
        ['2026-04-08', 51, 70],
      ]),
      '2026-04-08',
    )
    expect(report.gaps).toEqual([])
    expect(report.jumps).toEqual([{ date: '2026-04-08', series: 'IWDA.AS', change: 0.3861 }])
    expect(report.staleDays).toBe(0)
  })
})

describe('qualityReport', () => {
  const now = new Date('2026-10-20T06:00:00.123Z')

  it('warns about stale files, recent gaps and snapshot errors, not about old gaps', () => {
    const report = qualityReport(
      {
        'old-gap.json': { rows: 3, firstDate: '2012-01-02', lastDate: '2026-10-19', staleDays: 1, gaps: [{ from: '2012-01-02', to: '2012-02-01', days: 30 }], jumps: [], missingValues: 0 },
        'recent-gap.json': { rows: 3, firstDate: '2026-01-02', lastDate: '2026-10-19', staleDays: 1, gaps: [{ from: '2026-09-01', to: '2026-09-15', days: 14 }], jumps: [], missingValues: 0 },
        'stale.json': { rows: 1, firstDate: '2026-10-01', lastDate: '2026-10-01', staleDays: 19, gaps: [], jumps: [], missingValues: 0 },
      },
      { lastCheck: '', sources: {}, files: {}, errors: ['VWCE.DE: HTTP 429'] },
      now,
    )
    expect(report.generated).toBe('2026-10-20T06:00:00Z')
    expect(report.status).toBe('warning')
    expect(report.warnings).toEqual([
      'recent-gap.json: no data between 2026-09-01 and 2026-09-15 (14 days)',
      'stale.json: last date 2026-10-01 is 19 days old',
      'last daily snapshot: VWCE.DE: HTTP 429',
    ])
  })

  it('is ok without findings', () => {
    expect(qualityReport({}, null, now)).toMatchObject({ status: 'ok', warnings: [] })
  })
})

describe('changelog', () => {
  it('starts weeks on Monday', () => {
    expect(weekStart('2026-10-19T10:00:00Z')).toBe('2026-10-19')
    expect(weekStart('2026-10-25T23:59:00Z')).toBe('2026-10-19')
    expect(weekStart('2026-10-18')).toBe('2026-10-12')
  })

  it('groups merged pull requests per week, newest first', () => {
    const changelog = renderChangelog([
      { number: 2, title: 'M1: Setup', author: 'SausMeesterXIV', mergedAt: '2026-10-17T12:00:00Z' },
      { number: 12, title: 'M3: Daily data snapshot', author: 'Jaguarke', mergedAt: '2026-10-19T09:00:00Z' },
      { number: 11, title: 'M2: DEGIRO import', author: 'ruizverbeke-dotcom', mergedAt: '2026-10-19T08:00:00Z' },
    ])
    expect(changelog).toBe(
      [
        '# Changelog',
        '',
        'Generated every week from the merged pull requests by the weekly maintenance workflow. Do not edit by hand.',
        '',
        '## Week of 2026-10-19',
        '',
        '- M3: Daily data snapshot (#12) by @Jaguarke',
        '- M2: DEGIRO import (#11) by @ruizverbeke-dotcom',
        '',
        '## Week of 2026-10-12',
        '',
        '- M1: Setup (#2) by @SausMeesterXIV',
        '',
      ].join('\n'),
    )
  })

  it('summarizes the run in the commit message', () => {
    const report = qualityReport({}, { lastCheck: '', sources: {}, files: {}, errors: ['x'] }, new Date('2026-10-20'))
    expect(maintenanceCommitMessage('2026-10-20', report, true)).toBe(
      'chore: weekly maintenance for 2026-10-20\n\n- data quality: 1 warning\n  - last daily snapshot: x\n- changelog: updated\n',
    )
  })
})
