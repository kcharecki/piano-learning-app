import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap B.6 (REQ-4.4/REQ-4.4.1): the app is genuinely usable
 * on a tablet, where — per B.7's platform table — Web MIDI does not exist at
 * all, so the on-screen keyboard is not a fallback but THE input.
 *
 * The 2026-08-06 measurement (all 62 controls under Apple's 44px minimum,
 * on-screen keys at 16x6px) predated the nav-drawer and responsive.css work
 * merged since; re-measuring live in this browser found most of that already
 * fixed, with three real gaps this spec's fixes close:
 *
 *   1. A full-range keyboard (Practice/Technique, 37 keys) has no
 *      `flex-shrink: 0` on its keys, so the "scroll, don't shrink" container
 *      (`.keyboard-diagram`'s own comment) was shrinking white keys from the
 *      intended 56px down to ~41px at 768px — silently reintroducing the
 *      sub-44px targets the breakpoint exists to prevent.
 *   2. Black keys are 0.62 of the white key's width by design (a real piano's
 *      are narrower too), which never clears 44px at any reasonable white-key
 *      size — `--black-key-w` now floors to `max(44px, …)` at tablet widths.
 *   3. Every checkbox/radio in the app is already wrapped in a `<label>`
 *      (`<label><input type="checkbox" />text</label>`), so the LABEL is the
 *      real tap target — but nothing sized it, leaving a ~13x13px native box
 *      as the only styled hint of a ~129x21px hittable area. `label:has(>
 *      input[type="checkbox"], > input[type="radio"])` now gets
 *      `min-height: var(--control-h)`, same as every other control.
 *
 * Per the roadmap text, this asserts at BOTH 768x1024 and 1024x1366, over
 * EVERY nav destination: no interactive control's rendered box is under 44px
 * in either dimension (measured live from the CSSOM, never from CSS text),
 * the page never scrolls horizontally, and a TAPPED on-screen key grades an
 * answer. `hasTouch` is set so Playwright synthesizes real touch, not just a
 * narrow mouse viewport — the automation pane used for interactive driving
 * cannot prove this on its own: it does not composite CSS transition frames,
 * so the drawer's `translateX` sits frozen at t=0 there (see
 * e2e/nav-drawer-tablet.spec.ts's module doc for the same caveat).
 */

test.use({ hasTouch: true })

/** Apple's minimum touch target, the bar the 2026-08-06 review measured against. */
const TOUCH_MIN_PX = 44

const TABLET_SIZES = [
  { width: 768, height: 1024, label: '768x1024' },
  { width: 1024, height: 1366, label: '1024x1366' },
] as const

const NAV_DESTINATIONS = [
  'Today',
  'Lessons',
  'Practice',
  'Sight reading',
  'Flashcards',
  'Ear training',
  'Rhythm',
  'Technique',
  'Metronome',
  'Theory',
  'Repertoire',
  'Progress',
  'Settings',
] as const

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

/** At <=1024px the nav is an off-canvas drawer (roadmap 5.27); open it before a destination is tappable. Mirrors `goTo` in scripts/visual-pass.mjs, but with `.tap()` — this spec is about touch, not a synthesised click. */
async function goTo(page: Page, label: string): Promise<void> {
  const opener = page.getByRole('button', { name: 'Open navigation' })
  if (await opener.isVisible()) {
    await opener.tap()
    await expect(opener).toHaveAttribute('aria-expanded', 'true')
  }
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: label, exact: true })
    .tap()
  // Shell.tsx's `goTo` closes the drawer itself on navigate; this just waits
  // for that to actually happen before the next measurement.
  await expect(opener).toHaveAttribute('aria-expanded', 'false')
}

/** No horizontal overflow anywhere on the page. */
async function hasNoHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  )
}

/**
 * Every visible, enabled interactive control's REAL tap target, measured live
 * from the CSSOM rather than asserted from CSS text. A checkbox/radio's own
 * native box stays a small, unstyled ~13px square by design — every one in
 * this app is wrapped in a `<label>` that IS styled to the touch minimum
 * (see primitives.css), and clicking anywhere on that label activates the
 * input, so the label — not the box the browser draws inside it — is the
 * control's actual hit area.
 */
