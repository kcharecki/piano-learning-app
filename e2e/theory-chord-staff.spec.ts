import { expect, test, type ConsoleMessage, type Locator, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap 5.50 (REQ-3.5.3/3.5.4): a chord is engraved on a real
 * staff wherever the theory reference shows one — the gap 5.38's
 * 2026-08-11 re-verification found (grep-confirmed no chord-staff component
 * existed anywhere in `src/app/theory/**`; live-confirmed 0 staff/score
 * elements inside `.chord-lookup` or `.diatonic-chords` with a diminished
 * seventh chord selected). Both call sites are covered: `ChordLookup`'s
 * looked-up chord (any root x quality x inversion) and one of
 * `ChordScaleReference`'s own diatonic-chord rows.
 *
 * Asserts OBSERVABLE ENGRAVED CONTENT, never mere presence. The task brief
 * for this spec is explicit that the >50-SVG-element discriminator this
 * suite uses ELSEWHERE (`round6.spec.ts`, `eartraining-reveal.spec.ts`, …,
 * for a full multi-note scale/exercise) is too weak for a single compact
 * chord — a real 4-note chord engraving here has only ~26 SVG elements
 * total, well under that threshold. Instead this counts noteheads exactly
 * (`.vf-notehead`, the same class `import-mxl.spec.ts` counts against a
 * fixture) AND reads each notehead's own engraved pitch off its
 * `data-note-id` (`osmdEngraver.ts`'s click-to-select stamp, format
 * `m{measure}.{hand}.{tick}.{midi}` — see `score.ts`'s `noteId`) to prove the
 * four noteheads are not just *some* four notes, but the chord's own.
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

/**
 * The sounding MIDI note each notehead under `region` engraves, read off its
 * own `data-note-id` rather than OCR-ing the SVG glyphs — `m0.r.0.61` -> 61.
 * A `#2`/`#3` same-position-duplicate suffix (never reached by a chord's own
 * distinct tones, but stripped defensively) is dropped before parsing.
 */
async function engravedMidiNotes(region: Locator): Promise<number[]> {
  const ids = await region
    .locator('[data-note-id]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-note-id') ?? ''))
  return ids
    .map((id) => Number(id.split('#')[0]?.split('.').pop()))
    .sort((a, b) => a - b)
}

test('looking up Db diminished 7th in ChordLookup engraves it on a real staff, not just the keyboard diagram', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.goto('/')

  await nav(page, 'Theory').click()
  await expect(page.getByRole('heading', { name: 'Theory', exact: true })).toBeVisible()

  // UI-17: the screen is four tabs and only the active one is in the DOM —
  // Chord lookup is now its own tab, not embedded inside the reference.
  await page.getByRole('tab', { name: 'Chord lookup' }).click()

  // `TheoryScreen` embeds `ChordLookup` directly in its own body — scoped to
  // `main` because the persistent reference-panel toggle (`.reference-toggle`,
  // available on every screen) can ALSO mount a second copy of the same
  // regions; unscoped queries would be ambiguous the moment that panel is
  // open.
  const lookup = page.getByRole('main').getByRole('region', { name: 'Chord lookup' })
  await expect(lookup).toBeVisible()

  await lookup.getByLabel('Chord root').selectOption({ label: 'Db' })
  await lookup.getByLabel('Chord quality').selectOption({ label: 'Diminished 7th' })
  await expect(lookup.getByTestId('chord-lookup-symbol')).toHaveText('Dbdim7')

  const staff = lookup.getByRole('img', { name: 'Dbdim7 staff notation' })
  await expect(staff).toBeVisible()
  await expect(staff.locator('svg')).toBeVisible({ timeout: 10_000 })

  // FOUR distinct noteheads — Db diminished 7th is a four-note chord, a
  // triad-only engraving would be a silent bug here.
  await expect(staff.locator('.vf-notehead')).toHaveCount(4)
  // Their engraved pitches are exactly Db4 Fb4 Abb4 Cbb5 (midi 61 64 67 70) —
  // Db diminished 7th's own written spelling (two double-flats), never a
  // MIDI-only respelling's nearest-enharmonic guess (which could not even
  // represent Cbb at all).
  expect(await engravedMidiNotes(staff)).toEqual([61, 64, 67, 70])

  expect(errors).toEqual([])
})

test('a diatonic chord row in ChordScaleReference is also engraved on a real staff', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/')

  await nav(page, 'Theory').click()
  // UI-17: Scales & chords is now its own tab, and only the active tab is in
  // the DOM.
  await page.getByRole('tab', { name: 'Scales & chords' }).click()
  // See the lookup test above for why this is scoped to `main`.
  const reference = page.getByRole('main').getByRole('region', { name: 'Chord and scale reference' })
  await expect(reference).toBeVisible()

  // Toggle to seventh chords so the row under test (V7 = G7, the default C
  // major reference's dominant seventh) is a four-note chord too — the same
  // notehead count as the lookup test above, for a matching cross-check, and
  // proof the row's staff reflects the "Show seventh chords" toggle, not a
  // triad computed once and left stale.
  await reference.getByLabel('Show seventh chords').check()
  const row = reference.getByTestId('diatonic-chord-V7')
  await expect(row).toBeVisible()
  await expect(row.locator('.chord-symbol')).toHaveText('G7')

  // UI-17: the staff engraving is behind a per-card "Show notation" <details>
  // — a real browser genuinely hides its content until opened (unlike
  // happy-dom, which the unit tests run under).
  await row.getByText('Show notation').click()

  const staff = row.getByRole('img', { name: 'G7 staff notation' })
  await expect(staff).toBeVisible()
  await expect(staff.locator('svg')).toBeVisible({ timeout: 10_000 })

  await expect(staff.locator('.vf-notehead')).toHaveCount(4)
  // G7 = G4 B4 D5 F5 = midi 67 71 74 77.
  expect(await engravedMidiNotes(staff)).toEqual([67, 71, 74, 77])

  expect(errors).toEqual([])
})
