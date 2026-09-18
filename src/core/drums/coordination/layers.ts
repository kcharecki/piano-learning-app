/**
 * Layer-build drills (roadmap DR-15 "coordination trainer"): peel a groove
 * apart into cumulative limb groups so a learner adds one hand/foot at a
 * time instead of meeting the whole pattern at once.
 *
 * Three groups, always built in the same order — cymbals first (the
 * timekeeping ostinato a learner already has from the groove trainer),
 * then feet (kick joins), then snare-family (the backbeat and any toms join
 * last, since they are usually the busiest or most syncopated voice). A
 * group with no notes in the score is skipped entirely rather than
 * contributing an empty layer, so a hats+kick-only groove yields two layers,
 * not three.
 *
 * Every layer is a real, independently playable `GrooveScore` — same time
 * signature, swing and measures as the source, a subset of its notes,
 * untouched (ids, ticks, voices, dynamics all carry over) — so the existing
 * `planGrooveRun`/`engraveGroove` machinery needs no special case for a
 * layer versus a full groove.
 */
import type { GrooveScore } from '@core/drums/model/groove.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'

/** Limb groups, in build order. */
export type LayerGroup = 'cymbals' | 'feet' | 'snare'

export const LAYER_ORDER: readonly LayerGroup[] = ['cymbals', 'feet', 'snare']

/**
 * Every mapped pad assigned to exactly one group — a `Record` rather than a
 * set-per-group so adding a 17th pad someday is a compile error here until
 * it is placed, instead of silently falling through to a default group.
 */
const PAD_GROUP: Readonly<Record<MappedDrumPad, LayerGroup>> = {
  hhClosed: 'cymbals',
  hhOpen: 'cymbals',
  rideBow: 'cymbals',
  rideBell: 'cymbals',
  rideEdge: 'cymbals',
  crash1: 'cymbals',
  crash2: 'cymbals',
  splash: 'cymbals',
  kick: 'feet',
  hhPedal: 'feet',
  snare: 'snare',
  snareRim: 'snare',
  crossStick: 'snare',
  tomHigh: 'snare',
  tomMid: 'snare',
  tomFloor: 'snare',
}

const GROUP_LABEL: Readonly<Record<LayerGroup, string>> = {
  cymbals: 'cymbals',
  feet: 'feet',
  snare: 'snare',
}

export function layerGroupOf(pad: MappedDrumPad): LayerGroup {
  return PAD_GROUP[pad]
}

export type GrooveLayer = {
  /** 0-based. */
  readonly index: number
  /** Total layers in this stack — the same value on every entry. */
  readonly count: number
  readonly group: LayerGroup
  readonly score: GrooveScore
}

/**
 * Cumulative layers: layer `k` contains every note whose group is in
 * `LAYER_ORDER[0..k]` among the groups actually present in `score`. Groups
 * with no notes are skipped, so the layer count is the number of DISTINCT
 * groups the score actually uses, not always 3.
 *
 * Returns `[]` for a score with no notes — there is nothing to build a
 * cumulative stack out of.
 */
export function layerStack(score: GrooveScore): readonly GrooveLayer[] {
  if (score.notes.length === 0) return []

  const presentGroups = LAYER_ORDER.filter((group) =>
    score.notes.some((note) => layerGroupOf(note.pad) === group),
  )
  const count = presentGroups.length

  return presentGroups.map((group, i) => {
    const included = new Set(presentGroups.slice(0, i + 1))
    const notes = score.notes.filter((note) => included.has(layerGroupOf(note.pad)))
    const label = presentGroups
      .slice(0, i + 1)
      .map((g) => GROUP_LABEL[g])
      .join(' + ')
    const layerScore: GrooveScore = {
      ...score,
      id: `${score.id}/layer-${i + 1}`,
      title: `${score.title} — layer ${i + 1} of ${count}: ${label}`,
      notes,
    }
    return { index: i, count, group, score: layerScore }
  })
}
