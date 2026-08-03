import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap 4.8a (REQ-3.2.6). `AnnotationPanel`'s fingering and
 * highlight controls were reachable only through `measureIndex` —
 * `PracticeScreen` never supplied `selectedNoteId`, so those two controls had
 * been permanently disabled since the day they shipped (see
 * e2e/round6.spec.ts's "an annotation written against a measure survives a
 * reload" test, which only exercises the OTHER half of this same panel: the
 * per-measure notes, which never needed a selection at all).
 *
 * This proves the missing half end to end: clicking a real notehead in the
 * rendered score selects it, a fingering set against that selection survives
 * a reload, and — the point of the whole test — it reads back associated
 * with the SAME note id, not merely "a" fingering annotation and not merely
 * "the controls became enabled" (which would also pass against a selection
 * wired to a hardcoded id).
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

type StoredFingering = { readonly noteId: string; readonly finger: number }

/**
 * Reads `COLLECTIONS.annotations` straight out of IndexedDB — same store
 * `e2e/round6.spec.ts`'s measure-note test reads, same reasoning: the
 * on-screen panel is zustand state written synchronously, but the persisted
 * copy goes through `persistence.ts`'s async write queue, so a reload timed
 * against the screen alone can race it. The stored shape is
 * `PersistedAnnotations = { byScoreId: Record<string, ScoreAnnotations> }`
 * (`persistence.ts`'s `persistAnnotations`); this flattens every score's
 * `items` and picks out `fingering` entries, so the test does not need to
 * know which score id the bundled sample happens to use.
 */
async function readStoredFingerings(page: Page): Promise<readonly StoredFingering[]> {
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
  const byScoreId = (stored as { byScoreId?: Record<string, { items?: unknown[] }> } | undefined)
    ?.byScoreId
  if (byScoreId === undefined) return []
  const out: StoredFingering[] = []
  for (const scoreAnnotations of Object.values(byScoreId)) {
    for (const item of scoreAnnotations.items ?? []) {
      if (typeof item !== 'object' || item === null) continue
      const v = item as Record<string, unknown>
      if (v.kind === 'fingering' && typeof v.noteId === 'string' && typeof v.finger === 'number') {
        out.push({ noteId: v.noteId, finger: v.finger })
      }
    }
  }
  return out
}

test('a fingering set on a clicked notehead survives a reload, associated with that same note (roadmap 4.8a)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)
  await page.goto('/')
  await nav(page, 'Practice').click()

  const scoreSvg = page.locator('[data-testid="score-container"] svg')
  await expect(scoreSvg).toBeVisible()

  const fingering = page.getByRole('group', { name: 'Fingering' })
  const fingerInput = fingering.getByLabel(/finger/i)
  // Disabled before any note is selected — the exact defect this roadmap
  // task fixes: nothing ever supplied a selection, so this control had been
  // permanently unreachable.
  await expect(fingerInput).toBeDisabled()

  // A real notehead — stamped by the engraver, not fabricated by this test —
  // clicking anything else on the score (staff lines, ledger, background)
  // must leave the panel disabled instead of selecting something.
  const notehead = page.locator('[data-testid="score-container"] [data-note-id]').first()
  await expect(notehead).toHaveCount(1)
  const noteId = await notehead.getAttribute('data-note-id')
  expect(noteId).not.toBeNull()
  expect(noteId).not.toBe('')

  await notehead.click()
  await expect(fingerInput).toBeEnabled()

  await fingerInput.fill('3')
  await fingering.getByRole('button', { name: /set fingering/i }).click()
  await expect(fingering.getByTestId('annotation-current-finger')).toHaveText('Finger 3')

  // The miss path (roadmap-review finding: half of onSelectNote's contract
  // was asserted only against a fake in ScoreViewer.test.tsx, never against a
  // real OSMD render): a click on the score container that lands on no
  // notehead — a corner of the SVG, well away from the stamped notehead
  // clicked above — must clear the selection and disable the panel again,
  // not leave the previous note's controls enabled.
  // Near the BOTTOM-left, not the top-left: `.practice-controls` overlaps the
  // top of the engraving and intercepts pointer events there, so a click at
  // (2, 2) never reaches the score at all. The clef sits at the left edge and
  // carries no `data-note-id`, so this point is on the SVG and on no notehead
  // — which is exactly the miss path being asserted.
  const box = await scoreSvg.boundingBox()
  expect(box).not.toBeNull()
  if (box !== null) {
    await scoreSvg.click({ position: { x: 2, y: box.height - 4 } })
  }
  await expect(fingerInput).toBeDisabled()

  // Re-select the note to continue the rest of the test.
  await notehead.click()
  await expect(fingerInput).toBeEnabled()

  // Gate the reload on the fingering actually being IN IndexedDB, not merely
  // on screen — see readStoredFingerings's doc comment and
  // e2e/round6.spec.ts's identical gate for the same race.
  await expect(async () => {
    const stored = await readStoredFingerings(page)
    expect(stored).toContainEqual({ noteId, finger: 3 })
  }).toPass({ timeout: 10_000 })

  await page.reload()
  await nav(page, 'Practice').click()
  await expect(page.locator('[data-testid="score-container"] svg')).toBeVisible()

  // Read the annotation back out of storage once more, post-reload: it must
  // still name the SAME note id, not merely "a" fingering annotation
  // somewhere — this is what would fail against a selection mechanism that
  // silently dropped or renumbered the id across a reload.
  const storedAfterReload = await readStoredFingerings(page)
  expect(storedAfterReload).toContainEqual({ noteId, finger: 3 })

  // And the panel itself, driven through a real click on the SAME note id in
  // the freshly-reloaded score — proves the click-to-select path itself
  // survives the reload, not just the stored data. A test that stopped at
  // "the controls became enabled" would also pass against a selection
  // hardcoded to some fixed id; reading finger 3 back for THIS specific note
  // id would not.
  const noteheadAfterReload = page.locator(
    `[data-testid="score-container"] [data-note-id="${noteId}"]`,
  )
  await expect(noteheadAfterReload).toHaveCount(1)
  await noteheadAfterReload.click()

  const fingeringAfterReload = page.getByRole('group', { name: 'Fingering' })
  await expect(fingeringAfterReload.getByTestId('annotation-current-finger')).toHaveText('Finger 3')

  expect(errors).toEqual([])
})
