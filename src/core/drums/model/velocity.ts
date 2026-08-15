/**
 * Named velocity classes (DR-04). Research §3: "ghosts land roughly 30-50,
 * normal hits 90-100 — low velocity is signal, not noise; per-pad
 * minimum-velocity gate should be configurable, not hardcoded." This is the
 * one place the thresholds live — `DrumHit` classification (a live 0-127 MIDI
 * velocity) and `GrooveNote.dynamics` (a notated class) both read them from
 * here, and DR-08's calibration screen is expected to construct its own
 * `VelocityThresholds` rather than any module reaching for a magic number.
 */

export type VelocityClass = 'accent' | 'normal' | 'ghost'

export type VelocityThresholds = {
  /** Velocity <= this is a ghost note. */
  readonly ghostMax: number
  /** Velocity >= this is an accent. Between the two is `normal`. */
  readonly accentMin: number
}

/** Research §3's numbers: ghosts <=50, normal in the low-to-high 90s+, accents >=100. */
export const DEFAULT_VELOCITY_THRESHOLDS: VelocityThresholds = {
  ghostMax: 50,
  accentMin: 100,
}

export function velocityClassOf(
  velocity: number,
  thresholds: VelocityThresholds = DEFAULT_VELOCITY_THRESHOLDS,
): VelocityClass {
  if (velocity <= thresholds.ghostMax) return 'ghost'
  if (velocity >= thresholds.accentMin) return 'accent'
  return 'normal'
}

/**
 * The inverse direction: a representative MIDI velocity for a notated
 * dynamics class, for synthesized playback of a `GrooveScore` (DR-06) that
 * carries no live velocity of its own. Picked from the middle of each class's
 * research-cited band, not its edge, so a synthesized ghost note is audibly
 * soft rather than borderline.
 */
export function defaultVelocityForClass(
  velocityClass: VelocityClass,
  thresholds: VelocityThresholds = DEFAULT_VELOCITY_THRESHOLDS,
): number {
  switch (velocityClass) {
    case 'ghost':
      return Math.round(thresholds.ghostMax / 2)
    case 'accent':
      return Math.round((thresholds.accentMin + 127) / 2)
    case 'normal':
      return Math.round((thresholds.ghostMax + thresholds.accentMin) / 2)
  }
}
