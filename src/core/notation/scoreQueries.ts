/**
 * Reading a `Score`: range queries, lookups, and the transformations that
 * return a new Score (roadmap T.16).
 *
 * Split out of `score.ts`, which held the model AND everything that reads it
 * and was over the 500-line cap on the strength of a `max-lines` override
 * raising it to 520. The two halves answer different questions — `score.ts`
 * says what a Score IS and how one is built and validated; this file says what
 * you can ask of one — and only this direction of import exists, so there is no
 * cycle between them.
 *
 * The performance contract lives here too: `notesInRange` and the other range
 * queries run inside the playback loop, so they binary-search the `startTick`
 * ordering `makeScore` guarantees and never scan (REQ-4.1).
 */
import { at, invariant } from '@core/shared/invariant.ts'
import { ticks as asTicks, type Midi, type Ticks } from '@core/shared/units.ts'
import {
  maxNoteDurationTicks,
  measureIndexAtTick,
  NO_NOTES,
  type Hand,
  type Measure,
  type Score,
  type ScoreNote,
} from './score.ts'

/** First index whose `startTick` is >= `tick`; `notes.length` if there is none. */
function lowerBoundByStart(notes: readonly ScoreNote[], tick: number): number {
  let lo = 0
  let hi = notes.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (at(notes, mid).startTick < tick) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Notes STARTING in the half-open range `[fromTick, toTick)`.
 * O(log n + k) — this runs inside the playback loop, so it must never scan.
 */
export function notesInRange(score: Score, fromTick: Ticks, toTick: Ticks): readonly ScoreNote[] {
  if (toTick <= fromTick) return NO_NOTES
  const notes = score.notes
  const out: ScoreNote[] = []
  for (let i = lowerBoundByStart(notes, fromTick); i < notes.length; i++) {
    const n = at(notes, i)
    if (n.startTick >= toTick) break
    out.push(n)
  }
  return out
}

export function notesInMeasure(score: Score, measureIndex: number): readonly ScoreNote[] {
  const m = score.measures[measureIndex]
  if (m === undefined) return NO_NOTES
  return notesInRange(score, m.startTick, asTicks(m.startTick + m.durationTicks))
}

/** Notes whose onset is exactly `tick`. */
export function notesAtTick(score: Score, tick: Ticks): readonly ScoreNote[] {
  const notes = score.notes
  const out: ScoreNote[] = []
  for (let i = lowerBoundByStart(notes, tick); i < notes.length; i++) {
    const n = at(notes, i)
    if (n.startTick !== tick) break
    out.push(n)
  }
  return out
}

/** Notes being held at `tick`: `startTick <= tick < startTick + durationTicks`. */
export function soundingAtTick(score: Score, tick: Ticks): readonly ScoreNote[] {
  const notes = score.notes
  const out: ScoreNote[] = []
  const earliest = tick - score.maxNoteDurationTicks
  for (let i = lowerBoundByStart(notes, earliest); i < notes.length; i++) {
    const n = at(notes, i)
    if (n.startTick > tick) break
    if (tick < n.startTick + n.durationTicks) out.push(n)
  }
  return out
}

export function measureAtTick(score: Score, tick: Ticks): Measure | undefined {
  const index = measureIndexAtTick(score.measures, tick)
  return index < 0 ? undefined : at(score.measures, index)
}

/** End of the written music. O(n) — call it once, not per frame. */
export function scoreDurationTicks(score: Score): Ticks {
  let end = 0
  for (const m of score.measures) end = Math.max(end, m.startTick + m.durationTicks)
  for (const n of score.notes) end = Math.max(end, n.startTick + n.durationTicks)
  return asTicks(end)
}

// -------------------------------------------------------------- transformations

/**
 * Hand-mute practice (REQ-3.2.3). Measures, tempos and id are unchanged.
 *
 * A staff is not owned by a hand. A single-staff part that turns bass clef
 * mid-piece emits left-hand notes on a staff whose `hand` is still 'right', so
 * filtering staves by hand alone would leave a surviving note standing on an
 * undeclared staff — an invalid Score. Keep every staff a surviving note is
 * still written on, and when nothing survives keep the staves as they were: a
 * score with no notes is still a score, and it must have at least one staff.
 */
export function filterHands(score: Score, hands: readonly Hand[]): Score {
  const keep = new Set(hands)
  const notes = score.notes.filter((n) => keep.has(n.hand))
  const used = new Set(notes.map((n) => n.staff))
  const staves = score.staves.filter((s) => keep.has(s.hand) || used.has(s.staff))
  return {
    ...score,
    notes,
    staves: staves.length > 0 ? staves : score.staves,
    maxNoteDurationTicks: maxNoteDurationTicks(notes),
  }
}

/**
 * Tick span of an inclusive measure range, for looping (REQ-3.2.3).
 * Indices are clamped to the score and swapped if given backwards.
 */
export function measureRange(
  score: Score,
  from: number,
  to: number,
): { startTick: Ticks; endTick: Ticks } {
  invariant(score.measures.length > 0, 'measureRange: score has no measures')
  const last = score.measures.length - 1
  const clamp = (i: number): number => Math.min(last, Math.max(0, Math.trunc(i)))
  const lo = clamp(Math.min(from, to))
  const hi = clamp(Math.max(from, to))
  const a = at(score.measures, lo)
  const b = at(score.measures, hi)
  return { startTick: a.startTick, endTick: asTicks(b.startTick + b.durationTicks) }
}

/**
 * Notes grouped by simultaneous onset — what the matcher waits for.
 * Notes with `tiedFrom` are excluded: they continue an earlier key press, so no
 * new press is expected. `toleranceTicks` measures from the group's first onset,
 * so a long stream of near-simultaneous notes cannot drift into one group.
 *
 * Takes the note list rather than a whole `Score` so a caller can group an
 * already hand-filtered subset — `core/practice/matcher.ts`'s `buildExpected`
 * calls this on the active (tied- and hand-filtered) notes, because chord SIZES
 * must be computed over what is actually being practised.
 *
 * Input must be sorted ascending by `startTick` (as `Score.notes` always is);
 * the tolerance rule assumes it.
 */
export function chordGroups(
  notes: readonly ScoreNote[],
  toleranceTicks = 0,
): readonly (readonly ScoreNote[])[] {
  invariant(toleranceTicks >= 0, `chordGroups: negative tolerance ${toleranceTicks}`)
  const groups: ScoreNote[][] = []
  let current: ScoreNote[] | undefined
  let anchor = 0
  for (const n of notes) {
    if (n.tiedFrom) continue
    invariant(
      current === undefined || n.startTick >= anchor,
      'chordGroups: notes must be ascending by startTick',
    )
    if (current === undefined || n.startTick - anchor > toleranceTicks) {
      current = []
      groups.push(current)
      anchor = n.startTick
    }
    current.push(n)
  }
  return groups
}

/**
 * The lowest and highest sounding pitch in a score, or `undefined` for a score
 * with no notes at all (a rests-only rhythm pattern is a real case — see
 * `core/generator/rhythm`).
 *
 * Exists for the on-screen keyboard (roadmap 5.4, REQ-3.3.7): a fallback
 * keyboard drawn at the full 88 keys is unplayable at any width, and one drawn
 * at a fixed guessed range leaves the notes of the loaded piece off the end of
 * itself. Tied continuations are INCLUDED — a tie carries a real sounding
 * pitch, and this asks what the piece sounds, not which onsets the matcher
 * expects.
 */
export function pitchRange(score: Score): { readonly low: Midi; readonly high: Midi } | undefined {
  let low: Midi | undefined
  let high: Midi | undefined
  for (const note of score.notes) {
    if (low === undefined || note.midi < low) low = note.midi
    if (high === undefined || note.midi > high) high = note.midi
  }
  if (low === undefined || high === undefined) return undefined
  return { low, high }
}
