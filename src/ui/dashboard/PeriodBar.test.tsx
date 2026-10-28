import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PeriodBar } from './PeriodBar.tsx'

const periods = [{ id: 'p1', name: 'After the crash', from: '2026-03-01', to: '2026-06-30' }]

describe('PeriodBar', () => {
  afterEach(cleanup)

  it('saves the shown period under a name', () => {
    const onSave = vi.fn()
    render(<PeriodBar periods={[]} openId={null} current={{ from: '2026-01-01', to: null }} onOpen={() => {}} onSave={onSave} onRemove={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Save this period' }))
    expect(screen.getByText('1 Jan 2026 – today')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Name of the period'), { target: { value: '  This year  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith({ name: 'This year', from: '2026-01-01', to: null })
    expect(screen.queryByLabelText('Name of the period')).toBeNull()
  })

  it('opens and removes a saved period', () => {
    const onOpen = vi.fn()
    const onRemove = vi.fn()
    render(<PeriodBar periods={periods} openId="p1" current={{ from: '2026-03-01', to: '2026-06-30' }} onOpen={onOpen} onSave={() => {}} onRemove={onRemove} />)
    const chip = screen.getByRole('button', { name: 'After the crash' })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    expect(chip.getAttribute('title')).toBe('1 Mar 2026 – 30 Jun 2026')
    fireEvent.click(chip)
    expect(onOpen).toHaveBeenCalledWith('p1')
    fireEvent.click(screen.getByRole('button', { name: 'Remove After the crash' }))
    expect(onRemove).toHaveBeenCalledWith('p1')
  })
})
