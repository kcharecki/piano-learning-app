/**
 * The tick <-> millisecond bridge (roadmap 1.9, REQ-3.2.2, REQ-4.1).
 *
 * Everything in the domain stores musical time in ticks, because ticks survive a
 * tempo change and milliseconds do not. Exactly one place is allowed to know the
 * conversion, and this is it: the transport, the metronome and the scheduler all
 * go through `tickToMs` / `msToTick`.
 *
 * The mapping is piecewise-linear. Between two tempo marks the tempo is constant,
 * so a tick range maps to a straight line; a tempo change is a kink, not a jump.
 * Both directions are therefore exact inverses of each other, which is what makes
 * "seek to this millisecond" and "where is the playhead" agree to the tick.
 *
 * A tempo mark is `TempoMark` from the score model, so a parsed score's `tempos`
 * can be handed to `makeTempoMap` unchanged.
 *
 * Scaling (REQ-3.2.2, the practice tempo slider) is a single multiplier applied
 * to every mark at once. It is kept OUT of the marks so that:
 *  - the written tempo is still readable (`bpmAtTick`) for display, and
 *  - changing the slider is O(1) and reuses the cached prefix sums.
 *
 * Arithmetic note: at `TICKS_PER_QUARTER = 480`, one tick at B bpm lasts
 * `60000 / (B * 480) = 125 / B` ms. Segment durations are computed as
 * `(deltaTicks * 125) / bpm` rather than `deltaTicks * (125 / bpm)` — one
 * rounding instead of two, so 480 ticks at 120 bpm is exactly 500, not 499.999…
 */
import type { TempoMark } from '@core/notation/score.ts'
import { at, invariant } from '@core/shared/invariant.ts'
import {
  bpm as asBpm,
  millis as asMillis,
  ticks as asTicks,
  TICKS_PER_QUARTER,
  type Bpm,
  type Millis,
  type Ticks,
} from '@core/shared/units.ts'

export type { TempoMark }

/**
 * A tempo map: the written tempo marks plus the practice-tempo multiplier.
 *
 * `marks` is always sorted by ascending tick, has no two marks on the same tick,
 * no two consecutive marks of the same bpm, and always starts at tick 0 —
 * `makeTempoMap` is what guarantees that, so build maps with it.
 *
 * `scale` multiplies the tempo: 0.5 is half speed (every duration doubles), 2 is
 * double speed. It is NOT baked into `marks`.
 */
export type TempoMap = { readonly marks: readonly TempoMark[]; readonly scale: number }

/**
 * The tempo assumed when a score does not state one. MusicXML defines no default
 * tempo at all; 120 is the MIDI/SMF default (500,000 microseconds per quarter
 * note, SMF spec §"Set Tempo"), which is what every sequencer falls back to, so
 * an unmarked score sounds here the way it sounds everywhere else.
 */
export const DEFAULT_BPM = 120

/**
 * REQ-3.2.2 asks for "30–100% and beyond". The clamp is wider than the
 * requirement on both sides, but finite on purpose:
 *  - 0.25 (25%) is slower than the required 30% floor, so the slowest useful
 *    woodshedding tempo is reachable. Below that a single quarter note lasts
 *    multiple seconds, the pulse stops being perceivable as a pulse, and the
 *    metronome's scheduling lookahead would have to grow to match.
 *  - 2.0 (200%) is the ceiling because past double speed the note events of a
 *    normal piece come faster than the <20 ms audio budget (REQ-4.1) can service
 *    them on the fallback soundfont path, and practising above 2x is not a thing
 *    anyone asked for.
 * A slider that hands us 0 or 10 gets clamped rather than rejected: a UI control
 * out of range is a UI bug, and silently refusing to play is a worse failure than
 * playing at the nearest supported tempo.
 */
export const MIN_TEMPO_SCALE = 0.25
export const MAX_TEMPO_SCALE = 2.0

