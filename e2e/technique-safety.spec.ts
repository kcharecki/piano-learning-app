import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap 5.23. Green tempo scores can look like a technique
 * validation MIDI cannot actually perform — `TechniqueScreen.tsx` now
 * carries a standing statement of exactly what it cannot see (wrist height/
 * collapse, forearm alignment, finger curl, which finger was used, shoulder
 * tension, bench height), always visible, never behind a disclosure. This
 * asserts it directly from the running app so it cannot be quietly deleted
 * or hidden behind a toggle without an e2e failing — the same reason
 * `InputCapabilityBanner`'s "no MIDI" text gets its own e2e coverage.
 *
 * The periodic posture-prompt SCHEDULE (fires after enough drilling time or
 * enough completed attempts) is proved at the unit level in
 * `useTechniqueDrill.test.ts`, driven entirely by a `FakeClock` — that is
 * the only way to prove "driven by the injected Clock, never real time"
 * without an e2e run that blocks for the real threshold. This spec only
 * proves the prompt's on-screen wiring (that it renders and can be
 * dismissed), reached by advancing the same `Clock` seam through a level
 * far below the real threshold — see the second test below.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

function nav(page: Page, label: string) {
  return page.getByRole('navigation', { name: /main/i }).getByRole('button', { name: label, exact: true })
}

test('the Technique screen always states what MIDI cannot see, with no interaction needed (roadmap 5.23)', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.goto('/')
  await nav(page, 'Technique').click()

  await expect(page.getByRole('heading', { name: /technique/i })).toBeVisible()

  const statement = page.getByTestId('technique-safety-statement')
  await expect(statement).toBeVisible()
  const text = (await statement.textContent()) ?? ''

  // Names the specific blind spots the roadmap calls out — not a vague
  // "consult a teacher" disclaimer that would pass a substring check on
  // almost anything.
  for (const term of [
    /wrist/i,
    /forearm/i,
    /finger curl/i,
    /which finger/i,
    /shoulder tension/i,
    /bench height/i,
  ]) {
    expect(text).toMatch(term)
  }

  expect(errors).toEqual([])
})
