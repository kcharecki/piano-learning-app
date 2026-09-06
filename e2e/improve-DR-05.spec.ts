import { expect, test, type Page } from '@playwright/test'
import { playGrooveHits, worstDriverDriftMs, type DrumPadKey, type TimedHit } from './drum-pads.ts'

/**
 * `/improve-app` run 2026-09-06-1 — the refutation condition for roadmap
 * DR-05, the drum notation renderer.
 *
 * The gap (source 1d, class VOID): the Groove trainer never showed the learner
 * what to play. Its entire statement of the task was the groove's title and
 * four pad labels — no notation, no grid, no count, not even a sentence.
 * Verified by driving it (`runs/2026-09-06-1/drive.md`, D7/D8): two standard
 * readings of the app's own title `Money Beat (Open Hat)` exist, the app grades
 * one of them and states neither, and the reading it does not want scores
 * `Open hi-hat — 0 of 2, 2 missed, 2 extra`.
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
 * ## Why this spec reads the PICTURE, not the picture's data attributes
 *
 * It used to read `data-note-id`, which is the model's own
 * `measureIndex.pad.tick` string re-emitted as an attribute. Both sides of the
 * comparison therefore came out of the same `GrooveScore`, so the condition was
 * void: with `relYOf` in `src/core/drums/engrave/staff.ts` stubbed to
 * `return 1.5`, every notehead in every groove drew on one line — kick, snare
 * and hi-hat indistinguishable — and the spec still reported 4 passed, exit 0.
 * A figure that cannot be read is exactly the failure this slice exists to
 * prevent, so the condition guarding it may not consult the model at all.
 *
 * This one reads the drawing the way a drummer reads a chart, and nothing else:
 *
 *   - the five staff lines give the top line's `y` and the staff space, so
 *     every other measurement below is in staff spaces off the drawn staff;
 *   - a notehead's pad is (vertical position, glyph shape) — an `x` half a
 *     space above the top line is the hi-hat, a filled head in the third space
 *     is the snare, a filled head in the bottom space is the kick, and a small
 *     unfilled ring stacked above an `x` opens that hat;
 *   - a notehead's instant comes from the count row's own "1 2 3 4";
 *   - how much music there is comes from the drawn repeat: "×N" over the final
 *     barline, and how many times the count row restarts at 1.
 *
 * No `data-note-id`, no `data-pad`, no `referenceGrooves.ts`, no
 * `planGrooveRun`, no grader. Everything this drive plays was legible on screen.
 */

/** The three grooves the picker offers. */
const PICKER_GROOVES = ['Quarter-Note Rock', 'Money Beat', 'Money Beat (Open Hat)'] as const

const MAX_DRIVER_DRIFT_MS = 25

/**
 * How close a notehead's centre must sit to a pad's line or space. The
 * notation's smallest vertical distance is half a staff space, so anything
 * under 0.25 cannot confuse two pads; 0.2 leaves the stroke widths room.
 */
const POSITION_TOLERANCE = 0.2

type Glyph = {
  readonly cx: number
  readonly cy: number
  readonly shape: 'normal' | 'x'
  readonly open: boolean
}

type BeatLabel = { readonly x: number; readonly n: number }

type Picture = {
  readonly glyphs: readonly Glyph[]
  readonly beats: readonly BeatLabel[]
  readonly playCount: number
}

function mainNav(page: Page) {
  return page.getByRole('navigation', { name: 'Main' })
}

