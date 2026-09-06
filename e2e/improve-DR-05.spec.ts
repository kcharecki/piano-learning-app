import { expect, test, type Page } from '@playwright/test'
import { playGrooveHits, worstDriverDriftMs, type DrumPadKey, type TimedHit } from './drum-pads.ts'

/**
 * `/improve-app` run 2026-09-06-1 — the claim spec for roadmap DR-05, the drum
 * notation renderer. Committed RED, before the implementation.
 *
 * The gap (source 1d, class VOID): the Groove trainer never shows the learner
 * what to play. Its entire statement of the task is the groove's title and
 * four pad labels — there is no notation, no grid, no count, not even a
 * sentence. Verified by driving it (`runs/2026-09-06-1/drive.md`, D7/D8): two
 * standard readings of the app's own title `Money Beat (Open Hat)` exist, the
 * app grades one of them and states neither, and the reading it does not want
 * scores `Open hi-hat — 0 of 2, 2 missed, 2 extra`. The result screen does not
 * disclose the right answer either, so the learner is told they are wrong and
 * given no way to find out what was right.
 *
 * The claim this spec asserts:
 *
 * > After this ships, a learner who is on the Groove trainer and does not
 * > already know the selected groove will be able to read the pattern off the
 * > screen before they play it — which limb plays on which eighth, and where
 * > the hi-hat opens — and we will know because the trainer renders a
 * > percussion staff for the selected groove, and a first attempt played from
 * > nothing but that staff scores every pad n of n.
 *
 * ## Why the spec reads the picture and then plays it
 *
 * Asserting that a staff is on screen would prove a picture renders, not that
 * it is the right picture — and a wrong picture is worse than none, because
 * the app would then be showing one pattern while marking another. That
 * failure has happened in this repo: run 2026-08-20-1 shipped schema-correct
 * MusicXML that engraved wrongly.
 *
 * So every hit below is derived from the rendered noteheads and nothing else.
 * The spec reads each notehead's `data-note-id` out of the DOM — the model's
 * own `GrooveNote.id`, already `measureIndex.pad.tick` — converts it to
 * milliseconds at the tempo the screen itself reports, plays exactly that
 * through the real pads, and demands every pad come back `n of n`.
 * `referenceGrooves.ts`, `planGrooveRun` and the grader are never consulted.
 * A staff that disagrees with the grader fails here, on every groove the
 * picker offers.
 */

/** 4/4 for all three picker grooves; `TICKS_PER_QUARTER` is 480 in core. */
const TICKS_PER_QUARTER = 480
const BEATS_PER_BAR = 4
const GRADED_BARS = 2

/** The three grooves the picker offers. */
const PICKER_GROOVES = ['Quarter-Note Rock', 'Money Beat', 'Money Beat (Open Hat)'] as const

/** Model pad -> the pad this drive can hit. Anything else fails the spec loudly. */
const PAD_OF_MODEL: Readonly<Record<string, DrumPadKey>> = {
  hhClosed: 'hihat',
  hhOpen: 'openhat',
  snare: 'snare',
  kick: 'kick',
}

const MAX_DRIVER_DRIFT_MS = 25

interface StaffNote {
  readonly pad: string
  readonly tick: number
}

function mainNav(page: Page) {
  return page.getByRole('navigation', { name: 'Main' })
}

async function openGrooveTrainer(page: Page): Promise<void> {
  await page.goto('/drums/today')
  await mainNav(page).getByRole('button', { name: 'Groove', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Groove trainer' })).toBeVisible()
}

/** Cycle the picker to `title` the way a learner does, or fail saying so. */
async function selectGroove(page: Page, title: string): Promise<void> {
  for (let i = 0; i < PICKER_GROOVES.length + 1; i += 1) {
    if ((await page.locator('main').innerText()).includes(title)) return
    await page.getByRole('button', { name: 'Next groove' }).click()
    await expect(page.getByRole('button', { name: 'Next groove' })).toBeEnabled()
  }
  throw new Error(`the picker never offered "${title}"`)
}

/**
 * Every notehead the staff rendered, as `{pad, tick}`, read out of
 * `data-note-id` and nothing else.
 */
async function readStaff(page: Page): Promise<StaffNote[]> {
  const staff = page.locator('[data-groove-staff]')
  await expect(staff).toBeVisible()
  const ids = await staff
    .locator('[data-note-id]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-note-id') ?? ''))
  return ids.map((id) => {
    const parts = id.split('.')
    const pad = parts[1]
    const tick = Number(parts[2])
    if (parts.length !== 3 || pad === undefined || !Number.isInteger(tick)) {
      throw new Error(`notehead id "${id}" is not measureIndex.pad.tick`)
    }
    return { pad, tick }
  })
}

