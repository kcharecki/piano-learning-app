import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  installFakeMidi,
  armFakeMidiOnClick,
  waitForArmedFakeMidiSchedule,
  type RelativeFakeMidiEvent,
} from './fake-midi.ts'
import { seedPlayingLevel } from './seedLevel.ts'

/**
 * The a11y sweep's overlay matrix (2026-08 UI audit follow-up): every overlay
 * this task's brief names gets a permanent Escape-closes /
 * focus-returns-to-trigger proof, so the contract `TimingFeedback.tsx`,
 * `ScoreScreen.tsx`, `ReviewOverlay.tsx` and `AssessmentPanel.tsx` already
 * implement (native `<dialog>` + `showModal`/`close` + an `onClose` handler
 * that calls `triggerRef.current?.focus()` — the same pattern in all four)
 * cannot regress silently in any one of them.
 *
 * The nav drawer, the Reference panel and the topbar input-status popover are
 * proven elsewhere already and are not repeated here:
 *  - nav drawer: `Shell.tsx`'s own Escape/focus-return, proven together with
 *    its Tab-cycling trap in `e2e/nav-drawer-focus-trap.spec.ts`.
 *  - Reference panel: `e2e/reference-panel.spec.ts`.
 *  - input-status popover: `e2e/input-capability-banner.spec.ts`.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'assessment-six-bars.musicxml')
const FIXTURE_TITLE = 'Assessment Six-Bar Fixture'
const QUARTER_MS = 500
const NOTE_HOLD_MS = 400
const CORRECT_PITCHES: readonly number[] = [
  60, 62, 64, 65, // measure 1
  67, 69, 71, 72, // measure 2
  60, 64, 67, 71, // measure 3
]

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

function nav(page: Page, label: string) {
  return page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: label, exact: true })
}

test('the "Change piece…" dialog closes on Escape and returns focus to its trigger', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.goto('/')
  await nav(page, 'Practice').click()
  await expect(page.getByRole('heading', { name: 'Twinkle, Twinkle, Little Star' })).toBeVisible()

  const trigger = page.getByRole('button', { name: 'Change piece…' })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Change piece' })
  await expect(dialog).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()

  expect(errors).toEqual([])
})

test('the accuracy-info dialog closes on Escape and returns focus to its trigger', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.goto('/')
  await nav(page, 'Practice').click()

  // TimingFeedback (and the info button inside it) do not exist until a run
  // has started (see practice-accuracy-caveat.spec.ts's own module doc).
  await page.getByRole('group', { name: 'Transport' }).getByRole('button', { name: 'Play', exact: true }).click()

  const trigger = page.getByRole('button', { name: "What this screen doesn't check" })
  await expect(trigger).toBeVisible()
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: "What this screen doesn't check" })
  await expect(dialog).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()

  await page.getByRole('group', { name: 'Transport' }).getByRole('button', { name: 'Stop', exact: true }).click()
  expect(errors).toEqual([])
})

test('the Assessment breakdown dialog and the Review overlay dialog both close on Escape and return focus to their own trigger', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = collectErrors(page)

  await installFakeMidi(page)
  await page.goto('/')
  await seedPlayingLevel(page, 3)
  await page.reload()

  await nav(page, 'Practice').click()
  await page.getByRole('button', { name: 'Change piece…' }).click()
  await page.getByLabel(/Import a score/i).setInputFiles(FIXTURE_PATH)
  await expect(page.getByRole('heading', { name: FIXTURE_TITLE })).toBeVisible()
  await page.getByRole('dialog', { name: 'Change piece' }).getByRole('button', { name: 'Close' }).click()

  const loopRangeSettle = page.getByRole('group', { name: 'Loop range' })
  await expect(loopRangeSettle.getByLabel('to measure')).toHaveValue('6')
  await page.waitForTimeout(300)

  await page.getByText('More tools').click()

  const events: RelativeFakeMidiEvent[] = []
  for (const [k, note] of CORRECT_PITCHES.entries()) {
    const onOffset = k * QUARTER_MS
    events.push({ type: 'on', note, offsetMs: onOffset })
    events.push({ type: 'off', note, offsetMs: onOffset + NOTE_HOLD_MS })
  }
  await armFakeMidiOnClick(page, 'Start assessment', events)
  await page.getByRole('button', { name: 'Start assessment' }).click()
  await waitForArmedFakeMidiSchedule(page)

  const accuracy = page.getByTestId('assessment-accuracy')
  await expect(accuracy).toBeVisible({ timeout: 20_000 })

  // --- Assessment breakdown dialog ---
  const breakdownTrigger = page.getByRole('button', { name: 'View measure breakdown' })
  await breakdownTrigger.click()
  const breakdownDialog = page.getByRole('dialog', { name: 'Measure breakdown' })
  await expect(breakdownDialog).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(breakdownDialog).toBeHidden()
  await expect(breakdownTrigger).toBeFocused()

  // --- Review overlay dialog (measures 4-6 unplayed, so this exists) ---
  const reviewTrigger = page.getByRole('button', { name: /^Review \d+ problem measures?$/ })
  await expect(reviewTrigger).toBeVisible()
  await reviewTrigger.click()
  const reviewDialog = page.getByRole('dialog', { name: 'Review' })
  await expect(reviewDialog).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(reviewDialog).toBeHidden()
  await expect(reviewTrigger).toBeFocused()

  expect(errors).toEqual([])
})
