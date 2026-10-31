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

// The tests do not depend on the live price proxy, which only answers the app's own site: it answers here
// as Yahoo does for a symbol without data.
test.beforeEach(async ({ page }) => {
  await page.route('https://portfolio-history-price-proxy.tibo-dhave.workers.dev/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ chart: { result: null, error: { code: 'Not Found', description: 'No data found' } } }),
    }),
  )
})

/** Opens the demo the quick way, past the welcome flow; the flow itself has a test of its own. */
async function openDemo(page: Page) {
  await page.addInitScript(() => localStorage.setItem('portfolio-history:onboarded', '1'))
  await page.goto('./')
  await page.getByRole('button', { name: 'Try the demo' }).first().click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.locator('.chart-wrapper canvas').first()).toBeVisible({ timeout: 20_000 })
}

test('the demo dashboard shows the chart, the side panel, the holdings and the allocation', async ({ page }) => {
  const errors = watchErrors(page)
  await openDemo(page)
  await expect(page.getByRole('complementary', { name: 'State inspection' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Holdings on/ })).toBeVisible()
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

test.describe('in a Dutch browser', () => {
  test.use({ locale: 'nl-BE' })

  test('the app is in English, with euros and dates as on the continent', async ({ page }) => {
    const errors = watchErrors(page)
    // Someone who chose Dutch in an earlier version gets English too.
    await page.addInitScript(() => localStorage.setItem('portfolio-history:language', 'nl'))
    await openDemo(page)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('heading', { name: /Holdings on/ })).toBeVisible()
    await expect(page.locator('.inspection-day')).toHaveText(/\d{1,2} [A-Z][a-z]{2} \d{4}/)
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

test('the holdings and the allocation never cover each other, at any width', async ({ page }) => {
  await openDemo(page)
  for (const width of [390, 1000, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    const allocation = await page.locator('.allocation-bar').boundingBox()
    const holdings = await page.locator('.dash-holdings').boundingBox()
    if (!allocation || !holdings) throw new Error('Both should be shown')
    expect(holdings.y >= allocation.y + allocation.height - 0.5, `overlap at ${width}px`).toBe(true)
    // Nothing sticks out of the page sideways either.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `page wider than the screen at ${width}px`).toBe(true)
  }
})

test('zooms into the chart with the mouse wheel, which trims the period, and back with All', async ({ page }) => {
  const errors = watchErrors(page)
  await openDemo(page)
  const from = page.getByLabel('From')
  const first = await from.inputValue()
  const chart = page.locator('.chart-wrapper canvas').first()
  await chart.scrollIntoViewIfNeeded()
  const box = await chart.boundingBox()
  if (!box) throw new Error('The chart should be drawn')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -600)
  await expect(from).not.toHaveValue(first)
  await page.locator('.timeline-presets').getByRole('button', { name: 'All', exact: true }).click()
  await expect(from).toHaveValue(first)
  expect(errors).toEqual([])
})

test('the side panel follows the day under the pointer, and pins a clicked day', async ({ page }) => {
  await openDemo(page)
  const day = page.locator('.inspection-day')
  const atEnd = await day.textContent()
  const chart = page.locator('.chart-wrapper canvas').first()
  await chart.scrollIntoViewIfNeeded()
  const box = await chart.boundingBox()
  if (!box) throw new Error('The chart should be drawn')
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2)
  await expect(day).not.toHaveText(atEnd ?? '')
  const hovered = await day.textContent()
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height / 2)
  await page.mouse.move(box.x + box.width * 0.3, box.y - 120)
  await expect(day).toHaveText(hovered ?? '')
  await page.getByRole('button', { name: /Unpin/ }).click()
  await expect(day).toHaveText(atEnd ?? '')
})

test('finds a stock and compares with it for now', async ({ page }) => {
  const errors = watchErrors(page)
  await page.route('https://portfolio-history-price-proxy.tibo-dhave.workers.dev/yahoo/search**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ results: [{ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', type: 'EQUITY' }] }),
    }),
  )
  await openDemo(page)
  await page.getByRole('button', { name: /Benchmark/ }).click()
  await page.getByRole('button', { name: '+ Other stock' }).click()
  await page.getByRole('searchbox', { name: 'Search a stock, fund or index' }).fill('apple')
  await page.getByRole('button', { name: /AAPL Apple Inc\./ }).click()
  await expect(page.getByRole('button', { name: 'AAPL', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Back to the default' })).toBeVisible()
  // In the list to choose a default from, in Settings.
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('option', { name: /Apple Inc\. \(AAPL\)/ })).toHaveCount(1)
  expect(errors).toEqual([])
})

test('hiding amounts leaves only percentages on the dashboard', async ({ page }) => {
  const errors = watchErrors(page)
  await openDemo(page)
  await page.getByRole('button', { name: 'Hide amounts' }).click()
  await expect(page.locator('.chart-wrapper canvas').first()).toBeVisible({ timeout: 20_000 })
  const figures = page.locator('.dash-figures')
  await expect(figures.locator('.figure').first()).toHaveText('€•••')
  await expect(figures).toContainText('%')
  await expect(figures).not.toContainText(/€\s?\d/)
  await page.getByRole('button', { name: 'Show amounts' }).click()
  await expect(figures.locator('.figure').first()).toContainText(/\d/)
  expect(errors).toEqual([])
})

test('the data check opens from the dashboard and checks the demo', async ({ page }) => {
  const errors = watchErrors(page)
  await openDemo(page)
  await page.getByRole('link', { name: /Data check/ }).click()
  await expect(page.getByRole('heading', { name: 'Data check' })).toBeVisible()
  await expect(page.locator('.check')).toHaveCount(9)
  await expect(page.getByText('could not be shown')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('the risk tab checks how the demo is spread', async ({ page }) => {
  const errors = watchErrors(page)
  await openDemo(page)
  await page.getByRole('link', { name: 'Analysis' }).click()
  await page.getByRole('tab', { name: 'Risk' }).click()
  await expect(page.getByRole('heading', { name: 'Risk checks' })).toBeVisible()
  await expect(page.locator('.check')).toHaveCount(7)
  await expect(page.getByText('No single stock above 10%')).toBeVisible()
  expect(errors).toEqual([])
})

test('a first visit is welcomed and can start the demo from there', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'See what your portfolio really did' })).toBeVisible()
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByRole('heading', { name: 'Make it yours' })).toBeVisible()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: /Try the demo/ }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.locator('.chart-wrapper canvas').first()).toBeVisible({ timeout: 20_000 })
  // Seen once is enough: leaving the demo shows the plain empty dashboard.
  await page.getByRole('button', { name: 'Leave demo' }).first().click()
  await expect(page.getByText(/No portfolio loaded yet/)).toBeVisible()
  expect(errors).toEqual([])
})