/** ms in one tick at 1 bpm: 60_000 ms per minute / 480 ticks per quarter. */
const MS_PER_TICK_AT_1_BPM = 60_000 / TICKS_PER_QUARTER

/** Clamp a practice-tempo multiplier into the supported range. Throws on NaN. */
export function clampScale(scale: number): number {
  invariant(Number.isFinite(scale), `tempo scale must be a finite number, got ${scale}`)
  return Math.min(MAX_TEMPO_SCALE, Math.max(MIN_TEMPO_SCALE, scale))
}

/**
 * Normalise raw tempo marks into a `TempoMap`: sort by tick, drop duplicates
 * (later mark wins on an equal tick, and a mark that does not change the tempo is
 * dropped), and guarantee a mark at tick 0 — defaulting to 120 bpm when the first
 * written mark appears later, so an unmarked pickup bar still has a tempo.
 *
 * Throws `InvariantError` on impossible input (negative tick, non-positive or
 * non-finite bpm): tempo marks reach here from a parser that has already
 * validated them, so bad values are programmer error, not user error.
 */
export function makeTempoMap(marks: readonly TempoMark[], scale = 1): TempoMap {
  for (const m of marks) {
    invariant(
      Number.isFinite(m.tick) && m.tick >= 0,
      `tempo mark tick must be a finite tick >= 0, got ${m.tick}`,
    )
    invariant(Number.isFinite(m.bpm) && m.bpm > 0, `tempo mark bpm must be positive, got ${m.bpm}`)
  }

  // Stable sort: on an equal tick the later mark in input order ends up later in
  // the array, and the loop below lets it win.
  const sorted = [...marks].sort((a, b) => a.tick - b.tick)
  const first = sorted[0]
  const seeded =
    first !== undefined && first.tick === 0
      ? sorted
      : [{ tick: asTicks(0), bpm: asBpm(DEFAULT_BPM) }, ...sorted]

  const out: TempoMark[] = []
  for (const m of seeded) {
    const previous = out[out.length - 1]
    if (previous !== undefined && previous.tick === m.tick) out.pop()
    const kept = out[out.length - 1]
    if (kept !== undefined && kept.bpm === m.bpm) continue
    out.push({ tick: asTicks(m.tick), bpm: asBpm(m.bpm) })
  }
  return { marks: out, scale: clampScale(scale) }
}

/**
 * Replace the practice-tempo multiplier (REQ-3.2.2), clamped to
 * `MIN_TEMPO_SCALE..MAX_TEMPO_SCALE`. The marks array is passed through by
 * reference, so the cached tick->ms prefix sums survive a slider drag.
 */
export function withScale(map: TempoMap, scale: number): TempoMap {
  return { marks: map.marks, scale: clampScale(scale) }
}

// ------------------------------------------------------------------- internals

/**
 * Unscaled milliseconds elapsed at each mark, i.e. `cum[i] = tickToMs(marks[i])`
 * at scale 1. Cached per marks array: the playback loop converts on every frame,
 * and the array is frozen by construction, so recomputing the prefix sum each
 * time would be pure waste.
 */
const cumulativeCache = new WeakMap<readonly TempoMark[], readonly number[]>()

function segmentMs(deltaTicks: number, bpm: number): number {
  return (deltaTicks * MS_PER_TICK_AT_1_BPM) / bpm
}

function cumulativeMs(marks: readonly TempoMark[]): readonly number[] {
  const cached = cumulativeCache.get(marks)
  if (cached !== undefined) return cached
  const out: number[] = [0]
  for (let i = 1; i < marks.length; i++) {
    const previous = at(marks, i - 1)
    out.push(at(out, i - 1) + segmentMs(at(marks, i).tick - previous.tick, previous.bpm))
  }
  cumulativeCache.set(marks, out)
  return out
}

function requireMarks(map: TempoMap): void {
  invariant(map.marks.length > 0, 'tempo map has no marks — build it with makeTempoMap')
}