async function openGrooveTrainer(page: Page): Promise<void> {
  await page.goto('/drums/today')
  await mainNav(page).getByRole('button', { name: 'Groove', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Groove trainer' })).toBeVisible()
}

/**
 * Cycle the picker to `title` the way a learner does. The comparison is exact:
 * "Money Beat" is a prefix of "Money Beat (Open Hat)", and a substring match
 * would silently drive the wrong groove and then assert against it.
 */
async function selectGroove(page: Page, title: string): Promise<void> {
  for (let i = 0; i < PICKER_GROOVES.length + 1; i += 1) {
    if ((await page.locator('.groove-title').innerText()).trim() === title) return
    await page.getByRole('button', { name: 'Next groove' }).click()
  }
  throw new Error(`the picker never offered "${title}"`)
}

/** Everything drawn on the staff, measured in staff spaces off the drawn staff lines. */
async function readPicture(page: Page): Promise<Picture> {
  const staff = page.locator('[data-groove-staff]')
  await expect(staff).toBeVisible()
  return staff.evaluate((svg) => {
    const num = (el: Element, name: string): number => Number(el.getAttribute(name))
    const lines = [...svg.querySelectorAll('line')]

    // The five widest horizontals are the staff: barlines are vertical and the
    // beams are rects, so nothing else competes for the top five.
    const horizontals = lines
      .filter((l) => num(l, 'y1') === num(l, 'y2'))
      .map((l) => ({ y: num(l, 'y1'), w: Math.abs(num(l, 'x2') - num(l, 'x1')) }))
      .sort((a, b) => b.w - a.w)
      .slice(0, 5)
      .sort((a, b) => a.y - b.y)
    if (horizontals.length !== 5) throw new Error('the figure does not draw five staff lines')
    const topY = horizontals[0].y
    const bottomY = horizontals[4].y
    const space = (bottomY - topY) / 4
    if (!(space > 0)) throw new Error('the staff lines are not spaced')

    const rel = (y: number): number => (y - topY) / space
    const relX = (x: number): number => x / space

    const glyphs: Array<{ cx: number; cy: number; shape: 'normal' | 'x'; open: boolean }> = []
    for (const e of svg.querySelectorAll('ellipse')) {
      glyphs.push({ cx: relX(num(e, 'cx')), cy: rel(num(e, 'cy')), shape: 'normal', open: false })
    }

    // A cross notehead is two diagonals through one centre. An accent is a
    // polyline and a ghost parenthesis is a path, so neither lands here.
    const diagonals = lines.filter(
      (l) => num(l, 'x1') !== num(l, 'x2') && num(l, 'y1') !== num(l, 'y2'),
    )
    const byCentre = new Map<string, { cx: number; cy: number; n: number }>()
    for (const l of diagonals) {
      const cx = (num(l, 'x1') + num(l, 'x2')) / 2
      const cy = (num(l, 'y1') + num(l, 'y2')) / 2
      const key = `${cx.toFixed(3)}:${cy.toFixed(3)}`
      const cur = byCentre.get(key) ?? { cx, cy, n: 0 }
      cur.n += 1
      byCentre.set(key, cur)
    }

    const rings = [...svg.querySelectorAll('circle')].map((c) => ({
      cx: num(c, 'cx'),
      cy: num(c, 'cy'),
    }))
    for (const c of byCentre.values()) {
      if (c.n < 2) continue
      // The open sign is a ring stacked ABOVE the note, clear of its stem and
      // beam — a ring ON the stem is the half-open hi-hat, a different
      // articulation. Ten spaces is past the tallest stack the layout reserves,
      // and a fifth of a space horizontally is far tighter than one grid slot,
      // so no ring can be attributed to a neighbouring notehead.
      const open = rings.some(
        (o) => Math.abs(o.cx - c.cx) < space * 0.2 && o.cy < c.cy && c.cy - o.cy < space * 10,
      )
      glyphs.push({ cx: relX(c.cx), cy: rel(c.cy), shape: 'x', open })
    }

    // The count row sits below the staff and the time signature's own digits
    // sit on it, so height is what tells those two apart.
    const beats: Array<{ x: number; n: number }> = []
    let playCount = 1
    for (const t of svg.querySelectorAll('text')) {
      const label = (t.textContent ?? '').trim()
      const repeat = /^[×x]\s*(\d+)$/.exec(label)
      if (repeat !== null) {
        playCount = Number(repeat[1])
        continue
      }
      if (num(t, 'y') <= bottomY) continue
      if (/^[1-9]$/.test(label)) beats.push({ x: relX(num(t, 'x')), n: Number(label) })
    }
    beats.sort((a, b) => a.x - b.x)
    return { glyphs, beats, playCount }
  })
}

/** Which pad a drummer reads off that position and glyph. Anything else fails loudly. */
function padOf(glyph: Glyph): DrumPadKey {
  const near = (value: number): boolean => Math.abs(glyph.cy - value) < POSITION_TOLERANCE
  if (glyph.shape === 'x' && near(-0.5)) return glyph.open ? 'openhat' : 'hihat'
  if (glyph.shape === 'normal' && near(1.5)) return 'snare'
  if (glyph.shape === 'normal' && near(3.5)) return 'kick'
  throw new Error(
    `a ${glyph.shape} notehead ${glyph.cy.toFixed(2)} spaces below the top staff line is not a pad this kit has`,
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
    const { glyphs } = await readPicture(page)
    expect(glyphs.length, `${title} drew no noteheads`).toBeGreaterThan(0)

    // The figure is a picture of THIS groove, not a stock illustration.
    const fingerprint = glyphs
      .map((g) => `${padOf(g)}@${g.cx.toFixed(2)}`)
      .sort()
      .join(',')
    for (const [other, otherPrint] of seen) {
      expect(fingerprint, `"${title}" draws the same noteheads as "${other}"`).not.toBe(otherPrint)
    }
    seen.set(title, fingerprint)

    // The sentence design C would have shipped, kept for a screen reader.
    const label = await page.locator('[data-groove-staff]').getAttribute('aria-label')
    expect(label ?? '', `the staff for "${title}" has no aria-label`).toMatch(/hi-hat|snare|kick/i)
  }

  // The one placement the drive proved the app never states: the open hat,
  // distinct from the closed ones it sits among, and legible as such from the
  // drawing alone.
  await selectGroove(page, 'Money Beat (Open Hat)')
  const openHat = await readPicture(page)
  const pads = openHat.glyphs.map(padOf)
  expect(pads.filter((p) => p === 'openhat')).toHaveLength(1)
  expect(pads.filter((p) => p === 'hihat').length).toBeGreaterThan(1)
})

for (const title of PICKER_GROOVES) {
  test(`refutation condition: what the staff draws for "${title}" is what the grader wants (roadmap DR-05)`, async ({
    page,
  }) => {
    await openGrooveTrainer(page)
    await selectGroove(page, title)

    const { glyphs, beats, playCount } = await readPicture(page)
    expect(glyphs.length, `${title} drew no noteheads`).toBeGreaterThan(0)
    expect(beats.length, `${title} drew no count row to read time from`).toBeGreaterThanOrEqual(2)

    const first = beats[0]
    const second = beats[1]
    expect(first?.n, 'the count row does not start at beat 1').toBe(1)
    const beatOneX = first?.x ?? 0
    const beatSpacing = (second?.x ?? 0) - beatOneX
    expect(beatSpacing).toBeGreaterThan(0)

    // Read off the count row rather than assumed: how many beats are in a bar,
    // and how many bars the figure writes out before the repeat.
    const beatsPerBar = Math.max(...beats.map((b) => b.n))
    const measuresDrawn = beats.filter((b) => b.n === 1).length
    expect(measuresDrawn).toBeGreaterThan(0)

    // The figure and the marking must agree on how much music there is. Before
    // the repeat was drawn, the staff stated one bar while the trainer graded
    // two, so a learner who played exactly what was drawn was told they had
    // missed half of it.
    const subtitle = await page.locator('.page-header-subtitle').innerText()
    const gradedBars = Number(/(\d+)\s+bars graded/.exec(subtitle)?.[1] ?? '0')
    expect(
      gradedBars,
      `the screen never says how many bars are graded: "${subtitle}"`,
    ).toBeGreaterThan(0)
    expect(
      measuresDrawn * playCount,
      `${title}: the staff draws ${measuresDrawn} bar(s) played ${playCount} time(s), but ${gradedBars} bars are graded`,
    ).toBe(gradedBars)

    const beatMs = 60_000 / (await tempo(page))
    const hits: TimedHit[] = Array.from({ length: playCount }).flatMap((_, pass) =>
      glyphs.map((glyph) => ({
        pad: padOf(glyph),
        ms: (pass * measuresDrawn * beatsPerBar + (glyph.cx - beatOneX) / beatSpacing) * beatMs,
      })),
    )

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
      // Played straight off the picture: every drawn note matched, nothing
      // missed, nothing extra. A staff drawing a different pattern than the
      // grader wants cannot pass this.
      const matched = /(\d+) of (\d+)/.exec(line)
      expect(matched, line).not.toBeNull()
      expect(matched?.[1], `${title}: ${line}`).toBe(matched?.[2])
      expect(line, `${title}: the drawn staff and the grader disagree`).not.toMatch(/missed|extra/)
    }
  })
}
