import { expect, test, type Page } from '@playwright/test'

/**
 * Roadmap DR-23 "drums progress MVP" — the read-only progress screen at
 * `/drums/progress`, seeded straight into the app's real IndexedDB
 * (`piano-learning-app`, `settings` store, keys `drumsRudiments` /
 * `drumsHistory` / `drumsReading` — see `src/app/state/persistence.drums.ts`),
 * the same `db.transaction(...).objectStore(...).put(...)` shape
 * `e2e/seedLevel.ts` uses for `levelState`.
 *
 * `@serial` per this slice's brief. Console/page-error capture copied from
 * `e2e/drums-rudiments.spec.ts` — this slice's brief named
 * `e2e/drums-groove-loop.spec.ts` as the source of that pattern, but that
 * spec carries no console-error capture at all; flagged in the defect
 * report rather than guessed at.
 *
 * `single-stroke-roll` (tier 1, `bpmBand.target` 100) is the rudiment given
 * a record at target; `multiple-bounce-roll` (also tier 1) is given one
 * below it — both real ids/targets read from
 * `src/content/drums/rudiments.tier12.ts` rather than invented.
 *
 * Coverage (roadmap DR-23 "coverage") assertions reuse this same seed: the
 * three attempts are all on `money-beat` (two steady, one not), so of the
 * trainer's three-groove library (`quarter-note-rock`, `money-beat`,
 * `money-beat-open-hat`) exactly one is played and steady, and the other two
 * — `Quarter-Note Rock` and `Money Beat (Open Hat)` — have never been
 * played. `Money Beat` itself must NOT show up in that "not yet played"
 * list (the exclusion trap: a coverage bug that counted attempts by index
 * rather than by `grooveId`, or that never marked anything played, would
 * both list `Money Beat` there too). The two rudiment records leave 38 of
 * the 40 curriculum rudiments unstarted.
 */

async function seedDrumsProgress(page: Page): Promise<void> {
  await page.evaluate(
    ({ dbName }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('settings', 'readwrite')
          tx.onerror = () => reject(tx.error)
          tx.oncomplete = () => resolve()

          const store = tx.objectStore('settings')
          store.put(
            {
              records: {
                'single-stroke-roll': { bestCleanBpm: 100, lastBpm: 100, at: 1 },
                'multiple-bounce-roll': { bestCleanBpm: 80, lastBpm: 80, at: 1 },
              },
            },
            'drumsRudiments',
          )
          store.put(
            {
              attempts: [
                {
                  grooveId: 'money-beat',
                  grooveTitle: 'Money Beat',
                  bpm: 120,
                  at: 3,
                  steady: false,
                  pads: [
                    { pad: 'kick', expected: 8, matched: 8, meanOffsetMs: 15 },
                    { pad: 'snare', expected: 4, matched: 4, meanOffsetMs: -6 },
                  ],
                },
                {
                  grooveId: 'money-beat',
                  grooveTitle: 'Money Beat',
                  bpm: 100,
                  at: 2,
                  steady: true,
                  pads: [
                    { pad: 'kick', expected: 8, matched: 8, meanOffsetMs: 15 },
                    { pad: 'snare', expected: 4, matched: 4, meanOffsetMs: -6 },
                  ],
                },
                {
                  grooveId: 'money-beat',
                  grooveTitle: 'Money Beat',
                  bpm: 90,
                  at: 1,
                  steady: true,
                  pads: [
                    { pad: 'kick', expected: 8, matched: 8, meanOffsetMs: 15 },
                    { pad: 'snare', expected: 4, matched: 4, meanOffsetMs: -6 },
                  ],
                },
              ],
            },
            'drumsHistory',
          )
          store.put(
            {
              level: 3,
              runs: [
                // Newest first, as `addRun` stores them: the learner climbed 80 → 90 → 100.
                { level: 3, accuracy: 1 },
                { level: 3, accuracy: 0.9 },
                { level: 3, accuracy: 0.8 },
              ],
            },
            'drumsReading',
          )
        }
      }),
    { dbName: 'piano-learning-app' },
  )
}

// @serial — seeds real IndexedDB and reloads; run outside the fully-parallel
// pass the same reasoning e2e/drums-reading.spec.ts documents for itself.
test('the drums progress screen reads rudiment tiers, groove bests, limb bias and reading level from persisted state (roadmap DR-23) @serial', async ({
  page,
}) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))

  // The database must already exist before we can seed it.
  await page.goto('/')
  await seedDrumsProgress(page)

  await page.goto('/drums/progress')
  await expect(page.getByRole('heading', { level: 1, name: 'Progress' })).toBeVisible()

  const rudiments = page.getByRole('region', { name: 'Rudiments' })
  await expect(rudiments.getByText(/^Tier 1: 1 of \d+ at target, 2 started$/)).toBeVisible()

  const grooves = page.getByRole('region', { name: 'Grooves' })
  await expect(grooves.getByText('Money Beat — best steady 100 bpm (3 attempts)')).toBeVisible()

  const bias = page.getByRole('region', { name: 'Limb bias' })
  await expect(bias.getByText(/^Kick: 15 ms late/)).toBeVisible()
  await expect(bias.getByText(/^Snare: 6 ms early/)).toBeVisible()

  const trends = page.getByRole('region', { name: 'Trends' })
  await expect(
    trends.getByText('Money Beat — worst limb 15, 15, 15 ms · too few runs · steady 2 of 3'),
  ).toBeVisible()

  const reading = page.getByRole('region', { name: 'Reading' })
  await expect(reading.getByText('Level 3 — last runs 80%, 90%, 100%')).toBeVisible()

  const coverage = page.getByRole('region', { name: 'Coverage' })
  const grooveCoverageText = await coverage.getByLabel('Groove coverage').innerText()
  expect(grooveCoverageText).toBe(
    'Grooves: 1 of 3 played, 1 steady. Not yet played: Quarter-Note Rock, Money Beat (Open Hat).',
  )
  // Exclusion trap: `Money Beat` (played and steady) must not appear in the
  // "Not yet played" list — only as part of `Money Beat (Open Hat)`, which
  // is a different groove entirely.
  expect(grooveCoverageText).not.toMatch(/Not yet played:.*\bMoney Beat,/)
  expect(grooveCoverageText).not.toMatch(/Not yet played:.*\bMoney Beat\.$/)

  const rudimentCoverageText = await coverage.getByLabel('Rudiment coverage').innerText()
  expect(rudimentCoverageText).toMatch(/^Rudiments: 2 of 40 started\. Next up: /)
  expect(rudimentCoverageText).not.toMatch(/Single Stroke Roll/)
  expect(rudimentCoverageText).not.toMatch(/Multiple Bounce Roll/)

  expect(consoleErrors).toEqual([])
})
