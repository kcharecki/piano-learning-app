import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { installFakeMidi, FAKE_MIDI_DEVICE_NAME } from './fake-midi.ts'
import { seedPlayingLevel } from './seedLevel.ts'

/**
 * E2E proof for roadmap 2.30 (REQ-3.3.3): wait mode, driven end to end. It is
 * the one REQ-3.3.x mode with no e2e, and its defining behaviour — playback
 * actually STOPPING and staying stopped until the owed notes are played — is
 * what a unit test with a fake frame driver is worst at proving: a fake clock
 * that only advances when the test says so cannot distinguish "gated" from
 * "nothing is driving the transport at all".
 *
 * The bundled sample's first beat is C4 in the right hand over a C3/E3/G3
 * chord in the left, so four distinct pitches are owed before the transport
 * may move. Nothing here is armed to a click: the whole point is that real
 * wall-clock time passes with the transport running and the position does not
 * change, so events are fired from Node at instants of this test's choosing.
 */

/** The pitches sounding at tick 0 of the bundled sample (see src/content/scores). */
const FIRST_BEAT_PITCHES = [48, 52, 55, 60] as const

/** Console/page errors, collected from the moment the page is created (see e2e/smoke.spec.ts). */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

/** Press and release every pitch, now, through the fake keyboard. */
async function playChord(page: Page, pitches: readonly number[]): Promise<void> {
  await page.evaluate(async (notes: readonly number[]) => {
    const fakeMidi = window.__fakeMidi
    if (fakeMidi === undefined) throw new Error('fake MIDI harness not installed')
    const at = performance.now()
    await fakeMidi.schedule([
      ...notes.map((note) => ({ type: 'on' as const, note, atMs: at + 60 })),
      ...notes.map((note) => ({ type: 'off' as const, note, atMs: at + 260 })),
    ])
  }, pitches)
}

test('wait mode holds playback until the owed notes are played, then releases it (roadmap 2.30)', async ({
  page,
}) => {
  test.setTimeout(45_000)
  const errors = collectErrors(page)

  await installFakeMidi(page)
  await page.goto('/')
  // Roadmap 5.17 gates wait mode behind the `playing` track's level — a
  // fresh app starts every track at level 1, below the gate.
  await seedPlayingLevel(page, 3)
  await page.reload()
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Practice', exact: true })
    .click()

  // UI-04b: the MIDI status line moved into the topbar chip's popover.
  const chip = page.getByRole('button', { name: /MIDI connected|No MIDI/ })
  await chip.click()
  await expect(
    page.getByText(new RegExp(`MIDI keyboard connected: ${FAKE_MIDI_DEVICE_NAME}`)),
  ).toBeVisible()
  await page.keyboard.press('Escape')

  const waitMode = page.getByRole('group', { name: 'Wait mode' })
  await waitMode.getByRole('checkbox', { name: 'Wait for me' }).check()

  const transport = page.getByRole('group', { name: 'Transport' })
  const position = transport.getByLabel('Position')
  await transport.getByRole('button', { name: 'Play', exact: true }).click()

  // The gate is visible in the UI: it names the pitches it is still owed.
  await expect(waitMode.getByRole('status')).toContainText('Waiting for:')

  // The sample is 100bpm, so a quarter note is 600ms. Three full beats of real
  // wall-clock time pass here with the transport playing; an ungated transport
  // would be most of a bar further on. This is the assertion the whole spec
  // exists for, and it is why the wait is long: at 200ms it would pass against
  // a completely broken gate roughly a third of the time.
  const heldPosition = await position.textContent()
  await page.waitForTimeout(1_800)
  await expect(position).toHaveText(heldPosition ?? '')

  // Pay the debt — and only then does it move.
  await playChord(page, FIRST_BEAT_PITCHES)

  await expect(async () => {
    expect(await position.textContent()).not.toBe(heldPosition)
  }).toPass({ timeout: 10_000 })

  expect(errors).toEqual([])
})
