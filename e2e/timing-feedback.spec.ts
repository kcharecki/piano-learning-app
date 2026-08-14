import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import {
  installFakeMidi,
  armFakeMidiOnClick,
  waitForArmedFakeMidiSchedule,
  FAKE_MIDI_DEVICE_NAME,
} from './fake-midi.ts'

/**
 * E2E proof for roadmap 2.23 (REQ-3.3.2): the early/late readout. The matcher
 * has always classified every attributed press and computed a signed
 * `deviationMs`; `useNoteFeedback` discarded both, so a learner was told a
 * note was correct and never told it was 120ms late — half of what REQ-3.3.2
 * asks for.
 *
 * Driven through the fake MIDI keyboard because the sign is the whole point
 * and a unit test with a fake clock proves nothing about which direction real
 * lateness lands in.
 */

/** The bundled sample's first right-hand note (C4), and its left-hand chord. */
const FIRST_NOTE = 60
/** How late the note is played, in ms. Well outside the matcher's 50ms on-time window. */
const LATE_BY_MS = 140

/** Console/page errors, collected from the moment the page is created (see e2e/smoke.spec.ts). */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

test('a note played late is reported as late, with its signed deviation (roadmap 2.23)', async ({
  page,
}) => {
  test.setTimeout(45_000)
  const errors = collectErrors(page)

  await installFakeMidi(page)
  await page.goto('/')
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

  // UI-09: the feedback strip (and `timing-last` inside it) does not exist
  // at all until a run has started — so this arms the schedule and clicks
  // Play FIRST, then reads `timing-last` in the brief window before the
  // scheduled note (LATE_BY_MS later) has actually fired. That is still the
  // "no judgement yet" state, just reached through the new UI's own gate
  // rather than before Play exists at all — what stops the test passing
  // against a component that always renders "late".
  const timingLast = page.getByTestId('timing-last')

  // The transport anchors tick 0 to the Play click, and the sample's first
  // note is at tick 0 — so an event armed at +LATE_BY_MS from the same click
  // is late by exactly that much, up to the harness's own sub-frame jitter.
  await armFakeMidiOnClick(page, 'Play', [
    { type: 'on', note: FIRST_NOTE, offsetMs: LATE_BY_MS },
    { type: 'off', note: FIRST_NOTE, offsetMs: LATE_BY_MS + 200 },
  ])
  await page.getByRole('group', { name: 'Transport' }).getByRole('button', { name: 'Play', exact: true }).click()
  await expect(timingLast).toHaveText('—')
  await waitForArmedFakeMidiSchedule(page)

  await expect(timingLast).toContainText('late', { timeout: 10_000 })

  // The number, not just the word: parse the signed deviation back out and
  // check it is positive and in the right neighbourhood. A sign flip (the most
  // likely defect, and the one useNoteFeedback is forbidden from introducing
  // by re-deriving the value) renders "early (-140 ms)" and fails here.
  const text = (await timingLast.textContent()) ?? ''
  const match = text.match(/\(([+-])(\d+) ms\)/)
  expect(match, `no signed deviation in "${text}"`).not.toBeNull()
  expect(match?.[1]).toBe('+')
  const deviation = Number(match?.[2] ?? '0')
  expect(deviation).toBeGreaterThan(LATE_BY_MS / 2)
  expect(deviation).toBeLessThan(LATE_BY_MS * 2)

  // And the running mean is displayed too — it was computed globally and per
  // measure and shown nowhere.
  await expect(page.getByTestId('timing-mean')).toContainText(/avg \d+ ms/)

  expect(errors).toEqual([])
})
