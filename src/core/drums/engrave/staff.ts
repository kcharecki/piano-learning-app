/**
 * `engraveGroove` — turns a `GrooveScore` into `StaffLayout`'s staff-space
 * geometry (roadmap DR-05). This is the one function the renderer
 * (`@app/drums/notation/GrooveStaff.tsx`) calls; every decision below is an
 * arithmetic transcription of a spec, not a fresh design — see `./layout.ts`'s
 * header for the coordinate system this produces (staff spaces, y grows
 * downward, everything non-negative).
 *
 * ## Why one function, not a pipeline of exported passes
 *
 * Vertical placement, horizontal placement, stems and beaming are NOT
 * independent: beaming rewrites the very `stemToY` the stem pass computed (a
 * beam is what a group of stems merges into once they are gathered under one
 * beat), so stems have to be finished before beaming can run, and beam
 * membership has to be finished before a note's FINAL `stemToY` is known. A
 * caller who only wanted beams, or only wanted stems, could not get a correct
 * answer without running the other pass anyway — so the passes below are
 * private helpers, not their own exports, and `engraveGroove` is the only
 * thing that has to be right.
 *
 * ## Beat-grouped beaming crosses instruments on purpose
 *
 * The beam grouping key is `(voice, measureIndex, beat)` — never the pad. A
 * ghost-note snare hit landing on the same 16th as a hi-hat is in the SAME
 * beam as that hi-hat (they already share a stem, by the one-stem-per-voice-
 * and-tick rule); the beam just continues that shared subdivision across the
 * rest of the beat. This matches real drum-chart practice (one continuous
 * 16th-note beam per beat, independent of which drum plays which pulse) and
 * falls out of `Voice` meaning "hands vs feet", not "which pad" — the type
 * this module imports from `./pad.ts` already erases pad identity down to
 * that. A test that expected a beam to contain ONLY hi-hat notes would be
 * checking a property this module never promises; `staff.test.ts`'s
 * ghost-funk case instead checks that each beat's hands-beam contains exactly
 * the four hi-hat notes for that beat, alongside whatever else shares its
 * stems.
 *
 * ## Count-row grid selection (a spec ambiguity, resolved against the tests)
 *
 * The brief this shipped against said the sixteenth-grid cutoff was `shortest
 * < TICKS_PER_QUARTER / 4`. Taken literally that excludes a score whose
 * shortest note IS exactly a sixteenth (120 is not < 120) — which would give
 * `ghostFunkBar` (every note 120 ticks) an EIGHTH-note count row, directly
 * contradicting the fixture test the same brief asks for ("sixteenth count
 * row"). Implemented as `< TICKS_PER_QUARTER / 2` instead, so a score whose
 * shortest note is a sixteenth gets the sixteenth grid — the only reading
 * under which "pick the grid from the shortest note" is self-consistent. An
 * empty score (nothing to measure) falls back to the coarsest grid, quarters,
 * rather than guessing a resolution nothing in the score asks for.
 */
import { at, invariant } from '@core/shared/invariant.ts'
import { measureDurationTicks } from '@core/notation/score.ts'
import { TICKS_PER_QUARTER } from '@core/shared/units.ts'
import type { DynamicsClass, GrooveNote, GrooveScore } from '@core/drums/model/groove.ts'
import { staffPositionOf, type MappedDrumPad, type Notehead, type StaffStep, type Voice } from '@core/drums/model/pad.ts'
import {
  COUNT_ROW_DESCENT,
  COUNT_ROW_GAP,
  EDGE_PAD,
  LEFT_MARGIN,
  MARK_RESERVE,
  MIN_STAFF_TOP_Y,
  RIGHT_MARGIN,
  SLOT_WIDTH,
  STEM_LENGTH,
  type EngravedBeam,
  type EngravedCount,
  type EngravedLine,
  type EngravedNote,
  type NoteMark,
  type StaffLayout,
} from './layout.ts'

// ------------------------------------------------------------------- vertical

const STEP_INDEX: Readonly<Record<StaffStep, number>> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }
/** F5 — the top staff line, read as treble clef. The geometry's zero point. */
const TOP_LINE_DIATONIC = 5 * 7 + STEP_INDEX.F

function diatonic(step: StaffStep, octave: number): number {
  return octave * 7 + STEP_INDEX[step]
}

/**
 * Where a pad sits **relative to the top staff line** — 0 is that line,
 * negative is above it. Relative because the top line's own `y` is not known
 * until the score has been measured (see `staffTopYFor`), and the two cannot
 * be computed in the other order.
 *
 * `staffPositionOf` returning `undefined` for a pad inside a `GrooveScore`
 * cannot happen — `validateGrooveScore` rejects that score before it gets
 * here.
 */