async function undersizedControls(page: Page): Promise<string[]> {
  // Measure the SETTLED layout, not a frame mid-transition.
  //
  // Roadmap UI-22 gave the app real motion (the nav drawer slides, a
  // `<details>` reveal rises, buttons press). `getBoundingClientRect()` on an
  // element inside an actively transformed ancestor comes back sub-pixel — a
  // control whose `min-height` is exactly `--touch-min` reads 43.9921875 and
  // fails a `< 44` test, which is how this spec started flaking across
  // different screens on different runs (Practice, then Repertoire, then
  // neither) after that pass landed.
  //
  // This is NOT a loosened assertion: the threshold, the selector and the
  // exclusions are all unchanged, and the 44px floor is still checked exactly.
  // The guarantee this spec exists to protect is about the resting target a
  // finger lands on, not about a 200ms animation frame — so wait for the
  // animations to finish and then measure that.
  await page.evaluate(async () => {
    const running = document.getAnimations()
    await Promise.all(running.map((a) => a.finished.catch(() => undefined)))
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined))))
  })

  // `getAnimations()` plus a frame barrier still was not enough: a transition
  // that has not STARTED when we sample is not in that list, and the drawer
  // begins sliding shut a tick after the navigation click. 400ms clears the
  // longest motion token in the system (`--dur-3`, 320ms) with margin, so the
  // read always lands on the resting layout.
  //
  // Deliberately a settle, not a retry-until-green loop: retrying until the
  // numbers agree would hide a control that is genuinely undersized at rest.
  // This is the same fixed-settle approach `scripts/visual-pass.mjs` already
  // uses before it screenshots.
  await page.waitForTimeout(400)

  return page.evaluate((min) => {
    function effectiveBox(el: Element): { width: number; height: number } {
      const isCheckboxOrRadio =
        el.tagName === 'INPUT' &&
        (el.getAttribute('type') === 'checkbox' || el.getAttribute('type') === 'radio')
      const target = isCheckboxOrRadio ? (el.closest('label') ?? el) : el
      const r = target.getBoundingClientRect()
      return { width: r.width, height: r.height }
    }
    const selector =
      'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"], [tabindex]:not([tabindex="-1"])'
    const bad: string[] = []
    for (const el of Array.from(document.querySelectorAll(selector))) {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      if ((el as HTMLButtonElement | HTMLInputElement).disabled) continue
      const { width, height } = effectiveBox(el)
      if (width === 0 && height === 0) continue // not laid out (e.g. a hidden panel's children)
      if (width < min || height < min) {
        const label = el.getAttribute('aria-label') ?? el.textContent ?? '(unlabelled)'
        bad.push(`${el.tagName} "${label.trim().slice(0, 40)}" ${Math.round(width)}x${Math.round(height)}`)
      }
    }
    return bad
  }, TOUCH_MIN_PX)
}

for (const size of TABLET_SIZES) {
  test(`every nav destination clears the 44px touch minimum with no horizontal scroll at ${size.label}`, async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const errors = collectErrors(page)
    await page.setViewportSize({ width: size.width, height: size.height })
    await page.goto('/')

    // Nav collapsed (the default landing state): the drawer itself must not
    // be hittable while closed, and the page must already be scroll-free.
    expect(await hasNoHorizontalScroll(page)).toBe(true)

    for (const destination of NAV_DESTINATIONS) {
      await goTo(page, destination)
      expect(await hasNoHorizontalScroll(page), `${destination} scrolls horizontally`).toBe(true)
      const bad = await undersizedControls(page)
      expect(bad, `${destination} at ${size.label} has controls under ${TOUCH_MIN_PX}px:\n${bad.join('\n')}`).toEqual(
        [],
      )
    }

    // Nav EXPANDED state too — the drawer's own items, not just the shell
    // chrome around them (roadmap 5.27 already covers hit-testing them;
    // this covers their size).
    const opener = page.getByRole('button', { name: 'Open navigation' })
    await opener.tap()
    await expect(opener).toHaveAttribute('aria-expanded', 'true')
    const badOpen = await undersizedControls(page)
    expect(badOpen, `open nav drawer at ${size.label} has controls under ${TOUCH_MIN_PX}px:\n${badOpen.join('\n')}`).toEqual(
      [],
    )

    expect(errors).toEqual([])
  })

  test(`a tapped on-screen key grades a flashcard answer at ${size.label} (the primary input wherever MIDI is unavailable — REQ-4.4.1)`, async ({
    page,
  }) => {
    const errors = collectErrors(page)
    await page.setViewportSize({ width: size.width, height: size.height })
    await page.goto('/')
    await goTo(page, 'Flashcards')

    // Default deck is `staff-to-key` (REQ-3.4.5): a note on the staff,
    // answered by pressing the matching key. Which key is correct is not the
    // point here — that TAPPING one reaches the real grader is.
    const keyboard = page.getByRole('group', { name: 'On-screen keyboard' })
    await expect(keyboard).toBeVisible()
    const total = page.getByTestId('flashcard-stats-total')
    await expect(total).toHaveText('0')

    const firstKey = keyboard.getByRole('button').first()
    const box = await firstKey.boundingBox()
    expect(box, 'first on-screen key has no box').not.toBeNull()
    if (box !== null) {
      expect(box.width, 'on-screen key width under the touch minimum').toBeGreaterThanOrEqual(TOUCH_MIN_PX)
      expect(box.height, 'on-screen key height under the touch minimum').toBeGreaterThanOrEqual(TOUCH_MIN_PX)
    }
    await firstKey.tap()

    // Graded — by the real SRS/flashcard pipeline, through the same seam a
    // MIDI keyboard feeds (see e2e/practice-onscreen-keyboard.spec.ts and
    // e2e/flashcards-interval.spec.ts, which prove the same shape for other
    // decks). A screen that merely rendered a keyboard would leave this at 0.
    await expect(page.getByTestId('flashcard-feedback')).toBeVisible()
    await expect(total).toHaveText('1')

    expect(errors).toEqual([])
  })
}
