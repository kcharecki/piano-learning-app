/**
 * The falling-note piano roll (roadmap B.3, REQ-3.2.4's optional half):
 * time flows right-to-left in tick units, a fixed "now" line marks the
 * current transport position, and each note is a rectangle whose row
 * (`lane`) is its pitch, coloured by hand. Renders ABOVE the notation
 * (`ScoreViewer`), not instead of it — see `PracticeScreen`'s module comment
 * for why both stay visible together.
 *
 * Pure layout and paint: `pianoRollNotes` (`@core/notation/pianoRoll.ts`)
 * does every bit of music-domain work; this only turns its unitless
 * rectangles into SVG, in the SAME coordinate system the `viewBox` declares
 * (raw tick/lane units, not pixels) — so a caller reading the rendered SVG's
 * own `x`/`y`/`width` attributes reads exact musical units, not a
 * screen-size-dependent approximation.
 *
 * Position updates arrive imperatively through `setPositionTick`, called at
 * most once per animation frame from `PracticeScreen`'s own interception of
 * the SAME `moveCursorTo` call `usePracticeEngine` already makes to drive
 * the score cursor every frame (see that hook's module comment for the
 * pattern this borrows) — never a second clock, and never per-note React
 * state: one `setState` pair per frame redraws every visible rectangle at
 * once, which is what keeps this affordable against a 1600-note score
 * (`e2e/perf-large-score.spec.ts`) — the window recomputed each frame is
 * always small and bounded, and `pianoRollNotes` is O(log n + k) in it.
 */
import {
  pianoRollNotes,
  pianoRollWindowAround,
  type PianoRollLaneRange,
  type PianoRollNote,
} from '@core/notation/pianoRoll.ts'
import { type Score } from '@core/notation/score.ts'
import { pitchRange } from '@core/notation/scoreQueries.ts'
import { midi as asMidi, TICKS_PER_QUARTER } from '@core/shared/units.ts'
import { forwardRef, useImperativeHandle, useMemo, useState } from 'react'

export type PianoRollHandle = {
  /** Called at most once per animation frame — see the module comment. */
  setPositionTick(tick: number): void
}

export type PianoRollProps = {
  readonly score: Score
  /** Where to draw before the first `setPositionTick` call lands — e.g. a
   *  paused score's resting position. Defaults to the top of the piece;
   *  pass a real one (`PracticeScreen` derives it from `engine.position`)
   *  so toggling the roll on mid-pause does not flash to tick 0. */
  readonly initialPositionTick?: number
  /** Ticks of upcoming music shown ahead of the now-line. */
  readonly lookaheadTicks?: number
  /** Ticks of just-played music kept visible behind the now-line. */
  readonly lookbehindTicks?: number
  /** Semitones of headroom above/below the piece's own pitch range. */
  readonly lanePadding?: number
}

const DEFAULT_LOOKAHEAD_TICKS = TICKS_PER_QUARTER * 8 // ~2 bars of 4/4 ahead
const DEFAULT_LOOKBEHIND_TICKS = TICKS_PER_QUARTER * 1
const DEFAULT_LANE_PADDING = 2
/** A zero-length note still gets this much visual width — see pianoRoll.ts's own "degrades cleanly" note; the true (possibly 0) length stays on `data-length-ticks`. */
const MIN_VISUAL_WIDTH_TICKS = TICKS_PER_QUARTER / 16
/** Visual thickness of the now-line, in the same tick units as everything else. */
const NOW_LINE_WIDTH_TICKS = TICKS_PER_QUARTER / 12
/** Row height < 1 lane unit, so adjacent-pitch rectangles keep a visible gap. */
const NOTE_ROW_HEIGHT = 0.82
const NOTE_ROW_INSET = (1 - NOTE_ROW_HEIGHT) / 2

function laneRangeFor(score: Score, padding: number): PianoRollLaneRange {
  const range = pitchRange(score)
  const low = Math.max(0, (range?.low ?? 60) - padding)
  const high = Math.min(127, Math.max(low, (range?.high ?? 60) + padding))
  return { lowMidi: asMidi(low), highMidi: asMidi(high) }
}

/** Is `note` sounding exactly at `nowTick` — the "current position" the roll highlights (REQ-3.2.4). */
function isLit(note: PianoRollNote, nowTick: number): boolean {
  const end = note.lengthTicks > 0 ? note.startTick + note.lengthTicks : note.startTick + 1
  return note.startTick <= nowTick && nowTick < end
}

export const PianoRoll = forwardRef<PianoRollHandle, PianoRollProps>(function PianoRoll(
  {
    score,
    initialPositionTick = 0,
    lookaheadTicks = DEFAULT_LOOKAHEAD_TICKS,
    lookbehindTicks = DEFAULT_LOOKBEHIND_TICKS,
    lanePadding = DEFAULT_LANE_PADDING,
  },
  ref,
) {
  const laneRange = useMemo(() => laneRangeFor(score, lanePadding), [score, lanePadding])
  const laneCount = laneRange.highMidi - laneRange.lowMidi + 1
  const totalTicks = lookbehindTicks + lookaheadTicks
  const startTick = Math.max(0, initialPositionTick)

  const [nowTick, setNowTick] = useState(startTick)
  const [notes, setNotes] = useState<readonly PianoRollNote[]>(() =>
    pianoRollNotes(score, pianoRollWindowAround(startTick, lookbehindTicks, lookaheadTicks), laneRange),
  )

  useImperativeHandle(
    ref,
    () => ({
      setPositionTick(tick: number) {
        const clamped = Math.max(0, tick)
        setNowTick(clamped)
        setNotes(
          pianoRollNotes(
            score,
            pianoRollWindowAround(clamped, lookbehindTicks, lookaheadTicks),
            laneRange,
          ),
        )
      },
    }),
    [score, lookbehindTicks, lookaheadTicks, laneRange],
  )

  const windowStart = Math.max(0, nowTick - lookbehindTicks)

  return (
    <div className="piano-roll" data-testid="piano-roll">
      <svg
        className="piano-roll-svg"
        data-testid="piano-roll-svg"
        viewBox={`0 0 ${totalTicks} ${laneCount}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Falling-note piano roll, synchronized with the score below"
      >
        {notes.map((note) => (
          <rect
            key={note.noteId}
            className={`piano-roll-note piano-roll-note-${note.hand}`}
            data-testid="piano-roll-note"
            data-note-id={note.noteId}
            data-midi={note.midi}
            data-hand={note.hand}
            data-lit={isLit(note, nowTick)}
            data-length-ticks={note.lengthTicks}
            x={note.startTick - windowStart}
            y={laneCount - 1 - note.lane + NOTE_ROW_INSET}
            width={Math.max(note.lengthTicks, MIN_VISUAL_WIDTH_TICKS)}
            height={NOTE_ROW_HEIGHT}
            // A stroke drawn on the "lit" note (feature-piano-roll.css) needs
            // a constant SCREEN width regardless of how many ticks the
            // viewBox currently spans — this is what makes `stroke-width` in
            // CSS pixels mean pixels rather than a viewBox-scaled fraction.
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* Drawn after the notes, not before — the current-position marker
            (REQ-3.2.4) must sit visually on top of whatever note it crosses. */}
        <rect
          className="piano-roll-now-line"
          data-testid="piano-roll-now-line"
          x={nowTick - windowStart - NOW_LINE_WIDTH_TICKS / 2}
          y={0}
          width={NOW_LINE_WIDTH_TICKS}
          height={laneCount}
        />
      </svg>
    </div>
  )
})
