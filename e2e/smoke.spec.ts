import { expect, test } from '@playwright/test'

test('app boots and renders the shell', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/')
  await expect(page.getByRole('heading', { name: /piano learning app/i })).toBeVisible()
  expect(errors).toEqual([])
})