/** Turn the picture into hits: the graded run loops the written bar. */
function hitsFromStaff(notes: readonly StaffNote[], bpm: number): TimedHit[] {
  const msPerTick = 60_000 / bpm / TICKS_PER_QUARTER
  const barMs = BEATS_PER_BAR * (60_000 / bpm)
  return Array.from({ length: GRADED_BARS }).flatMap((_, bar) =>
    notes.map((note) => {
      const pad = PAD_OF_MODEL[note.pad]
      if (pad === undefined) {
        throw new Error(`the staff rendered pad "${note.pad}", which has no pad on this screen`)
      }
      return { pad, ms: bar * barMs + note.tick * msPerTick }
    }),
  )
}

async function tempo(page: Page): Promise<number> {
  const value = await page.getByRole('spinbutton', { name: /tempo/i }).inputValue()
  const bpm = Number(value)
  expect(Number.isFinite(bpm) && bpm > 0).toBe(true)
  return bpm
}

test('the staff states the selected groove, and changes when the groove does (roadmap DR-05)', async ({
  page,
}) => {
  await openGrooveTrainer(page)

  const seen = new Map<string, string>()
  for (const title of PICKER_GROOVES) {
    await selectGroove(page, title)
    const notes = await readStaff(page)
    expect(notes.length, `${title} rendered no noteheads`).toBeGreaterThan(0)

    // The figure is a picture of THIS groove, not a stock illustration.
    const fingerprint = notes
      .map((n) => `${n.pad}@${n.tick}`)
      .sort()
      .join(',')
    for (const [other, otherPrint] of seen) {
      expect(fingerprint, `"${title}" renders the same noteheads as "${other}"`).not.toBe(otherPrint)
    }
    seen.set(title, fingerprint)

    // The sentence design C would have shipped, kept for a screen reader.
    const label = await page.locator('[data-groove-staff]').getAttribute('aria-label')
    expect(label ?? '', `the staff for "${title}" has no aria-label`).toMatch(/hi-hat|snare|kick/i)
  }

  // The one placement the drive proved the app never states: the open hat,
  // distinct from the closed ones it sits among.
  await selectGroove(page, 'Money Beat (Open Hat)')
  const openHat = await readStaff(page)
  expect(openHat.filter((n) => n.pad === 'hhOpen')).toHaveLength(1)
  expect(openHat.filter((n) => n.pad === 'hhClosed').length).toBeGreaterThan(1)
})

for (const title of PICKER_GROOVES) {
  test(`refutation condition: what the staff shows for "${title}" is what the grader wants (roadmap DR-05)`, async ({
    page,
  }) => {
    await openGrooveTrainer(page)
    await selectGroove(page, title)

    const notes = await readStaff(page)
    const bpm = await tempo(page)
    const hits = hitsFromStaff(notes, bpm)
    expect(hits).toHaveLength(notes.length * GRADED_BARS)

    const dispatched = await playGrooveHits(page, hits)
    expect(worstDriverDriftMs(dispatched)).toBeLessThan(MAX_DRIVER_DRIFT_MS)

    const result = page.getByRole('region', { name: 'Result' })
    await expect(result).toBeVisible({ timeout: 15_000 })
    const lines = (await result.innerText())
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /\d+ of \d+/.test(line))
    expect(lines.length, 'the result named no pads').toBeGreaterThan(0)

    for (const line of lines) {
      // Played straight off the picture: every written note matched, nothing
      // missed, nothing extra. A staff showing a different pattern than the
      // grader wants cannot pass this.
      const matched = /(\d+) of (\d+)/.exec(line)
      expect(matched, line).not.toBeNull()
      expect(matched?.[1], `${title}: ${line}`).toBe(matched?.[2])
      expect(line, `${title}: the staff and the grader disagree`).not.toMatch(/missed|extra/)
    }
  })
}
