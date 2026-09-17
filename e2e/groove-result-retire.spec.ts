import { expect, test, type Page } from '@playwright/test'
import { playGrooveHits } from './drum-pads.ts'

/**
 * Roadmap T.31 — the result panel's ownership rules once a graded run is on
 * screen.
 *
 * `useGrooveRun` used to stamp a result with `grooveId@bpm` and hide it
 * whenever that identity differed from the current plan's. Both directions of
 * that shape were wrong: cycling back to the SAME groove resurrected an old
 * verdict for a run that never happened at the current settings, and
 * retuning the tempo DELETED the panel out from under a learner still reading
 * it, even though nothing about the run they just played stopped being true.
 *
 * The fix splits the two triggers apart: a groove change actually clears the
 * result (not merely hides it — so cycling back does not resurrect it), and a
 * tempo change leaves it standing, labelled with the tempo it was actually
 * graded at rather than whatever the tempo control now reads.
 */

const TEMPO_FOR_RUN = 200

function mainNav(page: Page) {
  return page.getByRole('navigation', { name: 'Main' })
}

function result(page: Page) {
  return page.getByRole('region', { name: 'Result' })
}

async function openGrooveTrainer(page: Page): Promise<void> {
  await page.goto('/drums/today')
  await mainNav(page).getByRole('button', { name: 'Groove', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Groove trainer' })).toBeVisible()
}

test('a tempo change keeps the graded result and its tempo label; a groove change retires it, and it does not come back (roadmap T.31)', async ({
  page,
}) => {
  await openGrooveTrainer(page)

  // 200 bpm keeps the whole run (one bar count-in, two graded) to about
  // 3.6 s, so the spec does not have to wait out a slow tempo to get a
  // verdict on screen.
  const tempo = page.getByRole('spinbutton', { name: /tempo/i })
  await tempo.fill(String(TEMPO_FOR_RUN))
  await tempo.press('Enter')
  await expect(tempo).toHaveValue(String(TEMPO_FOR_RUN))

  // An empty run still grades — every limb missing is still a verdict.
  await playGrooveHits(page, [])

  await expect(result(page)).toBeVisible({ timeout: 10_000 })
  await expect(result(page).getByText(`Graded at ${TEMPO_FOR_RUN} bpm`)).toBeVisible()

  // Tempo is only taken away while a run is actually on — once graded, the
  // stepper is live again, and using it must not touch the panel it sits
  // above except to leave its tempo label alone.
  await expect(page.getByRole('button', { name: 'Slower' })).toBeEnabled()
  await page.getByRole('button', { name: 'Slower' }).click()
  await expect(tempo).toHaveValue(String(TEMPO_FOR_RUN - 1))

  await expect(result(page)).toBeVisible()
  await expect(result(page).getByText(`Graded at ${TEMPO_FOR_RUN} bpm`)).toBeVisible()

  // A different groove is a different chart: the marking must not survive it.
  await page.getByRole('button', { name: 'Next groove' }).click()
  await expect(result(page)).not.toBeVisible()

  // Nor resurrect when cycling straight back to the groove — and the exact
  // tempo — it was graded under. It was actually cleared, not merely hidden.
  await page.getByRole('button', { name: 'Previous groove' }).click()
  await expect(result(page)).not.toBeVisible()
})
