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
