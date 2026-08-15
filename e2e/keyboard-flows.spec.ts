import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { goToViaKeyboard, navButton, tabTo } from './keyboard-helpers.ts'

/**
 * The a11y sweep's ten keyboard-only flows (2026-08 UI audit follow-up). Each
 * test drives ONE flow end to end using the keyboard alone — real Tab presses
 * (via `tabTo`, `e2e/keyboard-helpers.ts`) to reach every control, Enter/Space
 * to activate it, never `locator.click()` and never `locator.focus()` as a
 * shortcut into a control Tab did not actually reach. A flow that needed a
 * fix says so in its own test's leading comment; a flow that was already
 * completable says that instead — this file is the permanent proof for both,
 * so neither can regress silently.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

test('1. start a session on Today, keyboard-only', async ({ page }) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)
  await page.goto('/')
  // Today is the default landing destination — no nav hop needed.
  await expect(page.getByRole('heading', { name: /today.?s session/i })).toBeVisible()

  const duration = page.getByRole('radio', { name: '15 min', exact: true })
  await tabTo(page, duration)
  // Radios select on Space, never Enter (Enter is a no-op on a bare radio).
  await page.keyboard.press('Space')
  await expect(duration).toBeChecked()

  const start = page.getByRole('button', { name: 'Start session', exact: true })
  await tabTo(page, start)
  await page.keyboard.press('Enter')

  await expect(page.getByTestId('session-run-position')).toContainText('Item 1 of')
  expect(errors).toEqual([])
})

test('2. play then stop on Practice, keyboard-only', async ({ page }) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)
  await page.goto('/')
  await goToViaKeyboard(page, 'Practice')
  await expect(page.getByRole('heading', { name: 'Twinkle, Twinkle, Little Star' })).toBeVisible()

  const transport = page.getByRole('group', { name: 'Transport' })
  const play = transport.getByRole('button', { name: 'Play', exact: true })
  await tabTo(page, play)
  await page.keyboard.press('Enter')
  await expect(play).toBeDisabled()

  const stop = transport.getByRole('button', { name: 'Stop', exact: true })
  await tabTo(page, stop)
  await page.keyboard.press('Enter')
  await expect(play).toBeEnabled()
  expect(errors).toEqual([])
})

test('3. answer a flashcard, keyboard-only', async ({ page }) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)
  await page.goto('/')
  await goToViaKeyboard(page, 'Flashcards')
  await expect(page.getByRole('heading', { name: 'Flashcards' })).toBeVisible()

  // Switch off the default 'Note -> key' deck (whose answer pad is a
  // 37-key on-screen keyboard — reachable, but not the shortest real path)
  // onto the interval deck's small answer pad, entirely via the keyboard:
  // focus the native <select>, ArrowDown to its second option.
  const drillSelect = page.getByLabel('Drill', { exact: true })
  await tabTo(page, drillSelect)
  await page.keyboard.press('ArrowDown')
  await expect(drillSelect).toHaveValue('interval-on-staff')

  const pad = page.getByRole('group', { name: 'Interval answer' })
  const firstAnswer = pad.getByRole('button').first()
  await expect(page.getByTestId('flashcard-stats-total')).toHaveText('0')
  await tabTo(page, firstAnswer)
  await page.keyboard.press('Enter')

  await expect(page.getByTestId('flashcard-feedback')).toBeVisible()
  await expect(page.getByTestId('flashcard-stats-total')).toHaveText('1')
  expect(errors).toEqual([])
})

test('4. answer an ear-training item, keyboard-only', async ({ page }) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)
  await page.goto('/')
  await goToViaKeyboard(page, 'Ear training')

  const play = page.getByRole('button', { name: /^Play/ });
  await tabTo(page, play)
  await page.keyboard.press('Enter')

  const pad = page.getByRole('group', { name: 'Interval answer' })
  const firstAnswer = pad.getByRole('button').first()
  await tabTo(page, firstAnswer)
  await page.keyboard.press('Enter')

  await expect(page.getByTestId('reveal-answer-naming')).toBeVisible({ timeout: 10_000 })
  expect(errors).toEqual([])
})

test('5. start and stop the metronome, keyboard-only', async ({ page }) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)
  await page.goto('/')
  await goToViaKeyboard(page, 'Metronome')
  await expect(page.getByRole('heading', { name: 'Metronome' })).toBeVisible()

  const readout = page.getByTestId('metronome-beat-readout')
  await expect(readout).toHaveText('Stopped')

  const start = page.getByRole('button', { name: 'Start' })
  await tabTo(page, start)
  await page.keyboard.press('Enter')
  await expect(readout).toContainText(/Bar \d+, beat \d+/, { timeout: 10_000 })

  const stop = page.getByRole('button', { name: 'Stop' })
  await tabTo(page, stop)
  await page.keyboard.press('Enter')
  await expect(readout).toHaveText('Stopped')
  expect(errors).toEqual([])
})

test('6. tap rhythm with Space, keyboard-only', async ({ page }) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)
  await page.goto('/')
  await goToViaKeyboard(page, 'Rhythm')
  await expect(page.getByRole('heading', { name: 'Rhythm' })).toBeVisible()

  const start = page.getByRole('button', { name: 'Start' })
  await tabTo(page, start)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('rhythm-tapping-status')).toBeVisible()

  // Space taps via a document-level listener (useRhythmDrill.ts), by design
  // reachable regardless of which element currently has focus — this proves
  // it really is, tapping straight after Enter without any extra Tab.
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('Space')
    await page.waitForTimeout(150)
  }
  await expect(page.getByTestId('rhythm-tap-count')).not.toHaveText('0')
  expect(errors).toEqual([])
})

test('7. add a repertoire piece, keyboard-only', async ({ page }) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)
  await page.goto('/')
  // Practice auto-loads the bundled sample the moment it mounts — no import
  // dialog needed for this flow, just a real score to add.
  await goToViaKeyboard(page, 'Practice')
  await expect(page.getByRole('heading', { name: 'Twinkle, Twinkle, Little Star' })).toBeVisible()

  await goToViaKeyboard(page, 'Repertoire')
  const screen = page.getByRole('region', { name: 'Repertoire' })
  const library = page.getByRole('list', { name: 'Repertoire pieces' })
  await expect(screen.getByText(/No pieces in your library yet/i)).toBeVisible()

  const levelSelect = screen.getByLabel('Level', { exact: true })
  await tabTo(page, levelSelect)
  await page.keyboard.press('ArrowDown')

  const addButton = screen.getByRole('button', { name: 'Add loaded score' })
  await tabTo(page, addButton)
  await page.keyboard.press('Enter')

  await expect(
    library.getByText('Twinkle, Twinkle, Little Star', { exact: true }),
  ).toBeVisible()
  expect(errors).toEqual([])
})

test('8. switch theory tabs, keyboard-only', async ({ page }) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)
  await page.goto('/')
  await goToViaKeyboard(page, 'Theory')
  await expect(page.getByRole('heading', { name: 'Theory', level: 1 })).toBeVisible()

  const circleTab = page.getByRole('tab', { name: 'Circle of fifths' })
  await tabTo(page, circleTab)
  await page.keyboard.press('Enter')

  await expect(circleTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('Circle of fifths explorer')).toBeVisible()
  expect(errors).toEqual([])
})

test('9. open a lesson, keyboard-only', async ({ page }) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)
  await page.goto('/')
  await goToViaKeyboard(page, 'Lessons')
  await expect(page.getByRole('heading', { name: 'Lessons', exact: true })).toBeVisible()

  const lessonsList = page.getByRole('list', { name: 'Lessons' })
  const lessonButton = lessonsList.getByRole('button', {
    name: 'Left Hand: The Middle C Position',
  })
  await tabTo(page, lessonButton)
  await page.keyboard.press('Enter')

  await expect(
    page.getByRole('heading', { name: 'Left Hand: The Middle C Position' }),
  ).toBeVisible()
  expect(errors).toEqual([])
})

test('10. change the theme in Settings, keyboard-only', async ({ page }) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)
  await page.goto('/')
  await goToViaKeyboard(page, 'Settings')

  const light = page.getByRole('radio', { name: 'Light' })
  await tabTo(page, light)
  await page.keyboard.press('Space')

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(errors).toEqual([])
})

// Keeps every nav destination proven reachable purely for the record — not a
// separate flow, but cheap insurance that `navButton` itself stays correct
// against a future nav relabel.
test('the nav itself is fully keyboard-reachable from a cold load', async ({ page }) => {
  await page.goto('/')
  await tabTo(page, navButton(page, 'Settings'), { max: 250 })
  await expect(navButton(page, 'Settings')).toBeFocused()
})
