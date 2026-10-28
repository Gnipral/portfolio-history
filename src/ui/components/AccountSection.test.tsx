import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

async function section() {
  vi.resetModules()
  return (await import('./AccountSection.tsx')).AccountSection
}

describe('AccountSection', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('stays hidden while the build has no account service', async () => {
    vi.stubEnv('VITE_ACCOUNT_URL', '')
    const AccountSection = await section()
    const { container } = render(<AccountSection />)
    expect(container.textContent).toBe('')
  })

  it('offers a passkey account, and says it is optional', async () => {
    vi.stubEnv('VITE_ACCOUNT_URL', 'https://account.example')
    const AccountSection = await section()
    render(<AccountSection />)
    expect(screen.getByText('Account (optional)')).toBeTruthy()
    expect(screen.getByText(/Everything works without an account/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create an account' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
  })

  it('saves, loads, signs out and deletes once signed in', async () => {
    vi.stubEnv('VITE_ACCOUNT_URL', 'https://account.example')
    vi.stubGlobal('fetch', async () => Response.json({ dataUpdatedAt: '2026-10-27T10:00:00.000Z' }))
    localStorage.setItem('account-token', 'token-123')
    const AccountSection = await section()
    render(<AccountSection />)
    expect(await screen.findByText(/Last saved on 27 Oct 2026/)).toBeTruthy()
    for (const name of ['Save to my account', 'Load from my account', 'Sign out', 'Delete account']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
  })
})