function relYOf(pad: MappedDrumPad): number {
  const position = staffPositionOf(pad)
  invariant(position !== undefined, `pad "${pad}" has no staff position — validateGrooveScore should have rejected this score`)
  return (TOP_LINE_DIATONIC - diatonic(position.step, position.octave)) * 0.5
}

/**
 * The topmost ink this score will put on the page, relative to the top staff
 * line. A hands note reaches up by its stem; any note carrying marks reaches
 * up by the renderer's mark budget (`MARK_RESERVE`). Never positive: the top
 * staff line is itself ink, so it bounds the answer.
 *
 * Beaming can only pull a stem tip back down — a beam sits at the `min` of
 * its group's stem tips, and every member of that group is already measured
 * here — so measuring the pre-beam stems is exact, not merely safe.
 */
function highestRelInk(score: GrooveScore): number {
  let top = 0
  for (const note of score.notes) {
    const rel = relYOf(note.pad)
    if (note.voice === 'hands') top = Math.min(top, rel - STEM_LENGTH)
    if (marksOf(note).length > 0) top = Math.min(top, rel - MARK_RESERVE)
  }
  return top
}

/**
 * The lowest ink, relative to the top staff line — a feet note reaches down
 * by its stem, and every hands pad sits above the bottom staff line, which
 * bounds the answer from below at 4.
 */
function lowestRelInk(score: GrooveScore): number {
  let bottom = 4
  for (const note of score.notes) {
    const rel = relYOf(note.pad)
    bottom = Math.max(bottom, note.voice === 'feet' ? rel + STEM_LENGTH : rel)
  }
  return bottom
}

/**
 * Slide the staff down far enough that the score's highest ink clears the top
 * of the canvas, but never above `MIN_STAFF_TOP_Y` — a groove of nothing but
 * kicks should not float in the middle of a tall empty box.
 */
function staffTopYFor(score: GrooveScore): number {
  return Math.max(MIN_STAFF_TOP_Y, EDGE_PAD - highestRelInk(score))
}

// ---------------------------------------------------------------------- marks

/** Always `open`, then `accent`, then `ghost` — `EngravedNote.marks`'s documented order. */
function marksOf(note: GrooveNote): NoteMark[] {
  const marks: NoteMark[] = []
  if (note.articulations.includes('open')) marks.push('open')
  if (note.dynamics === 'accent') marks.push('accent')
  if (note.dynamics === 'ghost') marks.push('ghost')
  return marks
}

// ------------------------------------------------------------------ horizontal

function makeXOf(totalTicks: number, musicWidth: number): (tick: number) => number {
  return (tick: number) => LEFT_MARGIN + (tick / totalTicks) * musicWidth
}

function buildStaffLines(staffTopY: number, musicWidth: number): EngravedLine[] {
  return [0, 1, 2, 3, 4].map((offset) => ({
    y: staffTopY + offset,
    fromX: LEFT_MARGIN,
    toX: LEFT_MARGIN + musicWidth,
  }))
}

function buildBarlines(score: GrooveScore, musicWidth: number, x: (tick: number) => number): number[] {
  return [...score.measures.map((m) => x(m.startTick)), LEFT_MARGIN + musicWidth]
}

// -------------------------------------------------------------- notes & stems

/**
 * The mutable working form of a note while its stem is still being decided —
 * `EngravedNote` is deliberately readonly (a finished fact for the renderer),
 * but beaming (below) has to rewrite `stemToY` after this pass runs, so the
 * type it works over cannot be the frozen one.
 */
type DraftNote = {
  readonly id: string
  readonly pad: MappedDrumPad
  readonly tick: number
  readonly x: number
  readonly y: number
  readonly notehead: Notehead
  readonly voice: Voice
  readonly dynamics: DynamicsClass
  readonly marks: NoteMark[]
  stemToY: number
  flags: number
}

function draftNotes(score: GrooveScore, staffTopY: number, x: (tick: number) => number): DraftNote[] {
  return score.notes.map((note) => {
    const position = staffPositionOf(note.pad)
    invariant(position !== undefined, `note ${note.id} uses pad "${note.pad}", which has no staff position`)
    return {
      id: note.id,
      pad: note.pad,
      tick: note.tick,
      x: x(note.tick),
      y: staffTopY + relYOf(note.pad),
      notehead: position.notehead,
      voice: note.voice,
      dynamics: note.dynamics,
      marks: marksOf(note),
      stemToY: 0, // placeholder — assignBaseStems fills every note before this is ever read
      flags: 0, // placeholder — assignFlags fills every note once beaming is known
    }
  })
}

