/**
 * `DrumHit` — a live input event (DR-04): pad, velocity, time, articulation
 * flags. Time is milliseconds at the edge (straight off a MIDI timestamp or a
 * fallback input adapter, DR-02/DR-03) and ticks once aligned to a tempo/grid
 * (DR-07's scorer). Modelled as one generic shape parameterised over which —
 * `RawDrumHit`/`AlignedDrumHit` are the two call sites actually use — so a
 * millisecond hit can never be passed where a tick-aligned one is expected,
 * the same discipline `Ticks`/`Millis` branding gives the piano side.
 *
 * `makeDrumHit` throws on a malformed value (programmer error — this
 * constructs from already-decoded MIDI/pointer events, not from untrusted raw
 * bytes). It is deliberately NOT the place that classifies velocity into a
 * named class: `velocityClassOf` (`./velocity.ts`) takes a plain number so a
 * caller with calibration-adjusted thresholds is never fighting this type.
 */
import { invariant } from '@core/shared/invariant.ts'
import type { Millis, Ticks } from '@core/shared/units.ts'
import { type Articulation, isArticulation } from './articulation.ts'
import { type DrumPad, isDrumPad } from './pad.ts'

export type DrumHit<TTime extends Millis | Ticks> = {
  readonly pad: DrumPad
  /** Raw MIDI velocity, 0-127. Named-class interpretation is `velocityClassOf`'s job. */
  readonly velocity: number
  readonly time: TTime
  readonly articulations: readonly Articulation[]
}

/** A hit as it arrives from an input adapter — millisecond timestamp, not yet aligned. */
export type RawDrumHit = DrumHit<Millis>
/** A hit once the scorer has aligned it to the tick grid (DR-07). */
export type AlignedDrumHit = DrumHit<Ticks>

export type DrumHitInput<TTime extends Millis | Ticks> = {
  readonly pad: DrumPad
  readonly velocity: number
  readonly time: TTime
  readonly articulations?: readonly Articulation[]
}

function checkArticulations(articulations: readonly Articulation[]): void {
  for (const a of articulations) {
    invariant(isArticulation(a), `unknown articulation: ${a}`)
  }
}

/** Validates and normalises a `DrumHit`. Throws on a value no real event can produce. */
export function makeDrumHit<TTime extends Millis | Ticks>(
  input: DrumHitInput<TTime>,
): DrumHit<TTime> {
  invariant(isDrumPad(input.pad), `unknown drum pad: ${input.pad as string}`)
  invariant(
    Number.isInteger(input.velocity) && input.velocity >= 0 && input.velocity <= 127,
    `drum hit velocity out of range: ${input.velocity}`,
  )
  invariant(
    Number.isFinite(input.time) && input.time >= 0,
    `drum hit time must be a non-negative number, got ${String(input.time)}`,
  )
  const articulations = input.articulations ?? []
  checkArticulations(articulations)
  return {
    pad: input.pad,
    velocity: input.velocity,
    time: input.time,
    articulations,
  }
}
