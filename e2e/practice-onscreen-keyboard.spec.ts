import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { seedPlayingLevel } from './seedLevel.ts'

/**
 * E2E proof for roadmap 5.4 (REQ-3.3.7): the practice screen is PLAYABLE with
 * no Web MIDI at all.
 *
 * This is the case Safari, Firefox and every browser on iPadOS are actually in
 * (roadmap B.7 — all iOS browsers are WebKit underneath, and WebKit ships no
 * Web MIDI). Before 5.4, `PracticeScreen` handed `useRecorder` an `undefined`
 * input, `useRecorder` built no fan-out from it, and note matching, feedback
 * colouring, wait mode, assessment, timing feedback, recording and the tempo
 * ramp were therefore ALL inert on those browsers, silently, under a green
 * suite.
 *
 * So this spec deletes `navigator.requestMIDIAccess` before any app code runs,
 * and then plays with the mouse only. Every assertion below is about a
 * behaviour, never presence: notes are GRADED by the real matcher (the
 * accuracy/correct counters move), and wait mode — which gates the transport
 * on the owed notes being HELD — actually releases. The second is the load
 * bearing one: it can only pass if press and release arrive as separate
 * events, because `core/practice/waitmode.ts` withdraws a note's credit on
 * note-off.
 */

/** The pitches sounding at tick 0 of the bundled sample (see e2e/waitmode.spec.ts). */
const FIRST_BEAT_PITCHES = [48, 52, 55, 60] as const

/** Console/page errors, collected from the moment the page is created. */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

/**
 * Removes Web MIDI from the page before the app's connection effect can run —
 * `src/adapters/midi/webmidi.ts` checks for `navigator.requestMIDIAccess` and
 * returns `err('Web MIDI API is not available in this browser.')` without it,
 * which is exactly what a WebKit browser does.
 */
async function removeWebMidi(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Reflect.deleteProperty(Navigator.prototype, 'requestMIDIAccess')
    Reflect.deleteProperty(navigator, 'requestMIDIAccess')
  })
}

/**
 * `atLevel`, when given, seeds the `playing` track to that level before
 * navigating — roadmap 5.17 gates wait mode behind it, and a fresh app
 * always starts at level 1.
 */
async function openPractice(page: Page, atLevel?: number): Promise<void> {
  await page.goto('/')
  if (atLevel !== undefined) {
    await seedPlayingLevel(page, atLevel)
    await page.reload()
  }
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Practice', exact: true })
    .click()
  await expect(page.getByRole('group', { name: 'Transport' })).toBeVisible()
}

const keyboard = (page: Page) => page.getByRole('group', { name: 'Play the score' })
const key = (page: Page, note: number) => keyboard(page).getByRole('button', { name: `Key ${note}` })

test('with no Web MIDI, the on-screen keyboard is shown and its notes are graded by the real matcher', async ({
  page,
}) => {
  test.setTimeout(45_000)
  const errors = collectErrors(page)

  await removeWebMidi(page)
  await openPractice(page)

  // The status line tells the truth about the browser...
  await expect(page.getByText(/^No MIDI keyboard connected/)).toBeVisible()
  // ...and the screen is still playable, without the learner setting anything up.
  await expect(keyboard(page)).toBeVisible()

  const correct = page.getByTestId('feedback-correct')
  const accuracy = page.getByTestId('feedback-accuracy')
  await expect(correct).toHaveText('0')

  // Play the score's own first beat by clicking its keys. Nothing about this
  // path involves MIDI: these are pointer events on <button>s.
  const transport = page.getByRole('group', { name: 'Transport' })
  await transport.getByRole('button', { name: 'Play', exact: true }).click()
  for (const pitch of FIRST_BEAT_PITCHES) await key(page, pitch).click()

  // Graded — by `core/practice/matcher.ts`, through the same seam a MIDI
  // keyboard feeds. A screen that merely rendered a keyboard would leave these
  // at zero forever, which is precisely the defect 5.4 exists to close.
  await expect(async () => {
    expect(Number(await correct.textContent())).toBeGreaterThan(0)
  }).toPass({ timeout: 10_000 })
  await expect(accuracy).not.toHaveText('0%')

  await transport.getByRole('button', { name: 'Stop', exact: true }).click()
  expect(errors).toEqual([])
})

test('with no Web MIDI, wait mode holds the transport and on-screen notes release it (roadmap 5.4)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = collectErrors(page)

  await removeWebMidi(page)
  await openPractice(page, 3)

  const waitMode = page.getByRole('group', { name: 'Wait mode' })
  await waitMode.getByRole('checkbox', { name: 'Wait for me' }).check()

  const transport = page.getByRole('group', { name: 'Transport' })
  const position = transport.getByLabel('Position')
  await transport.getByRole('button', { name: 'Play', exact: true }).click()

  await expect(waitMode.getByRole('status')).toContainText('Waiting for:')

  // Real wall-clock time passes with the transport playing and the position
  // does not move — the sample is 100bpm, so this is three full beats. Same
  // reasoning as e2e/waitmode.spec.ts: a short wait would pass against a
  // broken gate a third of the time.
  const heldPosition = await position.textContent()
  await page.waitForTimeout(1_800)
  await expect(position).toHaveText(heldPosition ?? '')

  // A chord needs every note down AT ONCE, and a mouse has one pointer — so
  // this is the case the latch exists for, and driving it with a real mouse is
  // the only way to prove a mouse-only learner can clear a wait-mode barrier.
  await page.getByRole('checkbox', { name: /hold keys down/i }).check()

  for (const pitch of FIRST_BEAT_PITCHES) await key(page, pitch).click()

  // All four are still down: latched keys release only on a second press.
  for (const pitch of FIRST_BEAT_PITCHES) {
    await expect(key(page, pitch)).toHaveAttribute('data-state', 'pressed')
  }

  await expect(async () => {
    expect(await position.textContent()).not.toBe(heldPosition)
  }).toPass({ timeout: 10_000 })

  await transport.getByRole('button', { name: 'Stop', exact: true }).click()
  expect(errors).toEqual([])
})

test('a connected MIDI keyboard leaves the on-screen one hidden until it is asked for', async ({
  page,
}) => {
  // The flip side, so the default cannot be "always on": a learner with real
  // hardware must not have their screen taken over by a keyboard they are not
  // using. Uses the fake MIDI harness, i.e. Web MIDI PRESENT.
  const { installFakeMidi, FAKE_MIDI_DEVICE_NAME } = await import('./fake-midi.ts')
  const errors = collectErrors(page)

  await installFakeMidi(page)
  await openPractice(page)
  await expect(
    page.getByText(new RegExp(`MIDI keyboard connected: ${FAKE_MIDI_DEVICE_NAME}`)),
  ).toBeVisible()

  await expect(keyboard(page)).toBeHidden()

  await page.getByRole('checkbox', { name: /on-screen keyboard/i }).check()
  await expect(keyboard(page)).toBeVisible()

  expect(errors).toEqual([])
})