function stemKey(voice: Voice, tick: number): string {
  return `${voice}:${tick}`
}

/**
 * One stem per `(voice, tick)` pair — every note sharing that pair shares the
 * value. Returns the base value per key too, so beaming (which rewrites
 * `stemToY` on the notes themselves) still has the PRE-beam per-tick value to
 * combine — that value, not the post-rewrite one, is what "the group's
 * per-tick stemToY values" in the beam-y rule below means.
 */
function assignBaseStems(notes: readonly DraftNote[]): ReadonlyMap<string, number> {
  const groups = new Map<string, DraftNote[]>()
  for (const note of notes) {
    const key = stemKey(note.voice, note.tick)
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [note])
    else group.push(note)
  }
  const base = new Map<string, number>()
  for (const [key, group] of groups) {
    const voice = at(group, 0).voice
    const ys = group.map((n) => n.y)
    const stemToY = voice === 'hands' ? Math.min(...ys) - STEM_LENGTH : Math.max(...ys) + STEM_LENGTH
    for (const note of group) note.stemToY = stemToY
    base.set(key, stemToY)
  }
  return base
}

// ---------------------------------------------------------------------- beams

const EIGHTH_TICKS = TICKS_PER_QUARTER / 2

function buildBeams(
  score: GrooveScore,
  draftById: ReadonlyMap<string, DraftNote>,
  baseStems: ReadonlyMap<string, number>,
): EngravedBeam[] {
  const beatTicks = measureDurationTicks(score.timeSignature) / score.timeSignature.beats
  const groups = new Map<string, GrooveNote[]>()
  for (const note of score.notes) {
    const measure = at(score.measures, note.measureIndex)
    const beatIndex = Math.floor((note.tick - measure.startTick) / beatTicks)
    const key = `${note.voice}:${note.measureIndex}:${beatIndex}`
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [note])
    else group.push(note)
  }

  const beams: EngravedBeam[] = []
  for (const group of groups.values()) {
    // Only the SHORT notes decide whether this beat beams and how far the
    // beam runs. Requiring the whole group to be short (as this once did)
    // meant one quarter-note snare on beat 2 deleted the hi-hat beam for that
    // whole beat — Money Beat rendered its eighths on 2 and 4 as bare,
    // flagless stems, which read as quarter notes. Anything else sharing one
    // of those ticks still rides the beam, because it already shares the
    // stem.
    const shortNotes = group.filter((n) => n.durationTicks < TICKS_PER_QUARTER)
    const distinctTicks = [...new Set(shortNotes.map((n) => n.tick))]
    if (distinctTicks.length < 2) continue
    const beamedTicks = new Set(distinctTicks)
    const members = group.filter((n) => beamedTicks.has(n.tick))

    const voice = at(group, 0).voice
    const perTickStems = distinctTicks.map((tick) => {
      const value = baseStems.get(stemKey(voice, tick))
      invariant(value !== undefined, `no base stem recorded for voice ${voice} tick ${tick}`)
      return value
    })
    const beamY = voice === 'hands' ? Math.min(...perTickStems) : Math.max(...perTickStems)

    const drafts = members.map((n) => {
      const draft = draftById.get(n.id)
      invariant(draft !== undefined, `beam group references unknown note ${n.id}`)
      return draft
    })
    for (const draft of drafts) draft.stemToY = beamY

    const noteIds = [...drafts].sort((a, b) => a.x - b.x).map((d) => d.id)
    beams.push({
      voice,
      noteIds,
      fromX: Math.min(...drafts.map((d) => d.x)),
      toX: Math.max(...drafts.map((d) => d.x)),
      y: beamY,
      count: shortNotes.some((n) => n.durationTicks < EIGHTH_TICKS) ? 2 : 1,
    })
  }
  return beams
}

// ---------------------------------------------------------------------- flags

/** 0 for a quarter or longer, 1 for an eighth, 2 for a sixteenth or shorter. */
function flagCountFor(durationTicks: number): number {
  if (durationTicks >= TICKS_PER_QUARTER) return 0
  return durationTicks >= EIGHTH_TICKS ? 1 : 2
}

/**
 * A note gets flags only when no beam carries it. Flags are decided per STEM,
 * not per note: two pads struck on the same eighth share one stem, so they
 * must show the same flag count or the figure would contradict itself — and
 * the count comes from the shortest note on that stem, the same way a shared
 * stem's beam takes its count from the shortest note under it.
 */
