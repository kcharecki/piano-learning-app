/**
 * Articulation flags shared by `DrumHit` (a live input event) and `GrooveNote`
 * (a notated one) — DR-04's spec names exactly these five: `flam, drag, buzz,
 * open, choke`. `Sticking` (`R`/`L`) is notated-only (DR-13's editor), but
 * lives alongside articulation because both are the small enum vocabulary the
 * MusicXML bridge round-trips per note.
 */

export const ARTICULATIONS = ['flam', 'drag', 'buzz', 'open', 'choke'] as const
export type Articulation = (typeof ARTICULATIONS)[number]

const ARTICULATION_SET: ReadonlySet<string> = new Set(ARTICULATIONS)

export function isArticulation(value: string): value is Articulation {
  return ARTICULATION_SET.has(value)
}

export const STICKINGS = ['R', 'L'] as const
export type Sticking = (typeof STICKINGS)[number]

export function isSticking(value: string): value is Sticking {
  return value === 'R' || value === 'L'
}
