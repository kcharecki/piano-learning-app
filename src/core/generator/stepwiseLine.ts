/**
 * Level 1's melodic line (roadmap 5.11): RCM Preparatory A's "four-note
 * melody, moving by step in one direction only" — split out of
 * `melody.ts`'s general random-walk generator because it isn't a
 * constrained walk at all, it's a contiguous run of the key's own scale
 * tones read forward or backward. Every consecutive pair of STEPPED pitches
 * is therefore exactly one diatonic step apart and the run never changes
 * direction, by construction — there is no walk to check for doubling back.
 * `Err` only when `range` cannot even hold `bars` distinct scale tones.
 *
 * Roadmap 5.54: each stepped pitch used to be emitted as a single note
 * spanning the ENTIRE bar — a whole note in every time signature this
 * generator uses (`measureDurationTicks({4,4}) = 1920` ticks = four quarter
 * notes). That ignored `style` completely, which is how level 1 (declared
 * `'quarter-half'`, roadmap 5.54) kept engraving four whole notes regardless
 * of what its own rhythm column said. Each bar's stepped pitch is now
 * re-articulated across that bar's own `buildBarDurations(barUnits, style,
 * rng)` split (`rhythmPools.ts`, shared with `melody.ts`'s own walked
 * lines) — same pitch, real quarter/half rhythm — instead of one held note.
 */
import { err, ok, type Result } from '@core/shared/result.ts'
import { randomInt, type Rng } from '@core/ports/rng.ts'
import { invariant } from '@core/shared/invariant.ts'
import { measureDurationTicks, type TimeSignature } from '@core/notation/score.ts'
import { buildBarDurations, GRID, type RhythmStyle } from './rhythmPools.ts'
import type { MidiRange, PlacedNote } from './melody.ts'

/** 0–11, wrapping negative input the way `%` alone does not. */
function pc(n: number): number {
  return ((n % 12) + 12) % 12
}

export function generateStepwiseOneDirectionLine(
  rng: Rng,
  bars: number,
  ts: TimeSignature,
  range: MidiRange,
  scalePcs: ReadonlySet<number>,
  style: RhythmStyle,
): Result<readonly PlacedNote[], string> {
  if (!Number.isInteger(bars) || bars < 1) {
    return err(`generateMelody: bars must be a positive integer, got ${bars}`)
  }
  const barTicks = measureDurationTicks(ts)
  const barUnits = barTicks / GRID
  invariant(
    Number.isInteger(barUnits),
    `generateStepwiseOneDirectionLine: ${barTicks} ticks is not a whole number of grid units`,
  )
  const scaleTones: number[] = []
  for (let m = range.low; m <= range.high; m++) if (scalePcs.has(pc(m))) scaleTones.push(m)
  if (scaleTones.length < bars) {
    return err(
      `generateMelody: range ${range.low}..${range.high} holds only ${scaleTones.length} scale ` +
        `tone(s), not enough for a ${bars}-note stepwise-one-direction line`,
    )
  }
  const start = randomInt(rng, 0, scaleTones.length - bars)
  const ascending = rng.next() < 0.5
  const slice = scaleTones.slice(start, start + bars)
  const ordered = ascending ? slice : [...slice].reverse()
  const out: PlacedNote[] = []
  let tick = 0
  for (const midiNote of ordered) {
    for (const units of buildBarDurations(barUnits, style, rng)) {
      const durationTicks = units * GRID
      out.push({ startTick: tick, durationTicks, midi: midiNote })
      tick += durationTicks
    }
  }
  return ok(out)
}
