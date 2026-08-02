import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap 2.20(b) (REQ-3.2.5): importing a Standard MIDI File
 * must ENGRAVE, not merely play. `parseMidiFile` always handled these fine —
 * a real 87-measure, 1258-note 6/8 file parsed with both hands split — but
 * `ImportPanel` handed `musicXml: undefined` to the store and
 * `PracticeScreen` only mounts the score viewer when `musicXml` is defined, so
 * a MIDI import showed no notation at all. It now goes through the
 * `Score` → MusicXML writer, and this asserts the result is a real render.
 *
 * The SMF is built here byte by byte rather than committed as a binary: the
 * fixture is then readable, reviewable and diffable, and its expected content
 * (bar count, pitches, hand split) is stated in code next to the assertions.
 */

const TICKS_PER_QUARTER = 480
/** Right hand: one bar of quarter notes, then a bar of half notes. */
const RIGHT_PITCHES = [60, 62, 64, 65, 67, 69] as const
/** Left hand: two whole notes, one per bar — low enough to split to the bass staff. */
const LEFT_PITCHES = [48, 43] as const

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values)
}

/** SMF variable-length quantity. */
function vlq(value: number): number[] {
  const out = [value & 0x7f]
  let rest = value >> 7
  while (rest > 0) {
    out.unshift((rest & 0x7f) | 0x80)
    rest >>= 7
  }
  return out
}

function chunk(id: string, body: number[]): number[] {
  const length = body.length
  return [
    ...[...id].map((c) => c.charCodeAt(0)),
    (length >> 24) & 0xff,
    (length >> 16) & 0xff,
    (length >> 8) & 0xff,
    length & 0xff,
    ...body,
  ]
}

/** A track of note on/off pairs laid end to end, each `durationTicks` long. */
function noteTrack(pitches: readonly number[], durationTicks: number, channel: number): number[] {
  const events: number[] = []
  for (const pitch of pitches) {
    events.push(...vlq(0), 0x90 | channel, pitch, 0x50)
    events.push(...vlq(durationTicks), 0x80 | channel, pitch, 0x40)
  }
  events.push(...vlq(0), 0xff, 0x2f, 0x00) // end of track
  return events
}

function midiFileBuffer(): Buffer {
  // Format 1, three tracks (conductor + two hands), 480 ticks per quarter —
  // the same resolution the app's core uses, so no rounding is involved.
  const header = chunk('MThd', [0, 1, 0, 3, (TICKS_PER_QUARTER >> 8) & 0xff, TICKS_PER_QUARTER & 0xff])
  const conductor = chunk('MTrk', [
    ...vlq(0), 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // 500000 µs/quarter = 120bpm
    ...vlq(0), 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08, // 4/4
    ...vlq(0), 0xff, 0x2f, 0x00,
  ])
  const right = chunk('MTrk', noteTrack(RIGHT_PITCHES, TICKS_PER_QUARTER, 0))
  const left = chunk('MTrk', noteTrack(LEFT_PITCHES, TICKS_PER_QUARTER * 4, 1))
  return Buffer.from(bytes(...header, ...conductor, ...right, ...left))
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

test('importing a .mid file engraves it, instead of leaving the score view blank (roadmap 2.20)', async ({
  page,
}) => {
  const errors = collectErrors(page)

  await page.goto('/')
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Practice', exact: true })
    .click()

  // The bundled sample is showing before the import; assert on its title so
  // the change of heading below is real evidence the MIDI file was loaded.
  await expect(page.getByRole('heading', { name: 'Twinkle, Twinkle, Little Star' })).toBeVisible()

  await page.getByLabel(/Import a score/i).setInputFiles({
    name: 'two-hands.mid',
    mimeType: 'audio/midi',
    buffer: midiFileBuffer(),
  })

  // A MIDI file carries no title, so the heading falls back to the file name.
  await expect(page.getByRole('heading', { name: 'two-hands.mid' })).toBeVisible()

  // The whole point: real notation. The 50-element discriminator is the one
  // established in e2e/smoke.spec.ts — a degenerate render is 25-35 elements
  // and a load failure produces no <svg> at all, which fails the visibility
  // assertion first.
  const container = page.getByTestId('score-container')
  await expect(container.locator('svg')).toBeVisible()
  expect(await container.locator('svg *').count()).toBeGreaterThan(50)

  // And the "there is no notation for this score" fallback must be gone.
  await expect(page.getByText(/no notation to engrave/i)).toHaveCount(0)

  expect(errors).toEqual([])
})
