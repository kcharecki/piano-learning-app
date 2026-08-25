import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { installFakeMidi, FAKE_MIDI_DEVICE_NAME } from './fake-midi.ts'
import { seedPlayingLevel } from './seedLevel.ts'
import { openPracticeSetup } from './practice-setup.ts'

/**
 * E2E proof for roadmap 2.26 (REQ-3.4.5): the read-ahead drill, driven end to
 * end. Unit tests (`useReadAhead.test.ts`, `osmdEngraver.test.ts`) prove the
 * occlusion decision logic and the hidden/colour precedence rule in
 * isolation, but neither proves the two are actually wired together into a
 * real rendered score — this drives the six-bar fixture (see
 * `e2e/note-colour.spec.ts`, which this file's harness mirrors) and asserts
 * on real notehead `fill` colours in the real SVG as playback advances.
 *
 * The fixture is six measures of four quarter notes each (see
 * e2e/fixtures/assessment-six-bars.musicxml) — 24 notes total, 4 per measure.
 *
 * ## Why this counts `hiddenNotes`, never "ink" notes
 *
 * A prior version of this spec also counted notes painted the default ink
 * colour and asserted an exact total (24). That is unsound: `[fill="..."]`
 * matches EVERY svg element sharing that fill, not just noteheads — measured
 * 39 elements for the "ink" colour on this fixture (barline/stem rects,
 * clef/time-sig paths, text labels all share it), and revealed notes are not
 * even guaranteed to end up ink-coloured — a note the feedback matcher has
 * already judged `missed` during playback is repainted amber, not ink, when
 * read-ahead reveals it (`setNoteHidden` only ever wins or defers to whatever
 * `setNoteColor` last requested, see `osmdEngraver.ts`). `hiddenNotes` — every
 * element painted exactly `HIDDEN_NOTE_COLOR` — has neither problem: nothing
 * else in this app's palette uses that colour, so its count is an exact,
 * mechanism-agnostic proxy for "how many notes are currently occluded."
 *
 * ## Why assertions never follow Stop
 *
 * `Transport.stop()` rewinds the playhead to loop-start/tick-0, which pulls
 * `currentMeasureIndex` back to 0 and reveals everything again — a prior
 * version of this spec asserted progressive hiding AFTER clicking Stop, which
 * measured wrong (hidden count after Stop reflects the REWOUND position, not
 * the mid-playback one the assertion's comment claimed). Every progression
 * assertion below runs strictly WHILE the transport is still playing.
 *
 * ## Why position and hidden-count are read together, in one `page.evaluate`
 *
 * `useReadAhead` hides strictly BEFORE the cursor's own measure (roadmap
 * scope change A) — measures `0 .. currentMeasureIndex - 1` — so the exact
 * hidden count at any instant is `(measureNumber - 1) * NOTES_PER_MEASURE`.
 * Reading the position label and the hidden-notes count via two separate
 * Playwright locator calls would race real wall-clock playback between the
 * two round-trips, since the transport keeps advancing between them; reading
 * both inside a single `page.evaluate` captures one atomic snapshot, so the
 * formula can be asserted exactly instead of with loose inequalities.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'assessment-six-bars.musicxml')
const FIXTURE_TITLE = 'Assessment Six-Bar Fixture'
const NOTES_PER_MEASURE = 4
const TOTAL_NOTES = 24 // 6 measures x 4 quarter notes each — see the fixture's own comment.

/**
 * Reads `HIDDEN_NOTE_COLOR` straight out of `osmdSvg.ts`'s source text, the
 * same way `note-colour.spec.ts` reads `WRONG_PITCH_COLOR` out of
 * `useNoteFeedback.ts` — a plain text scrape rather than an import, since that
 * module's neighbours pull in `opensheetmusicdisplay`, which has no reason to
 * load under Node here.
 */
function readColorConstantFromSource(constantName: string): string {
  const sourcePath = path.join(__dirname, '..', 'src', 'app', 'score', 'osmdSvg.ts')
  const source = readFileSync(sourcePath, 'utf8')
  const pattern = new RegExp(`(?:const|export const) ${constantName} = '(#[0-9a-fA-F]{3,8})'`)
  const match = pattern.exec(source)
  if (match?.[1] === undefined) {
    throw new Error(`could not find ${constantName} in osmdSvg.ts's source`)
  }
  return match[1]
}

/** Console/page errors, collected from the moment the page is created (see e2e/smoke.spec.ts). */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

/**
 * UI-09 (2026-08-12 UI audit): file import moved behind a "Change piece…"
 * button that opens a modal `<dialog>` — closes it again once the new
 * score's title is confirmed, so the rest of the screen is interactable.
 */
async function importScore(page: Page, fixturePath: string, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Change piece…' }).click()
  await page.getByLabel(/Import a score/i).setInputFiles(fixturePath)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await page.getByRole('dialog', { name: 'Change piece' }).getByRole('button', { name: 'Close' }).click()
}

/**
 * UI-04b: the MIDI status line moved into the shell topbar's input-status
 * chip popover — open it, check the text, then Escape closes it again.
 */
async function expectMidiStatusText(page: Page, pattern: RegExp): Promise<void> {
  const chip = page.getByRole('button', { name: /MIDI connected|No MIDI/ })
  await chip.click()
  await expect(page.getByText(pattern)).toBeVisible()
  await page.keyboard.press('Escape')
}

type Snapshot = { readonly measure: number; readonly hidden: number }