function assignFlags(
  notes: readonly DraftNote[],
  durationById: ReadonlyMap<string, number>,
  beams: readonly EngravedBeam[],
): void {
  const beamed = new Set(beams.flatMap((beam) => beam.noteIds))
  const perStem = new Map<string, number>()
  for (const note of notes) {
    if (beamed.has(note.id)) continue
    const duration = durationById.get(note.id)
    invariant(duration !== undefined, `no duration recorded for note ${note.id}`)
    const key = stemKey(note.voice, note.tick)
    perStem.set(key, Math.max(perStem.get(key) ?? 0, flagCountFor(duration)))
  }
  for (const note of notes) {
    note.flags = beamed.has(note.id) ? 0 : (perStem.get(stemKey(note.voice, note.tick)) ?? 0)
  }
}

// -------------------------------------------------------------------- counts

const SIXTEENTH_TICKS = TICKS_PER_QUARTER / 4

/** See the module doc's "Count-row grid selection" section for why this is `/2`, not the brief's literal `/4`. */
function gridStepFor(score: GrooveScore): number {
  if (score.notes.length === 0) return TICKS_PER_QUARTER
  const shortest = Math.min(...score.notes.map((n) => n.durationTicks))
  if (shortest < EIGHTH_TICKS) return SIXTEENTH_TICKS
  if (shortest < TICKS_PER_QUARTER) return EIGHTH_TICKS
  return TICKS_PER_QUARTER
}

/** Labels for positions 1.. within a beat; position 0 is always the beat number, handled by the caller. */
function subdivisionLabels(subsPerBeat: number): readonly string[] {
  if (subsPerBeat === 1) return []
  if (subsPerBeat === 2) return ['', '&']
  if (subsPerBeat === 4) return ['', 'e', '&', 'a']
  throw new Error(`unsupported count-row subdivision: ${subsPerBeat} positions per beat`)
}

function buildCounts(
  score: GrooveScore,
  gridStep: number,
  countRowY: number,
  x: (tick: number) => number,
): EngravedCount[] {
  const beatTicks = measureDurationTicks(score.timeSignature) / score.timeSignature.beats
  const subsPerBeat = beatTicks / gridStep
  invariant(
    Number.isInteger(subsPerBeat) && subsPerBeat > 0,
    `count grid (step ${gridStep}) does not divide the beat (${beatTicks} ticks) evenly`,
  )
  const labels = subdivisionLabels(subsPerBeat)

  const counts: EngravedCount[] = []
  for (const measure of score.measures) {
    for (let beat = 0; beat < score.timeSignature.beats; beat++) {
      for (let sub = 0; sub < subsPerBeat; sub++) {
        const tick = measure.startTick + beat * beatTicks + sub * gridStep
        const text = sub === 0 ? String(beat + 1) : at(labels, sub)
        counts.push({ text, x: x(tick), y: countRowY })
      }
    }
  }
  return counts
}

// ------------------------------------------------------------------ assembly

export function engraveGroove(score: GrooveScore): StaffLayout {
  const measureTicks = measureDurationTicks(score.timeSignature)
  const totalTicks = measureTicks * score.measures.length
  // A bar is as wide as its own counting grid, so a busy bar gets the room it
  // needs instead of squeezing its noteheads together — see `SLOT_WIDTH`.
  const gridStep = gridStepFor(score)
  const musicWidth = (totalTicks / gridStep) * SLOT_WIDTH
  const x = makeXOf(totalTicks, musicWidth)

  const staffTopY = staffTopYFor(score)
  const countRowY = staffTopY + lowestRelInk(score) + COUNT_ROW_GAP

  const drafts = draftNotes(score, staffTopY, x)
  const draftById = new Map(drafts.map((d) => [d.id, d]))
  const baseStems = assignBaseStems(drafts)
  const beams = buildBeams(score, draftById, baseStems)
  assignFlags(drafts, new Map(score.notes.map((n) => [n.id, n.durationTicks])), beams)

  const notes: EngravedNote[] = drafts.map((d) => ({
    id: d.id,
    pad: d.pad,
    tick: d.tick,
    x: d.x,
    y: d.y,
    notehead: d.notehead,
    voice: d.voice,
    dynamics: d.dynamics,
    marks: d.marks,
    stemToY: d.stemToY,
    flags: d.flags,
  }))

  return {
    width: LEFT_MARGIN + musicWidth + RIGHT_MARGIN,
    height: countRowY + COUNT_ROW_DESCENT,
    staffLines: buildStaffLines(staffTopY, musicWidth),
    barlines: buildBarlines(score, musicWidth, x),
    notes,
    beams,
    counts: buildCounts(score, gridStep, countRowY, x),
  }
}
