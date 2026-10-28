import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { reportUrl, safeRoute } from './report.ts'

afterEach(cleanup)

let broken = true
function Fragile() {
  if (broken) throw new Error('Chart exploded')
  return <p>Chart</p>
}

describe('ErrorBoundary', () => {
  it('shows what failed, lets you retry and links to a report', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    broken = true
    render(
      <ErrorBoundary label="The chart">
        <Fragile />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert').textContent).toContain('The chart could not be shown.')
    expect(screen.getByText('Chart exploded')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Report this problem' }).getAttribute('href')).toMatch(/^https:\/\/github\.com\/Gnipral\/portfolio-history\/issues\/new\?/)

    broken = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByText('Chart')).toBeTruthy()
  })

  it('clears the error when the reset key changes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    broken = true
    const { rerender } = render(
      <ErrorBoundary resetKey="/a">
        <Fragile />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    broken = false
    rerender(
      <ErrorBoundary resetKey="/b">
        <Fragile />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Chart')).toBeTruthy()
  })
})

describe('reportUrl', () => {
  it('fills in the error, the page and the browser', () => {
    const url = new URL(reportUrl(new TypeError('x is undefined'), '/analysis', 'TestBrowser'))
    expect(url.searchParams.get('title')).toBe('Error: x is undefined')
    expect(url.searchParams.get('labels')).toBe('bug')
    const body = url.searchParams.get('body')!
    expect(body).toContain('TypeError: x is undefined')
    expect(body).toContain('Page: `/analysis`')
    expect(body).toContain('Browser: TestBrowser')
  })

  it('leaves out the figures in a shared card link', () => {
    expect(safeRoute('/s/eJyrVkrLz1eyUkpKLFKqBQApbgVN')).toBe('/s/…')
    expect(safeRoute('/c/abc.def')).toBe('/c/…')
    expect(safeRoute('/settings')).toBe('/settings')
    expect(reportUrl('boom', '/s/secret', 'B')).not.toContain('secret')
  })
})
