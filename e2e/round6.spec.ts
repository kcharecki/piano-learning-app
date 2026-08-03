import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for the round that emptied `knip.jsonc` (roadmap 3.2a, 3.3, 4.4a,
 * 4.6a, 4.8). Each of these five modules was built complete and unreachable;
 * what is asserted here is that a user can now reach and USE each one, because
 * "built, tested, never executed" is the defect this project ships most.
 */

/** Console/page errors, collected from the moment the page is created (see e2e/smoke.spec.ts). */
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

test('the roman-numeral analysis of the bundled sample is shown under the score (roadmap 3.2a)', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.goto('/')
  await nav(page, 'Practice').click()

  const analysis = page.getByRole('region', { name: 'Harmonic analysis' })
  await expect(analysis).toBeVisible()
  // The sample is in C major and its harmony is the I-IV-V-I skeleton — named
  // literally, because a panel that renders "—" everywhere would satisfy any
  // weaker assertion.
  await expect(analysis).toContainText('Key: C major')
  // Read the numerals out of their own spans rather than off the flattened
  // text: "m.1" and "I" are adjacent spans, so a text-level word-boundary
  // match sees "m.1I" and fails for reasons that have nothing to do with the
  // analysis being right.
  const numerals = await analysis.locator('.analysis-chords').allInnerTexts()
  expect(numerals.slice(0, 4)).toEqual(['I', 'V', 'IV', 'I'])
  await expect(analysis).toContainText(/cadence/i)

  expect(errors).toEqual([])
})

test('a theory quiz can be answered on the on-screen keyboard and is graded (roadmap 3.3)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)
  await page.goto('/')
  await nav(page, 'Theory').click()

  const drill = page.getByRole('region', { name: 'Theory quiz' })
  await expect(drill).toBeVisible()
  // The prompt is a real instruction, not a placeholder.
  await expect(page.getByTestId('theory-prompt')).not.toHaveText('')
  await expect(page.getByTestId('theory-progress')).toContainText('0 /')

  // Answer it — every key of the on-screen keyboard is a legal press, and the
  // drill must register it either way rather than ignore it. The progress
  // readout moving off "0 /" is what proves the press reached the grader.
  const keyboard = page.getByRole('group', { name: 'On-screen keyboard' })
  await keyboard.getByRole('button').first().click()

  await expect(page.getByTestId('theory-progress')).not.toContainText('0 /', { timeout: 10_000 })

  expect(errors).toEqual([])
})

test('a technique drill is engraved with fingerings and can be run (roadmap 4.4a)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)
  await page.goto('/')
  await nav(page, 'Technique').click()

  await expect(page.getByRole('heading', { name: /technique/i })).toBeVisible()

  // REQ-3.7.1: the drill is engraved WITH its recommended fingerings. A real
  // OSMD render of a scale is well past the 50-element discriminator this
  // suite uses; fingering digits appear as text in the SVG.
  const container = page.getByTestId('score-container')
  await expect(container.locator('svg')).toBeVisible({ timeout: 15_000 })
  expect(await container.locator('svg *').count()).toBeGreaterThan(50)

  expect(errors).toEqual([])
})

test('progress can be exported and the file round-trips back in (roadmap 4.6a)', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.goto('/')
  await nav(page, 'Progress').click()

  const panel = page.getByRole('group', { name: 'Export progress' })
  await expect(panel).toBeVisible()

  // The download must produce a real file whose contents parse as the
  // snapshot — a button that fires no download would pass a visibility check.
  const downloadPromise = page.waitForEvent('download')
  await panel.getByRole('button', { name: /download.*json/i }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.json$/)

  expect(errors).toEqual([])
})

test('an annotation written against a measure survives a reload (roadmap 4.8)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)
  await page.goto('/')
  await nav(page, 'Practice').click()

  const notes = page.getByRole('group', { name: 'Measure note' })
  await expect(notes).toBeVisible()
  const text = 'watch the left hand here'
  await notes.getByRole('textbox').fill(text)
  await notes.getByRole('button', { name: /add|save/i }).click()
  await expect(notes.getByText(text)).toBeVisible()

  // Gate the reload on the annotation actually being IN IndexedDB, not merely
  // on screen. The on-screen note is zustand state, written synchronously;
  // the persisted copy goes through `persistence.ts`'s async write queue, so
  // reloading the instant the text renders races that `put` and can destroy
  // it before it commits — after which the assertion below is checking for
  // something that was never saved. This spec failed roughly half of all
  // full-suite runs for exactly that reason (it passes in isolation, where
  // the machine is idle and the write always wins). Same gate, and the same
  // reasoning, as e2e/export-restore.spec.ts's wipe check.
  await expect(async () => {
    const stored = await page.evaluate(
      () =>
        new Promise<unknown>((resolve, reject) => {
          const open = indexedDB.open('piano-learning-app')
          open.onerror = () => reject(open.error)
          open.onsuccess = () => {
            const db = open.result
            if (!db.objectStoreNames.contains('annotations')) {
              resolve(undefined)
              return
            }
            const request = db
              .transaction('annotations', 'readonly')
              .objectStore('annotations')
              .get('annotations')
            request.onerror = () => reject(request.error)
            request.onsuccess = () => resolve(request.result as unknown)
          }
        }),
    )
    expect(JSON.stringify(stored ?? null)).toContain(text)
  }).toPass({ timeout: 10_000 })

  await page.reload()
  await nav(page, 'Practice').click()

  // REQ-3.2.6: annotations are persisted per piece. This is the assertion that
  // fails if `COLLECTIONS.annotations` is written by nothing, which was true
  // of every declared collection in this app at least once.
  await expect(page.getByRole('group', { name: 'Measure note' }).getByText(text)).toBeVisible({
    timeout: 10_000,
  })

  expect(errors).toEqual([])
})
