import 'fake-indexeddb/auto'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App.tsx'

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, () => {}], updateServiceWorker: async () => {} }),
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
})
