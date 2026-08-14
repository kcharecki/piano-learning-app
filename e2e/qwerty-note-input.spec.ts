import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap 5.5: the computer keyboard is a first-class second
 * input, not just the on-screen mouse/touch keyboard 5.4 shipped. This spec
 * drives Practice and Dictation with Web MIDI removed AND without touching
 * the mouse at all — every note goes in as a real `KeyboardEvent`.
 *
 * The mapping only climbs from its base (`qwertyNoteMap.ts`'s `defaultBaseNote`
 * anchors `KeyA` at the bottom of whatever range is in view), so this test
 * reads the on-screen keyboard's own lowest key out of the DOM rather than
 * hardcoding a note, and derives which physical key plays each pitch from
 * that — it stays correct if the bundled sample or its arrangement changes.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
/** Inverse of `core/theory/pitch.ts`'s `midiToName` default (sharp) spelling — see `OnScreenKeyboard`'s roadmap-5.25 aria-label. e2e specs stay free of `@core` imports by design, so this is a small, deliberate duplicate. */
function midiFromLabel(label: string): number {
  const match = /^([A-G]#?)(-?\d+)$/.exec(label)
  if (match === null) throw new Error(`not a note label: '${label}'`)
  const [, letter, octaveText] = match
  const index = NOTE_NAMES.indexOf(letter ?? '')
  if (index === -1 || octaveText === undefined) throw new Error(`unrecognised note label: '${label}'`)
  return (Number(octaveText) + 1) * 12 + index
}

const OFFSET_BY_CODE: Readonly<Record<string, number>> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
}

function codeForOffset(offset: number): string {
  const entry = Object.entries(OFFSET_BY_CODE).find(([, o]) => o === offset)
  if (entry === undefined) throw new Error(`no QWERTY key at offset ${offset} — outside the mapped span`)
  return entry[0]
}

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

async function removeWebMidi(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Reflect.deleteProperty(Navigator.prototype, 'requestMIDIAccess')
    Reflect.deleteProperty(navigator, 'requestMIDIAccess')
  })
}

/** Types a physical key by dispatching real keydown/keyup on `window`, the way the app's own listener reads it. */
async function typeKey(page: Page, code: string): Promise<void> {
  await page.evaluate((c) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: c, bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keyup', { code: c, bubbles: true }))
  }, code)
}

test('with no Web MIDI and no mouse, typing on the QWERTY row plays and grades notes on Practice (roadmap 5.5)', async ({
  page,
}) => {
  test.setTimeout(45_000)
  const errors = collectErrors(page)

  await removeWebMidi(page)
  await page.goto('/')
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Practice', exact: true })
    .click()
  await expect(page.getByRole('group', { name: 'Transport' })).toBeVisible()

  const keyboard = page.getByRole('group', { name: 'Play the score' })
  await expect(keyboard).toBeVisible()
  // Roadmap UI-10: the QWERTY hint is now inside a closed-by-default
  // `<details>` labelled "Show keys" — open it before asserting its content,
  // the same pattern `docs`/the digest calls out for Flashcards.
  await page.getByText('Show keys').click()
  // The mapping is on screen, not just in a doc a developer reads.
  await expect(page.getByText(/or type it/i)).toBeVisible()

  const firstKeyLabel = await keyboard.getByRole('button').first().getAttribute('aria-label')
  expect(firstKeyLabel).not.toBeNull()
  const low = midiFromLabel(firstKeyLabel ?? '')
  expect(Number.isFinite(low)).toBe(true)

  // The bundled sample's first beat: C4 in the right hand over a C3/E3/G3
  // triad in the left (see e2e/waitmode.spec.ts). The mapping only climbs
  // 0..16 semitones from `low`, and the piece's own range is wider than that
  // window — a real, deliberate limit of a fixed physical keyboard (roadmap
  // 5.5's tick records it) — so this plays whichever of the four notes fall
  // inside the window rather than assuming all of them do.
  const FIRST_BEAT_PITCHES = [48, 52, 55, 60] as const
  const reachable = FIRST_BEAT_PITCHES.filter((pitch) => pitch - low >= 0 && pitch - low <= 16)
  expect(reachable.length).toBeGreaterThan(0)

  // UI-09 (2026-08-12 UI audit): the feedback strip is absent entirely until
  // a run has started — never a fake 0/accuracy before Play, so the "0
  // correct" baseline is now asserted right after Play, not before it.
  const transport = page.getByRole('group', { name: 'Transport' })
  await transport.getByRole('button', { name: 'Play', exact: true }).click()

  const correct = page.getByTestId('feedback-correct')
  const accuracy = page.getByTestId('feedback-accuracy')
  await expect(correct).toHaveText('0')

  for (const pitch of reachable) await typeKey(page, codeForOffset(pitch - low))

  // Graded by `core/practice/matcher.ts`, through the same seam a MIDI
  // keyboard or a click feeds — no path here involves the mouse at all.
  await expect(async () => {
    expect(Number(await correct.textContent())).toBeGreaterThan(0)
  }).toPass({ timeout: 10_000 })
  await expect(accuracy).not.toHaveText('0%')

  await transport.getByRole('button', { name: 'Stop', exact: true }).click()
  expect(errors).toEqual([])
})

test('with no Web MIDI and no mouse, typing on the QWERTY row records notes on Dictation (roadmap 5.5)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)

  await removeWebMidi(page)
  await page.goto('/')
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Ear training', exact: true })
    .click()
  await page.getByLabel('Drill', { exact: true }).selectOption('melodic-dictation')

  // The answer pad only renders once an item is loaded. Roadmap UI-13: the
  // "Playback" role="group" wrapper is gone (the stage is the grouping now)
  // and the button reads "Play item".
  await page.getByRole('button', { name: 'Play item', exact: true }).click()

  const keyboard = page.getByRole('group', { name: 'On-screen keyboard' })
  await expect(keyboard).toBeVisible()
  await expect(page.getByText(/or type it/i)).toBeVisible()

  await expect(page.getByTestId('dictation-note-count')).toHaveText('0 notes recorded')

  await typeKey(page, 'KeyA')
  await expect(page.getByTestId('dictation-note-count')).toHaveText('1 note recorded')

  await typeKey(page, 'KeyS')
  await expect(page.getByTestId('dictation-note-count')).toHaveText('2 notes recorded')

  expect(errors).toEqual([])
})
