/**
 * Falling-note piano-roll geometry (roadmap B.3, REQ-3.2.4's optional half).
 *
 * A pure mapping: a `Score`, a visible tick window, and a lane (pitch) range
 * in -> the note rectangles to draw. No pixels, no DOM, no colour — this
 * module only ever hands back unitless numbers; `src/app/practice/PianoRoll.tsx`
 * is what turns them into an SVG. Time is left as raw `Ticks`; the caller
 * decides how a tick maps to a screen x. `lane` is a 0-based row index that
 * increases with pitch (`lane = midi - laneRange.lowMidi`, so `0` is the
 * LOWEST visible pitch — inverting that for a screen y-axis, where "up" is a
 * smaller number, is the renderer's job, not this module's).
 *
 * ## Visibility
 *
 * A note is included exactly when its SOUNDING SPAN intersects the half-open
 * window `[fromTick, toTick)`: `startTick < toTick && soundingEnd >
 * fromTick`, where `soundingEnd` is `startTick + durationTicks`. A
 * zero-length note (a real MusicXML import can produce `durationTicks: 0` —
 * see `musicxml.ts`) would make that span empty and so never intersect
 * anything; `soundingEnd` is floored to `startTick + 1` for exactly that
 * case, so a zero-length note still occupies the one tick its onset lands
 * on rather than vanishing. `lengthTicks` on the returned rectangle is still
 * the note's true (possibly zero) duration — only the visibility test widens
 * it, not what gets drawn.
 *
 * A note outside `laneRange` (pitch) is left out entirely rather than
 * clamped onto the nearest edge lane — clamping would draw a wrong pitch on
 * a real lane, which is worse than not drawing it.
 *
 * ## Performance
 *
 * Reuses `soundingAtTick`/`notesInRange` from `score.ts` rather than
 * scanning every note in the score, for the same O(log n + k) reason the
 * transport and the note matcher do: this runs once per animation frame
 * against whatever score is loaded, including the 1600-note fixture
 * `e2e/perf-large-score.spec.ts` budgets against.
 */
import { notesInRange, soundingAtTick, type Hand, type Score, type ScoreNote } from './score.ts'
import { ticks as asTicks, type Midi, type Ticks } from '@core/shared/units.ts'

/** The visible slice of musical time, in ticks. Half-open: `[fromTick, toTick)`. */
export type PianoRollWindow = {
  readonly fromTick: Ticks
  readonly toTick: Ticks
}

/** The visible slice of pitch space. Inclusive at both ends. */
export type PianoRollLaneRange = {
  readonly lowMidi: Midi
  readonly highMidi: Midi
}

export type PianoRollNote = {
  readonly noteId: string
  readonly midi: Midi
  readonly hand: Hand
  /** 0-based, strictly increasing with `midi`: `midi - laneRange.lowMidi`. */
  readonly lane: number
  readonly startTick: Ticks
  /** The note's true duration — NOT clipped to the window. May be 0. */
  readonly lengthTicks: Ticks
}

/** See the module comment's "Visibility" section for why this is not simply `startTick + durationTicks`. */
function soundingEnd(note: ScoreNote): number {
  return note.durationTicks > 0 ? note.startTick + note.durationTicks : note.startTick + 1
}

function intersectsWindow(note: ScoreNote, window: PianoRollWindow): boolean {
  return note.startTick < window.toTick && soundingEnd(note) > window.fromTick
}

function inLaneRange(note: ScoreNote, laneRange: PianoRollLaneRange): boolean {
  return note.midi >= laneRange.lowMidi && note.midi <= laneRange.highMidi
}

function toRollNote(note: ScoreNote, laneRange: PianoRollLaneRange): PianoRollNote {
  return {
    noteId: note.id,
    midi: note.midi,
    hand: note.hand,
    lane: note.midi - laneRange.lowMidi,
    startTick: note.startTick,
    lengthTicks: note.durationTicks,
  }
}

/**
 * The rectangles to draw for one frame. Degrades cleanly on a degenerate
 * window (`toTick <= fromTick`) or lane range (`highMidi < lowMidi`) by
 * returning an empty list rather than throwing — a caller mid-seek or
 * mid-resize can produce either transiently.
 */
export function pianoRollNotes(
  score: Score,
  window: PianoRollWindow,
  laneRange: PianoRollLaneRange,
): readonly PianoRollNote[] {
  if (window.toTick <= window.fromTick) return []
  if (laneRange.highMidi < laneRange.lowMidi) return []

  // A note starting exactly at `fromTick` with a positive duration is found
  // by BOTH calls below (sounding at fromTick, AND starting in-range) — the
  // `seen` guard is what keeps it a single rectangle rather than two.
  const seen = new Set<string>()
  const out: PianoRollNote[] = []
  const collect = (note: ScoreNote): void => {
    if (seen.has(note.id)) return
    if (!inLaneRange(note, laneRange)) return
    if (!intersectsWindow(note, window)) return
    seen.add(note.id)
    out.push(toRollNote(note, laneRange))
  }
  for (const note of soundingAtTick(score, window.fromTick)) collect(note)
  for (const note of notesInRange(score, window.fromTick, window.toTick)) collect(note)

  out.sort((a, b) => a.startTick - b.startTick || a.midi - b.midi)
  return out
}

/** Convenience for a symmetric look-ahead/look-behind window around `nowTick`, clamped at 0. */
export function pianoRollWindowAround(
  nowTick: number,
  lookbehindTicks: number,
  lookaheadTicks: number,
): PianoRollWindow {
  return {
    fromTick: asTicks(Math.max(0, nowTick - Math.max(0, lookbehindTicks))),
    toTick: asTicks(Math.max(0, nowTick) + Math.max(0, lookaheadTicks)),
  }
}
