import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { backupText } from '../../data/backup.ts'
import { db } from '../../data/db.ts'
import { DEFAULT_SETTINGS } from '../../settings/settings.ts'
import { BackupSection } from './BackupSection.tsx'

afterEach(cleanup)

describe('BackupSection', () => {
  it('asks for the password of a protected backup before restoring it', async () => {
    const text = await backupText({ transactions: [], importRecord: null, symbols: [], settings: { ...DEFAULT_SETTINGS, costBasis: 'fifo' } }, 'pw')
    render(<BackupSection />)
    fireEvent.change(screen.getByLabelText('Restore from a backup file'), { target: { files: [new File([text], 'backup.json')] } })

    const restore = await screen.findByRole('button', { name: 'Restore' })
    expect(restore.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('Password of the backup'), { target: { value: 'pw' } })
    fireEvent.click(restore)
    expect((await screen.findByRole('status')).textContent).toBe('Backup restored: 0 transactions.')
    expect(JSON.parse((await db.kv.get('settings'))!.value).costBasis).toBe('fifo')
  })

  it('explains a file that is no backup', async () => {
    render(<BackupSection />)
    fireEvent.change(screen.getByLabelText('Restore from a backup file'), { target: { files: [new File(['Date,Product'], 'export.csv')] } })
    expect((await screen.findByRole('status')).textContent).toBe('This is not a Portfolio History backup.')
  })
})
