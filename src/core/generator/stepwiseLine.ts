/**
 * Level 1's melodic line (roadmap 5.11): RCM Preparatory A's "four-note
 * melody, moving by step in one direction only" — split out of
 * `melody.ts`'s general random-walk generator because it isn't a
 * constrained walk at all, it's a contiguous run of the key's own scale
 * tones read forward or backward. Every consecutive pair is therefore
 * exactly one diatonic step apart and the run never changes direction, by
 * construction — there is no walk to check for doubling back. `Err` only
 * when `range` cannot even hold `bars` distinct scale tones.
 */
import { err, ok, type Result } from '@core/shared/result.ts'
import { randomInt, type Rng } from '@core/ports/rng.ts'
import { measureDurationTicks, type TimeSignature } from '@core/notation/score.ts'
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
): Result<readonly PlacedNote[], string> {
  if (!Number.isInteger(bars) || bars < 1) {
    return err(`generateMelody: bars must be a positive integer, got ${bars}`)
  }
  const barTicks = measureDurationTicks(ts)
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
    out.push({ startTick: tick, durationTicks: barTicks, midi: midiNote })
    tick += barTicks
  }
  return ok(out)
}
