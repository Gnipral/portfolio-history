import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ConnectionNotice } from './ConnectionNotice.tsx'

describe('ConnectionNotice', () => {
  afterEach(cleanup)

  it('says nothing on a good connection', () => {
    const { container } = render(<ConnectionNotice offline={false} weak={false} pricesFrom="2026-10-26" />)
    expect(container.textContent).toBe('')
  })

  it('names a weak connection, the date of the last prices and that new ones follow', () => {
    render(<ConnectionNotice offline={false} weak pricesFrom="2026-10-26" />)
    const notice = screen.getByRole('status')
    expect(notice.textContent).toContain('Weak internet connection')
    expect(notice.textContent).toContain('the last prices found, from 26 Oct 2026')
    expect(notice.textContent).toContain('New prices are fetched as soon as the connection is stable.')
  })

  it('names no connection at all', () => {
    render(<ConnectionNotice offline weak={false} pricesFrom={undefined} />)
    expect(screen.getByRole('status').textContent).toMatch(/No internet connection.*the last prices found\./)
  })
})
