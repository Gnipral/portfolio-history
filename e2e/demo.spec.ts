import { expect, type Page, test } from '@playwright/test'

/** Fails the test on any uncaught error or console error, the kind that gave a white screen before. */
function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

async function openDemo(page: Page) {
  await page.goto('./')
  await page.getByRole('button', { name: 'Try the demo' }).first().click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.locator('.chart-wrapper canvas').first()).toBeVisible({ timeout: 20_000 })
}

test('the demo dashboard shows the chart, positions and allocation', async ({ page }) => {
  const errors = watchErrors(page)
  await openDemo(page)
  await expect(page.getByRole('heading', { name: 'Positions' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Allocation' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('every analysis tab opens without an error', async ({ page }) => {
  const errors = watchErrors(page)
  await openDemo(page)
  await page.getByRole('link', { name: 'Analysis' }).click()
  for (const tab of ['Taxes', 'Dividends', 'Realized', 'Costs', 'Risk', 'Planning']) {
    await page.getByRole('tab', { name: tab }).click()
    await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tabpanel').locator('h3').first()).toBeVisible()
    await expect(page.getByText('could not be shown')).toHaveCount(0)
  }
  expect(errors).toEqual([])
})

test('the share card is drawn', async ({ page }) => {
  const errors = watchErrors(page)
  await openDemo(page)
  await page.getByRole('button', { name: /Share/ }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Share your return' })
  await expect(dialog).toBeVisible()
  const drawn = await dialog.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data ?? []
    return pixels.some((value, i) => i % 4 !== 3 && value !== 0)
  })
  expect(drawn).toBe(true)
  expect(errors).toEqual([])
})

test.describe('in Dutch', () => {
  test.use({ locale: 'nl-BE' })

  test('a Dutch browser gets the app in Dutch', async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto('./')
    await page.getByRole('button', { name: 'Probeer de demo' }).first().click()
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Posities' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'nl')
    await page.getByRole('link', { name: 'Analyse' }).click()
    for (const tab of ['Belastingen', 'Dividenden', 'Gerealiseerd', 'Kosten', 'Risico', 'Planning']) {
      await page.getByRole('tab', { name: tab }).click()
      await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true')
    }
    expect(errors).toEqual([])
  })
})

/** A one-page PDF with a line of text, with the byte offsets pdf.js expects. */
function pdfWithText(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

test('a PDF is read under the Content-Security-Policy', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('./#/import')
  await page.locator('input[type="file"]').setInputFiles({ name: 'statement.pdf', mimeType: 'application/pdf', buffer: pdfWithText('Not a broker statement') })
  // The text was read: the app says which first line it found.
  await expect(page.getByText('Not a broker statement')).toBeVisible({ timeout: 20_000 })
  expect(errors).toEqual([])
})
