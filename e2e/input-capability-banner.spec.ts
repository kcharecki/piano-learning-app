import { expect, test } from '@playwright/test'

/**
 * Proof for roadmap 5.6, rewritten for UI-04b.
 *
 * 5.6 shipped this as a dismissible in-flow banner. The 2026-08-12 UI audit
 * found the cost: that banner plus a "Pair Bluetooth MIDI" button rendered as
 * in-flow content on SEVEN screens, pushing the actual task below them every
 * time. UI-04b replaced it with one topbar chip whose popover holds the same
 * information, so the assertions here move from "a banner is visible and can
 * be dismissed" to "the chip states the input situation, and the detail is one
 * click away" — the same guarantee, minus the seven-fold repetition.
 *
 * The distinction 5.6 drew is still the point of the file and is still tested:
 * Web MIDI genuinely absent from the browser is a DIFFERENT message from the
 * API existing but nothing being plugged in. This project's headless Chromium
 * ships `requestMIDIAccess` and only denies permission, so the second case is
 * the default here and the first has to be stubbed.
 */

const CHIP = /MIDI connected|No MIDI — using on-screen keys/

test('the topbar chip names the input situation, and its popover explains why, when Web MIDI does not exist in this browser', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: undefined,
    })
  })

  await page.goto('/')

  // The chip is shell furniture, not page content: present without
  // scrolling, on every screen, regardless of which of its two possible
  // homes it currently renders in — the topbar at <=1024px, or the nav
  // rail's own footer above that (roadmap UI-36). This spec runs at
  // Playwright's default desktop viewport, so the rail-footer home is the
  // one actually exercised here; the assertions below hold at either home,
  // since they only ever address the chip by its accessible name/role.
  const chip = page.getByRole('button', { name: CHIP })
  await expect(chip).toBeVisible()
  await expect(chip).toHaveAttribute('aria-expanded', 'false')

  // The explanation is NOT in the page flow until asked for.
  await expect(page.getByText(/can't connect a MIDI keyboard/i)).toBeHidden()

  await chip.click()
  await expect(chip).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText(/can't connect a MIDI keyboard/i)).toBeVisible()

  // Escape closes and hands focus back to the chip.
  await page.keyboard.press('Escape')
  await expect(chip).toHaveAttribute('aria-expanded', 'false')
  await expect(chip).toBeFocused()
})

test('the browser-cannot-do-MIDI explanation stays hidden when Web MIDI exists', async ({
  page,
}) => {
  await page.goto('/')

  const chip = page.getByRole('button', { name: CHIP })
  await expect(chip).toBeVisible()
  await chip.click()

  // Nothing is plugged in, so the popover says so — but it must NOT claim the
  // browser is incapable, which is the distinction roadmap 5.6 exists to draw.
  await expect(page.getByText(/can't connect a MIDI keyboard/i)).toBeHidden()
  await expect(page.getByText(/no MIDI keyboard connected/i)).toBeVisible()
})

test('no screen renders the MIDI status in its own content flow any more (UI-04b)', async ({
  page,
}) => {
  // The regression this guards: seven screens each rendered their own copy.
  // The chip lives in the topbar, so the count of matching elements inside
  // <main> must be zero on every one of them.
  for (const screen of [
    'Practice',
    'Sight reading',
    'Flashcards',
    'Ear training',
    'Rhythm',
    'Technique',
    'Theory',
  ]) {
    await page.goto('/')
    await page.getByRole('link', { name: screen }).or(page.getByRole('button', { name: screen })).first().click()
    const inFlow = page.locator('main').getByText(/no MIDI keyboard connected/i)
    await expect(inFlow, `${screen} must not render the MIDI banner in its own flow`).toHaveCount(0)
  }
})