/**
 * Index of the mark in force at `tick`: the last one at or before it. A tick
 * before the first mark (a count-in, which lives at negative ticks) uses the
 * first mark, so the line simply extends backwards.
 */
function segmentIndexAtTick(marks: readonly TempoMark[], tick: number): number {
  let lo = 0
  let hi = marks.length - 1
  let found = 0
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (at(marks, mid).tick <= tick) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

/** The same search on the ms axis — the mirror image, so the two stay inverse. */
function segmentIndexAtMs(cumulative: readonly number[], ms: number): number {
  let lo = 0
  let hi = cumulative.length - 1
  let found = 0
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (at(cumulative, mid) <= ms) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

/** Milliseconds at `tick` before the practice-tempo multiplier is applied. */
function unscaledMs(marks: readonly TempoMark[], tick: number): number {
  const index = segmentIndexAtTick(marks, tick)
  const mark = at(marks, index)
  return at(cumulativeMs(marks), index) + segmentMs(tick - mark.tick, mark.bpm)
}

// --------------------------------------------------------------- conversions

/**
 * Musical time -> wall-clock time, piecewise-linear across tempo changes.
 * Fractional ticks are fine (the playhead lives between ticks); ticks before 0
 * extrapolate backwards at the first tempo, which is what a count-in needs.
 */
export function tickToMs(map: TempoMap, tick: Ticks): Millis {
  requireMarks(map)
  return asMillis(unscaledMs(map.marks, tick) / map.scale)
}

/**
 * Wall-clock time -> musical time: the exact inverse of `tickToMs`.
 * The result is deliberately NOT rounded — the transport interpolates the
 * playhead between ticks, and rounding here would make the round-trip lossy.
 */
export function msToTick(map: TempoMap, ms: Millis): Ticks {
  requireMarks(map)
  const unscaled = ms * map.scale
  const cumulative = cumulativeMs(map.marks)
  const index = segmentIndexAtMs(cumulative, unscaled)
  const mark = at(map.marks, index)
  const intoSegment = ((unscaled - at(cumulative, index)) * mark.bpm) / MS_PER_TICK_AT_1_BPM
  return asTicks(mark.tick + intoSegment)
}

/** The tempo as written at `tick`, before the practice multiplier — for display. */
export function bpmAtTick(map: TempoMap, tick: Ticks): Bpm {
  requireMarks(map)
  return at(map.marks, segmentIndexAtTick(map.marks, tick)).bpm
}

/** The tempo actually being played at `tick` — what the metronome ticks at. */
export function effectiveBpmAtTick(map: TempoMap, tick: Ticks): Bpm {
  return asBpm(bpmAtTick(map, tick) * map.scale)
}

/**
 * Wall-clock length of the tick span `[fromTick, toTick)`, tempo changes inside
 * it included. Signed: a backwards span gives a negative duration, which keeps it
 * additive (`d(a,b) + d(b,c) === d(a,c)` for any a, b, c).
 */
export function tickDurationMs(map: TempoMap, fromTick: Ticks, toTick: Ticks): Millis {
  requireMarks(map)
  return asMillis((unscaledMs(map.marks, toTick) - unscaledMs(map.marks, fromTick)) / map.scale)
}

// -------------------------------------------------------------- beat helpers

/**
 * Beats -> ticks, where a beat is a quarter note (the unit `Bpm` refers to).
 * Fractional beats are allowed and are not rounded, so the conversion is an exact
 * inverse of `ticksToBeats`; round at the call site if a whole tick is required.
 */
export function beatsToTicks(beats: number): Ticks {
  invariant(Number.isFinite(beats), `beats must be a finite number, got ${beats}`)
  return asTicks(beats * TICKS_PER_QUARTER)
}

/** Ticks -> quarter-note beats. 480 ticks is 1 beat; 720 is 1.5. */
export function ticksToBeats(tick: Ticks): number {
  invariant(Number.isFinite(tick), `ticks must be a finite number, got ${tick}`)
  return tick / TICKS_PER_QUARTER
}
