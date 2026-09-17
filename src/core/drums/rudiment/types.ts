/**
 * Shared types for the 40 PAS International Drum Rudiments (DR-10).
 *
 * These types are split out from `score.ts` rather than living next to
 * `rudimentToScore` because of the core/content boundary (AGENTS.md): the
 * curriculum content (`@content/drums/rudiments.ts`) needs the `Rudiment`
 * shape to author the 40-entry table, but `score.ts` must never import
 * `@content/*` — it only ever receives a `Rudiment` value as a parameter.
 * Putting the type here lets both sides import the same declaration without
 * creating that forbidden edge.
 */

/** Vic Firth/Wooton's four-tier learning order — NOT the PAS list's own numbering. */
export type RudimentTier = 1 | 2 | 3 | 4

/** The four sections of the official PAS list, in list order. */
export type RudimentFamily = 'roll' | 'diddle' | 'flam' | 'drag'

export type RudimentStroke = {
  readonly sticking: 'R' | 'L'
  /** Offset from the pattern start, in ticks. */
  readonly tick: number
  readonly durationTicks: number
  readonly accent?: true
  /**
   * The grace-note ornament carried by this primary stroke. A flam/drag/buzz
   * is notated as a decoration ON the primary note it precedes, never as a
   * separate `RudimentStroke` — that mirrors how `GrooveNoteInput.articulations`
   * (`@core/drums/model/groove.ts`) attaches an articulation to one note
   * rather than modelling the grace note as its own onset event.
   */
  readonly articulation?: 'flam' | 'drag' | 'buzz'
}

export type Rudiment = {
  /** kebab-case, unique, e.g. 'single-paradiddle'. */
  readonly id: string
  /** 1..40, the rudiment's number on the official PAS list (not tier order). */
  readonly pasNumber: number
  readonly name: string
  readonly tier: RudimentTier
  readonly family: RudimentFamily
  /** Total span of one cycle, in ticks. Always a whole number of beats (a multiple of 480). */
  readonly patternTicks: number
  /** Sorted by `tick`, non-overlapping, all within `[0, patternTicks)`. */
  readonly strokes: readonly RudimentStroke[]
  /** Researched practice band, e.g. tier 1: 60..100. */
  readonly bpmBand: { readonly start: number; readonly target: number }
  /** One line: how it transfers to the kit. */
  readonly transfer: string
}
