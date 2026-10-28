import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

  it('asks to choose an encryption password before the first save', async () => {
    vi.stubEnv('VITE_ACCOUNT_URL', 'https://account.example')
    vi.stubGlobal('fetch', async (url: string) =>
      url.endsWith('/data') ? Response.json({ error: 'Nothing saved yet' }, { status: 404 }) : Response.json({ dataUpdatedAt: null }),
    )
    localStorage.setItem('account-token', 'token-123')
    const AccountSection = await section()
    render(<AccountSection />)
    const form = await screen.findByRole('form', { name: 'Choose an encryption password' })
    expect(screen.getByRole('button', { name: 'Save to my account' }).hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByLabelText('Encryption password'), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set the password' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Use at least 10 characters.')

    fireEvent.change(screen.getByLabelText('Encryption password'), { target: { value: 'long enough password' } })
    fireEvent.change(screen.getByLabelText('Repeat the password'), { target: { value: 'long enough password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set the password' }))
    expect(await screen.findByText('Unlocked: this device can save and load your account.')).toBeTruthy()
    expect(form.isConnected).toBe(false)
    expect(screen.getByRole('button', { name: 'Save to my account' }).hasAttribute('disabled')).toBe(false)
  })
})