/** One atomic in-page read of the position readout and the hidden-notes count — see the module comment on why these must not be read separately. */
async function readSnapshot(page: Page, hiddenColor: string): Promise<Snapshot> {
  return page.evaluate((color) => {
    const svg = document.querySelector('[data-testid="score-container"] svg')
    const hidden = svg === null ? 0 : svg.querySelectorAll(`[fill="${color}"]`).length
    const posText = document.querySelector('[aria-label="Position"]')?.textContent ?? ''
    const match = /Measure (\d+)/.exec(posText)
    return { measure: match?.[1] === undefined ? 0 : Number(match[1]), hidden }
  }, hiddenColor)
}

/** Polls (via the same atomic snapshot) until the position reaches `minMeasure`, returning the snapshot that satisfied it. */
async function waitForMeasureAtLeast(
  page: Page,
  hiddenColor: string,
  minMeasure: number,
): Promise<Snapshot> {
  let last: Snapshot | undefined
  await expect(async () => {
    const snapshot = await readSnapshot(page, hiddenColor)
    last = snapshot
    expect(snapshot.measure).toBeGreaterThanOrEqual(minMeasure)
  }).toPass({ timeout: 10_000 })
  if (last === undefined) throw new Error('unreachable — toPass only resolves after a read')
  return last
}

test('read-ahead progressively hides notation strictly behind the cursor, leaving its own measure and everything ahead visible (roadmap 2.26)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)
  const hiddenColor = readColorConstantFromSource('HIDDEN_NOTE_COLOR')

  // Must be installed before the first navigation — the app requests MIDI
  // access on mount.
  await installFakeMidi(page)
  await page.goto('/')
  // Roadmap 5.17 gates Read ahead behind "More tools", itself behind the
  // `playing` track's level — a fresh app starts every track at level 1.
  await seedPlayingLevel(page, 3)
  await page.reload()

  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Practice', exact: true })
    .click()

  await importScore(page, FIXTURE_PATH, FIXTURE_TITLE)

  await expectMidiStatusText(page, new RegExp(`MIDI keyboard connected: ${FAKE_MIDI_DEVICE_NAME}`))

  // Settle point: only the newly-imported 6-bar fixture clamps "to measure"
  // to 6 (see note-colour.spec.ts for why this is the reliable proof the
  // async ScoreViewer load for the NEW score has actually finished).
  await openPracticeSetup(page)
  const loopRangeSettle = page.getByRole('group', { name: 'Loop range' })
  await expect(loopRangeSettle.getByLabel('to measure')).toHaveValue('6')
  await page.waitForTimeout(300)

  const scoreSvg = page.locator('[data-testid="score-container"] svg')
  await expect(scoreSvg).toBeVisible()
  const hiddenNotes = scoreSvg.locator(`[fill="${hiddenColor}"]`)

  // Before the drill is on, nothing is occluded.
  await expect(hiddenNotes).toHaveCount(0)

  // Read ahead lives behind the collapsed "More tools" disclosure (roadmap
  // 5.17) — open it before reaching for the checkbox inside.
  await page.getByText('More tools').click()
  const readAhead = page.getByRole('group', { name: 'Read ahead' })
  await readAhead.getByRole('checkbox').check()

  // The cursor rests at measure 1 (index 0) before playback starts, and the
  // scope change in useReadAhead.ts hides only measures STRICTLY BEFORE the
  // cursor's own — there is no measure before the first one, so nothing is
  // hidden yet.
  await expect(hiddenNotes).toHaveCount(0)

  const transport = page.getByRole('group', { name: 'Transport' })
  await transport.getByRole('button', { name: 'Play', exact: true }).click()

  // 120bpm/4-4 makes a measure 2000ms, so measure 4 is reached comfortably
  // inside the poll window.
  const midPlay = await waitForMeasureAtLeast(page, hiddenColor, 4)

  // Assert WHILE STILL PLAYING — clicking Stop first would rewind the
  // playhead to tick 0, dragging currentMeasureIndex back to 0 and revealing
  // everything before this assertion ever ran (the bug in the prior version
  // of this spec). The hidden count is EXACTLY (measure - 1) measures' worth
  // — the scope-change formula, not a loose bound.
  expect(midPlay.hidden).toBe((midPlay.measure - 1) * NOTES_PER_MEASURE)
  expect(midPlay.hidden).toBeGreaterThanOrEqual(3 * NOTES_PER_MEASURE)
  expect(midPlay.hidden).toBeLessThan(TOTAL_NOTES)

  // Progressive growth: still playing, wait for the position to advance past
  // where it was above and confirm the hidden count grew with it, still
  // following the same exact formula — proof this tracks the cursor rather
  // than freezing at some fixed value.
  const later = await waitForMeasureAtLeast(page, hiddenColor, midPlay.measure + 1)
  expect(later.hidden).toBe((later.measure - 1) * NOTES_PER_MEASURE)
  expect(later.hidden).toBeGreaterThan(midPlay.hidden)
  expect(later.hidden).toBeLessThan(TOTAL_NOTES)

  // Toggling off reveals everything immediately — still without stopping.
  // This is the one assertion from the original spec that was already sound:
  // "0 hidden" does not depend on what colour a revealed note ends up as.
  await readAhead.getByRole('checkbox').uncheck()
  await expect(hiddenNotes).toHaveCount(0)

  await page.getByRole('button', { name: 'Stop', exact: true }).click()

  expect(errors).toEqual([])
})
