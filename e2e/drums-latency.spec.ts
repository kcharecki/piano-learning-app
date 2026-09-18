import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { installFakeMidi } from './fake-midi.ts'
import { readStored } from './readStored.ts'

/**
 * E2E proof for roadmap DR-08 "latency calibration": a real browser run of
 * the calibration screen — count-in, 16 real pad strokes against a real
 * click track, a result, and Save actually persisting an offset a learner
 * can come back to. The scoring itself (`nearestClickDeviationMs`, the
 * median/spread math) is proven against `FakeClock`/fast-check in
 * `latency.test.ts`; the run's own timing contract is proven against a
 * manual frame driver in `useCalibration.test.ts`. What only a real browser
 * run can show is that the whole thing holds together end to end — the
 * count-in actually plays, sixteen real clicks land, and Save actually
 * writes something a reload can read back.
 *
 * Same console-clean capture as `drums-groove-mute.spec.ts`.
 */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

function calibrationState(page: Page) {
  return page.getByRole('status', { name: 'Calibration state' })
}

function result(page: Page) {
  return page.getByRole('status', { name: 'Result' })
}

function storedOffset(page: Page) {
  return page.getByRole('status', { name: 'Stored offset' })
}

function wirelessNotice(page: Page) {
  return page.getByRole('note', { name: 'Wireless notice' })
}

// @serial — plays a real count-in and real clicks in real time, the same
// reason every other timing-sensitive drums spec in this suite is.
test('calibrates a rig from 16 real pad strokes and saves the offset @serial', async ({ page }) => {
  const errors = collectErrors(page)

  await page.goto('/drums/latency')
  await expect(page.getByRole('heading', { name: 'Latency' })).toBeVisible()

  // No e-kit connected here (pads/keyboard only), so the device name is not
  // wireless-looking — the notice must not render (roadmap DR-08).
  await expect(wirelessNotice(page)).toHaveCount(0)

  await page.getByRole('button', { name: 'Start' }).click()
  await expect(calibrationState(page)).toHaveText(/^Hit 0 of 16/, { timeout: 10_000 })

  const kick = page.getByRole('button', { name: 'Kick' })
  for (let i = 0; i < 16; i++) {
    await kick.click()
    await page.waitForTimeout(750)
  }

  await expect(result(page)).toHaveText(
    /^Your hits read \d+ ms (late|early) on average|^Your hits read on the click/,
  )

  await page.getByRole('button', { name: 'Save offset' }).click()
  await expect(storedOffset(page)).toHaveText(/\d+ ms (late |early )?offset stored$/)

  // Gate the reload on the offset actually being in IndexedDB, not just in
  // the on-screen store — the race acceptance-m3.spec documents: the store
  // update is synchronous, the write goes through persistence.ts's async
  // write queue, and reloading before it lands destroys it unwritten.
  await expect(async () => {
    const stored = (await readStored(page, 'settings', 'drumsLatency')) as
      | { readonly offsets?: Readonly<Record<string, unknown>> }
      | undefined
    expect(stored?.offsets?.['local']).toBeDefined()
  }).toPass({ timeout: 10_000 })

  // Persistence is wired by the main thread (`persistence.ts`'s restore) —
  // if this fails here, that wiring is what to check first, not this spec.
  await page.reload()
  await expect(storedOffset(page)).toHaveText(/\d+ ms (late |early )?offset stored$/)

  expect(errors).toEqual([])
})

// @serial — no real timing here, but grouped with the rest of this spec's
// drums-latency runs for the same reason `drums-input-monitor.spec.ts` isn't:
// this one shares the route with the timing-sensitive test above.
test('a wireless-looking e-kit name shows the BLE honesty notice (roadmap DR-08) @serial', async ({
  page,
}) => {
  const errors = collectErrors(page)

  await installFakeMidi(page, { deviceName: 'Bluetooth MIDI Kit' })
  await page.goto('/drums/latency')
  await expect(page.getByRole('heading', { name: 'Latency' })).toBeVisible()

  // Confirms the fake e-kit is actually wired (and its overridden name has
  // taken effect) before asserting on the notice it drives.
  await expect(page.getByRole('status', { name: 'E-kit' })).toContainText('Bluetooth MIDI Kit')

  await expect(wirelessNotice(page)).toHaveText(
    'Bluetooth MIDI adds jitter that calibration cannot remove — only the constant offset is. Use USB for scored work.',
  )

  expect(errors).toEqual([])
})
