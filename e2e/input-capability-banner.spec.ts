import { expect, test } from '@playwright/test'

/**
 * Proof for roadmap 5.6: the input-capability banner names Web MIDI's
 * absence rather than degrading silently, and does not fire for the merely
 * "nothing plugged in yet" case `MidiDeviceStatus` already covers (this
 * project's headless Chromium ships `requestMIDIAccess` and only denies
 * permission — see `smoke.spec.ts`'s "no MIDI keyboard connected" test — so
 * the banner correctly stays hidden there and this file stubs true absence).
 */
test('names the limitation when Web MIDI does not exist in this browser, and can be dismissed', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: undefined,
    })
  })

  await page.goto('/')

  const banner = page.getByRole('status').filter({ hasText: /no web midi/i })
  await expect(banner).toBeVisible()

  await banner.getByRole('button', { name: 'Dismiss' }).click()
  await expect(banner).toBeHidden()
})

test('stays hidden when Web MIDI exists in this browser', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('status').filter({ hasText: /no web midi/i })).toBeHidden()
})
