import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { armFakeMidiOnClick, installFakeMidi, waitForArmedFakeMidiSchedule } from './fake-midi.ts'

/**
 * E2E proof for roadmap DR-08 "input monitor": a real (faked) e-kit stream —
 * a mapped hit, an unmapped note, a hi-hat pedal position update, and a poly
 * aftertouch (cymbal choke) — shows up on `/drums/latency`'s input monitor
 * as four learner-facing lines, newest first. `monitor.test.ts` proves the
 * classification/formatting pure functions and `useDrumMidiInput.test.ts`
 * proves the hook wiring against a `FakeMidiInput`; what only a real browser
 * run can show is that a real `navigator.requestMIDIAccess` stream reaches
 * the rendered `<ol>` through the whole chain (Web MIDI adapter ->
 * `useMidiConnection` -> `useDrumMidiInput` -> `InputMonitor`).
 *
 * Arms the fake schedule on a click of the Kick pad rather than Start: Start
 * begins a real count-in/click-track run (`drums-latency.spec.ts`'s
 * territory, real time, `@serial`), which this spec has no need to enter —
 * the monitor listens to every raw event regardless of run phase.
 */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

function ekitStatus(page: Page) {
  return page.getByRole('status', { name: 'E-kit' })
}

function inputEventsList(page: Page) {
  return page.getByRole('list', { name: 'Input events' })
}

test('a mapped hit, an unmapped note, and a hi-hat position update all show up on the input monitor, newest first (roadmap DR-08)', async ({
  page,
}) => {
  const errors = collectErrors(page)

  await installFakeMidi(page)
  await page.goto('/drums/latency')
  await expect(page.getByRole('heading', { name: 'Latency' })).toBeVisible()

  // Confirms the fake e-kit is actually wired before events are scheduled
  // against it — the same guard `drums-ekit-input.spec.ts` uses.
  await expect(ekitStatus(page)).toContainText('General MIDI map')

  await expect(page.getByRole('status', { name: 'Input monitor status' })).toHaveText(
    'No events yet — hit a pad on your kit.',
  )

  // GM note 38 = acoustic snare (mapped); 27 is not in `GM_KIT_MAP.notes` at
  // all (unmapped); CC#4 is the hi-hat pedal position, always reported
  // regardless of what the kit-map engine does with it; GM note 49 = crash1
  // (see presets.ts), and a poly aftertouch on it is a choke — fired well
  // past the engine's 20ms per-pad debounce window (and after every other
  // event here) so it is never swallowed as a repeat.
  await armFakeMidiOnClick(page, 'Kick', [
    { type: 'on', note: 38, offsetMs: 0 },
    { type: 'on', note: 27, offsetMs: 200 },
    { type: 'cc', controller: 4, value: 127, offsetMs: 400 },
    { type: 'aftertouch', note: 49, pressure: 80, offsetMs: 600 },
  ])
  await page.getByRole('button', { name: 'Kick' }).click()
  await waitForArmedFakeMidiSchedule(page)

  const list = inputEventsList(page)
  const items = list.getByRole('listitem')
  await expect(items).toHaveCount(4)
  await expect(items.nth(0)).toContainText('aftertouch note 49 · pressure 80 → Crash (choke)')
  await expect(items.nth(1)).toContainText('CC 4 = 127 → pedal position')
  await expect(items.nth(2)).toContainText('note 27 · vel 96 → not in the map')
  await expect(items.nth(3)).toContainText('note 38 · vel 96 → Snare')

  // The gap column: every entry but the oldest shown reports the ms since
  // its older neighbour; the oldest has none to compare against.
  await expect(items.nth(0).locator('.input-monitor-gap')).toHaveText(/^\+\d+ ms$/)
  await expect(items.nth(3).locator('.input-monitor-gap')).toHaveText('')

  expect(errors).toEqual([])
})
