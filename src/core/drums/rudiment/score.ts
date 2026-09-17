/**
 * Turns a `Rudiment` (authored data, `@content/drums/rudiments.ts`) into a
 * playable `GrooveScore` (DR-04) on the snare pad, repeated `cycles` times —
 * this is the bridge that lets the rudiment trainer (DR-10) reuse the same
 * notation/playback/matching pipeline every other groove uses instead of
 * inventing a parallel one.
 *
 * This module must NOT import `@content/*` (see the doc comment on
 * `../rudiment/types.ts`) — it takes the `Rudiment` value as a parameter,
 * so the dependency only ever flows content -> core, never back.
 *
 * Padding: a rudiment's own `patternTicks` is already a whole number of
 * beats (enforced by content-side tests), but it need not be a whole number
 * of 4/4 BARS (1920 ticks) — a 3-beat pattern repeated twice spans 6 beats,
 * which is 1.5 bars. Rather than reject that, we round the measure count up
 * and let `makeGrooveScore` leave the tail of the last bar silent. This is
 * always safe (never crosses a barline) because every stroke tick/duration
 * in a `Rudiment` is built from a divisor of the quarter note, and 1920
 * (a 4/4 bar) is itself a whole multiple of every such divisor — so a
 * stroke's start and end always land exactly on a grid line, and a grid line
 * that divides 480 evenly divides 1920 evenly too. No stroke can ever
 * straddle a bar boundary as a result, no matter how the cycles land.
 */
import { makeGrooveScore, type GrooveNoteInput, type GrooveScore } from '@core/drums/model/groove.ts'
import type { Rudiment } from './types.ts'

/** One 4/4 bar at `TICKS_PER_QUARTER = 480`: 4 beats * 480. */
const BAR_TICKS = 1920

export function rudimentToScore(rudiment: Rudiment, cycles: number): GrooveScore {
  const notes: GrooveNoteInput[] = []
  for (let cycle = 0; cycle < cycles; cycle++) {
    const base = cycle * rudiment.patternTicks
    for (const stroke of rudiment.strokes) {
      notes.push({
        pad: 'snare',
        tick: base + stroke.tick,
        durationTicks: stroke.durationTicks,
        sticking: stroke.sticking,
        ...(stroke.accent === true ? { dynamics: 'accent' as const } : {}),
        ...(stroke.articulation === undefined ? {} : { articulations: [stroke.articulation] }),
      })
    }
  }
  const totalTicks = cycles * rudiment.patternTicks
  const measureCount = Math.max(1, Math.ceil(totalTicks / BAR_TICKS))
  return makeGrooveScore({
    id: `rudiment-${rudiment.id}-x${cycles}`,
    title: rudiment.name,
    measureCount,
    notes,
  })
}
