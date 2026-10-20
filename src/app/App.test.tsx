import 'fake-indexeddb/auto'
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App.tsx'

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, () => {}], offlineReady: [false, () => {}], updateServiceWorker: async () => {} }),
}))

afterEach(cleanup)

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('App shell', () => {
  it('shows the dashboard by default', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy()
  })

  it('routes to the import page', () => {
    renderAt('/import')
    expect(screen.getByRole('heading', { name: 'Import' })).toBeTruthy()
  })

  it('redirects unknown routes to the dashboard', async () => {
    renderAt('/does-not-exist')
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy()
  })

  it('shows an offline badge while the connection is gone', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderAt('/import')
    act(() => void window.dispatchEvent(new Event('offline')))
    expect(screen.getByText('Offline')).toBeTruthy()

    onLine.mockReturnValue(true)
    act(() => void window.dispatchEvent(new Event('online')))
    expect(screen.queryByText('Offline')).toBeNull()
    onLine.mockRestore()
  })
})
