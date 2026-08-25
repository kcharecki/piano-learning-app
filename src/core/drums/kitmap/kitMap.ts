/**
 * `KitMap` — the static, pure "which note means which pad" table for one
 * e-kit/module (DR-02). `presets.ts` ships the researched vendor tables;
 * a future MIDI-learn wizard (later slice, out of scope here) will build one
 * of these interactively and persist it. This module owns exactly two pure
 * facts and nothing stateful — the stream-processing (debounce, velocity
 * gate, choke, unmapped bucket, CC#4 tracking across events) is `engine.ts`'s
 * job, not this one's:
 *
 *  - `KitMapEntry` — what a raw note number means: either a fixed pad, or
 *    "this is a hi-hat note, resolve it against the CC#4 state machine."
 *  - `classifyHiHat`/`resolveKitMapTarget` — the CC#4 hi-hat state machine
 *    itself (research §3: "TD-17's closed threshold fixed at 90, configurable
 *    on higher modules... some budget kits never send separate open/closed
 *    notes — the CC is the only truth").
 *
 * Why a note can be `{ kind: 'hiHat' }` instead of always a fixed pad: real
 * kits split into two families (research §3). Some (GM, and Roland's own
 * edge-zone notes) send a DIFFERENT note number per pedal state, so the
 * table alone resolves the pad — no CC#4 needed, and none of our shipped
 * presets currently use `hiHat` entries for that reason. Others send ONE
 * note regardless of pedal position and rely on CC#4 alone to carry state —
 * that is what the `hiHat` entry kind exists for, ready for a preset (or the
 * future wizard) that needs it; `engine.test.ts`/`kitMap.test.ts` exercise it
 * directly via a synthetic fixture since no shipped preset happens to need it
 * yet.
 */
import type { Articulation } from '../model/articulation.ts'
import type { MappedDrumPad } from '../model/pad.ts'

export type KitMapEntry =
  | { readonly kind: 'pad'; readonly pad: MappedDrumPad }
  | { readonly kind: 'hiHat' }

/** Terse builder for the common case — keeps preset tables scannable. */
export function pad(p: MappedDrumPad): KitMapEntry {
  return { kind: 'pad', pad: p }
}

/** The one CC#4-gated entry kind — no data, so one shared value suffices. */
export const HI_HAT: KitMapEntry = { kind: 'hiHat' }

export type HiHatConfig = {
  /** CC#4 value at/above which the pedal reads as fully closed. Research §3: TD-17 default 90. */
  readonly closedThreshold: number
  /**
   * CC#4 value at/above which the pedal reads as half-open (and below
   * `closedThreshold`). Omitted entirely for a binary open/closed kit — most
   * kits never send a value in a stable "half" band, so this is opt-in per
   * preset, never assumed.
   */
  readonly halfThreshold?: number
}

/** Roland TD default (research §3), and the sensible default for any kit that doesn't say otherwise. */
export const DEFAULT_HI_HAT_CLOSED_THRESHOLD = 90

export const DEFAULT_HI_HAT_CONFIG: HiHatConfig = { closedThreshold: DEFAULT_HI_HAT_CLOSED_THRESHOLD }

export type KitMap = {
  readonly name: string
  /** Raw MIDI note number -> what it means. Deliberately a plain number key: notes outside 35-81 (Roland's 22/26, Yamaha's 83) are ordinary keys, never range-filtered. */
  readonly notes: Readonly<Record<number, KitMapEntry>>
  readonly hiHat?: HiHatConfig
}

export type HiHatState = 'closed' | 'half' | 'open'

/**
 * Pure classification of one CC#4 reading. `>=` at both boundaries (not `>`)
 * so a reading exactly at a threshold reads as the state that threshold
 * names — `closedThreshold` itself is "closed", not "half".
 */
export function classifyHiHat(cc4Value: number, config: HiHatConfig = DEFAULT_HI_HAT_CONFIG): HiHatState {
  if (cc4Value >= config.closedThreshold) return 'closed'
  if (config.halfThreshold !== undefined && cc4Value >= config.halfThreshold) return 'half'
  return 'open'
}

export type KitMapTarget = {
  readonly pad: MappedDrumPad
  readonly articulations: readonly Articulation[]
}

/**
 * The three-way state resolves to only two pads (DR-04 has no distinct
 * "half-open" pad): closed -> `hhClosed`; half and open -> `hhOpen`,
 * distinguished from each other only by the `open` articulation flag, which
 * mirrors the one existing convention for it (`referenceGrooves.ts`: a fully
 * open hi-hat note carries pad `hhOpen` AND articulation `open` together —
 * the "o" notation mark). "Half" gets pad `hhOpen` with no articulation: a
 * judgment call, since no half-specific pad or mark exists yet, but it keeps
 * all three physical states distinguishable at the `DrumHit` level (by pad,
 * or by articulation), which is what live scoring needs — how it eventually
 * renders is a later slice's problem.
 */
const HIHAT_PAD_FOR_STATE: Readonly<Record<HiHatState, MappedDrumPad>> = {
  closed: 'hhClosed',
  half: 'hhOpen',
  open: 'hhOpen',
}

/** Resolve one table entry (plus, for a `hiHat` entry, the current CC#4 state) to a concrete pad + articulations. */
export function resolveKitMapTarget(entry: KitMapEntry, hiHatState: HiHatState): KitMapTarget {
  if (entry.kind === 'hiHat') {
    return {
      pad: HIHAT_PAD_FOR_STATE[hiHatState],
      articulations: hiHatState === 'open' ? ['open'] : [],
    }
  }
  return { pad: entry.pad, articulations: [] }
}
