import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { zipSync } from 'fflate'

/**
 * E2E proof for roadmap 2.19a (REQ-3.2.5): `.mxl` (compressed MusicXML) import
 * driven end to end through the real file input, proving OSMD actually
 * engraves it — not merely that the score title changes. A title-only
 * assertion would pass even if `loadScore` were wrongly called with
 * `musicXml: undefined` for `.mxl`, which is exactly the bug this spec exists
 * to catch (the score view would then silently stay blank, same as a MIDI
 * import).
 *
 * The `.mxl` archive is built in-memory with `fflate`'s `zipSync`, matching
 * `src/core/notation/mxl.test.ts` and `src/app/score/ImportPanel.test.tsx` —
 * no binary fixture file is committed.
 *
 * See `e2e/smoke.spec.ts` for the error-collection helper and navigation
 * pattern this copies.
 */

const FIXTURE_TITLE = 'MXL E2E Fixture'

const MUSIC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>${FIXTURE_TITLE}</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <barline location="right"><bar-style>light-heavy</bar-style></barline>
    </measure>
  </part>
</score-partwise>`

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container>
  <rootfiles>
    <rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/>
  </rootfiles>
</container>`

/** Build the `.mxl` archive bytes, as `zipSync` would produce them. */
function mxlArchiveBuffer(): Buffer {
  const encoder = new TextEncoder()
  const zipped = zipSync({
    'META-INF/container.xml': encoder.encode(CONTAINER_XML),
    'score.musicxml': encoder.encode(MUSIC_XML),
  })
  return Buffer.from(zipped)
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

test('importing a .mxl file through the real file input renders real notation, not just a title change (roadmap 2.19a)', async ({
  page,
}) => {
  const errors = collectErrors(page)

  await page.goto('/')

  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Practice', exact: true })
    .click()

  await page.getByLabel(/Import a score/i).setInputFiles({
    name: 'fixture.mxl',
    mimeType: 'application/vnd.recordare.musicxml',
    buffer: mxlArchiveBuffer(),
  })

  await expect(page.getByRole('heading', { name: FIXTURE_TITLE })).toBeVisible()

  // The direct proof this is a real engraving, not an inert container: OSMD
  // draws the score as SVG, and a genuine render of 8 notes across two
  // measures (staff lines, clef, noteheads, stems, beams, barlines) produces
  // well over a container-only handful of elements. A wrongly-`undefined`
  // `musicXml` (the exact bug this spec guards against) would leave
  // `ScoreViewer` unmounted entirely, so no `<svg>` would exist at all — that
  // fails the `toBeVisible` assertion below before the count is ever reached.
  const container = page.getByTestId('score-container')
  await expect(container.locator('svg')).toBeVisible()
  const renderedElementCount = await container.locator('svg *').count()
  expect(renderedElementCount).toBeGreaterThan(30)

  expect(errors).toEqual([])
})
