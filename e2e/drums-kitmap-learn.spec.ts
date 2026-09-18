import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { armFakeMidiOnClick, installFakeMidi, waitForArmedFakeMidiSchedule } from './fake-midi.ts'
import { readStored } from './readStored.ts'

/**
 * E2E proof for roadmap DR-02's MIDI-learn wizard: a real (faked) e-kit
 * stream drives "Learn kit" through its nine required steps — kick, snare,
 * hi-hat, hi-hat pedal, and the three toms, crash, ride, in `LEARN_STEPS`'
 * order (`@core/drums/kitmap/learn.ts`) — then the six optional steps are
 * skipped, Finish saves the map, the "Kit map" picker selects it, and the
 * selection survives a reload. The state machine's own rules (conflict,
 * undo, skip-refused-on-required) are proven in `learn.test.ts`; the
 * component wiring in `KitMapLearnCard.test.tsx`. What only a real browser
 * run can show is the whole chain — Web MIDI adapter -> `useDrumMidiInput`'s
 * `lastNoteOn` -> the wizard -> the store -> IndexedDB -> a fresh load.
 *
 * Events are armed on the "Learn kit" button's own click (per `fake-midi.ts`'s
 * `armFakeMidiOnClick` contract) rather than a pad button: the wizard has no
 * per-step button of its own to arm against, and the click that starts the
 * wizard is the one synchronous event available before the scheduled
 * note-ons need to start landing.
 */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

function kitMapSelect(page: Page) {
  return page.getByRole('combobox', { name: 'Kit map' })
}

function progressLine(page: Page) {
  return page.getByRole('status', { name: 'Learn kit progress' })
}

function captureItems(page: Page) {
  return page.getByRole('list', { name: 'Captured pads' }).getByRole('listitem')
}

test('the wizard captures a full kit, saves it, selects it, and survives a reload (roadmap DR-02) @serial', async ({
  page,
}) => {
  const errors = collectErrors(page)

  await installFakeMidi(page)
  await page.goto('/drums/latency')
  await expect(page.getByRole('heading', { name: 'Latency' })).toBeVisible()

  // Confirms the fake e-kit is actually wired (and General MIDI is still the
  // active map) before the wizard starts.
  await expect(page.getByRole('status', { name: 'E-kit' })).toContainText('General MIDI map')
  await expect(page.getByRole('button', { name: 'Learn kit' })).toBeEnabled()

  // The nine required steps in `LEARN_STEPS`' order: kick, snare, hi-hat,
  // hi-hat pedal, high tom, mid tom, floor tom, crash, ride. The hi-hat step
  // captures whatever raw note arrives — it does not read CC#4 — so a plain
  // note-on is enough.
  await armFakeMidiOnClick(page, 'Learn kit', [
    { type: 'on', note: 36, offsetMs: 0 },
    { type: 'on', note: 38, offsetMs: 150 },
    { type: 'on', note: 42, offsetMs: 300 },
    { type: 'on', note: 44, offsetMs: 450 },
    { type: 'on', note: 50, offsetMs: 600 },
    { type: 'on', note: 47, offsetMs: 750 },
    { type: 'on', note: 41, offsetMs: 900 },
    { type: 'on', note: 49, offsetMs: 1050 },
    { type: 'on', note: 51, offsetMs: 1200 },
  ])
  await page.getByRole('button', { name: 'Learn kit' }).click()
  await waitForArmedFakeMidiSchedule(page)

  await expect(progressLine(page)).toHaveText('Captured 9 of 15')
  const items = captureItems(page)
  await expect(items).toHaveCount(9)
  await expect(items.nth(0)).toHaveText('Kick — note 36')
  await expect(items.nth(1)).toHaveText('Snare — note 38')
  await expect(items.nth(2)).toHaveText('Hi-hat — note 42')
  await expect(items.nth(3)).toHaveText('Hi-hat pedal — note 44')
  await expect(items.nth(4)).toHaveText('High tom — note 50')
  await expect(items.nth(5)).toHaveText('Mid tom — note 47')
  await expect(items.nth(6)).toHaveText('Floor tom — note 41')
  await expect(items.nth(7)).toHaveText('Crash — note 49')
  await expect(items.nth(8)).toHaveText('Ride — note 51')

  // Six optional steps left: snareRim, crossStick, rideBell, rideEdge,
  // crash2, splash — none of our e-kit fixtures send them.
  for (let i = 0; i < 6; i += 1) {
    await page.getByRole('button', { name: 'Skip' }).click()
  }
  await expect(page.getByRole('heading', { name: 'All set — press Finish to save your map' })).toBeVisible()

  await page.getByRole('button', { name: 'Finish' }).click()

  await expect(kitMapSelect(page)).toHaveValue('Learned kit')
  await expect(page.getByRole('button', { name: 'Learn kit again' })).toBeVisible()

  // Gate the reload on the write actually landing in IndexedDB — the store
  // update above is synchronous, the write goes through persistence.ts's
  // async queue (same race `drums-latency.spec.ts`'s kit-map test guards).
  await expect
    .poll(
      async () => {
        const stored = (await readStored(page, 'settings', 'drumsKitMap')) as
          | { readonly presetName?: string }
          | undefined
        return stored?.presetName
      },
      { timeout: 10_000 },
    )
    .toBe('Learned kit')

  await page.reload()
  await expect(kitMapSelect(page)).toHaveValue('Learned kit')

  expect(errors).toEqual([])
})
