/**
 * The sight-reading screen's own parameter overrides (roadmap 5.12, REQ-3.4.2).
 * `core/generator/melody.ts` already accepts key, range, rhythm, hands,
 * accidentals and hand independence — every knob the requirement names — but
 * `useSightReadingTrainer` only ever drew `defaultParamsForLevel`. This module
 * is the pure merge: a partial `SightReadingCustomization` plus a level's own
 * `GeneratorParams` produces the params to actually generate from, so a
 * learner can drill a specific weak spot ("G major, left hand only, no
 * accidentals") instead of only ever getting the level's canonical shape.
 *
 * Bars, time signature and max leap stay level-governed — those define the
 * level's difficulty tier, not content the requirement asks to be pickable.
 */
import { keyFromFifths, keyName, relativeKey, type Key } from '@core/theory/keys.ts'
import { invariant } from '@core/shared/invariant.ts'
import { midi as asMidi } from '@core/shared/units.ts'
import type { GeneratorParams, HandIndependence, MidiRange, RhythmStyle } from '@core/generator/melody.ts'

export type Register = 'low' | 'default' | 'high'

export type SightReadingCustomization = {
  readonly key?: Key
  readonly hands?: GeneratorParams['hands']
  readonly rhythm?: RhythmStyle
  readonly noAccidentals?: boolean
  readonly handIndependence?: HandIndependence
  readonly register?: Register
}

/** The 15 major keys, Cb..C#, in fifths order — the tonic half of the picker. */
export const MAJOR_KEYS: readonly Key[] = Array.from({ length: 15 }, (_, i) =>
  keyFromFifths(i - 7, 'major'),
)
/** Each major key's relative minor, same order — the mode half of the picker. */
export const MINOR_KEYS: readonly Key[] = MAJOR_KEYS.map(relativeKey)

export type PickerOption<T extends string> = { readonly value: T; readonly label: string }

/**
 * Build a picker's `<option>` list from a label map that is a `Record` over the
 * whole union, plus an explicit display order.
 *
 * The `Record` is the point. Every list below used to be a hand-written array,
 * which types fine while silently omitting a member — and one did: `RhythmStyle`
 * gained `'quarter-half'` (roadmap 5.54: level 1's own default, Faber's
 * quarter -> half -> whole order) and `RHYTHM_OPTIONS` was never updated, so a
 * level-1 learner could not pick their own level's rhythm from this picker at
 * all, and the list still offered whole notes as its first, easiest-looking
 * entry — the exact inversion 5.54 exists to correct. As a `Record`, that
 * omission is a `tsc` error instead of a live defect.
 *
 * The `order` array closes the other half, the half `tsc` cannot see: an order
 * that HAS a label available and still leaves it out drops the option just as
 * silently. That is a programmer error, so it is an `invariant` at module load
 * (`shared/result.ts`'s rule: `Result` for untrusted input, throw for a bug) —
 * every test and every dev server that imports this module runs it, and it can
 * never fire from anything a learner does.
 */
function optionsFrom<T extends string>(
  labels: Readonly<Record<T, string>>,
  order: readonly T[],
): readonly PickerOption<T>[] {
  const missing = Object.keys(labels).filter((key) => !order.includes(key as T))
  invariant(
    missing.length === 0,
    `picker order must offer every labelled option; missing: ${missing.join(', ')}`,
  )
  invariant(
    new Set(order).size === order.length,
    `picker order must not repeat an option: ${order.join(', ')}`,
  )
  return order.map((value) => ({ value, label: labels[value] }))
}

const RHYTHM_LABELS: Readonly<Record<RhythmStyle, string>> = {
  'quarter-half': 'Quarter and half notes',
  quarters: 'Quarter notes',
  'whole-half': 'Whole and half notes',
  eighths: 'Eighth notes',
  dotted: 'Dotted rhythms',
  syncopated: 'Syncopated',
}

/**
 * Display order is the PEDAGOGICAL ladder, not `RhythmStyle`'s declaration
 * order. Faber Piano Adventures Primer introduces quarter -> half -> whole, all
 * inside Unit 2 (official Teacher Guide, verified 2026-08-12 for roadmap 5.54),
 * so `'whole-half'` sits after `'quarters'` rather than leading the list: a
 * whole note is the LAST of the three basic values a beginner meets, not the
 * first. `'quarter-half'` leads because it is level 1's own default
 * (`levelDefaults.ts`), and the remaining three follow the level ladder's own
 * order (levels 3, 4, 5-6).
 */
const RHYTHM_ORDER: readonly RhythmStyle[] = [
  'quarter-half',
  'quarters',
  'whole-half',
  'eighths',
  'dotted',
  'syncopated',
]

export const RHYTHM_OPTIONS = optionsFrom(RHYTHM_LABELS, RHYTHM_ORDER)

type Hands = GeneratorParams['hands']

const HANDS_LABELS: Readonly<Record<Hands, string>> = {
  right: 'Right hand only',
  left: 'Left hand only',
  both: 'Both hands',
}
const HANDS_ORDER: readonly Hands[] = ['right', 'left', 'both']

export const HANDS_OPTIONS = optionsFrom(HANDS_LABELS, HANDS_ORDER)

const INDEPENDENCE_LABELS: Readonly<Record<HandIndependence, string>> = {
  unison: 'Unison (octaves apart)',
  parallel: 'Parallel motion',
  'blocked-chords': 'Blocked chords',
  independent: 'Independent lines',
}
const INDEPENDENCE_ORDER: readonly HandIndependence[] = [
  'unison',
  'parallel',
  'blocked-chords',
  'independent',
]

export const INDEPENDENCE_OPTIONS = optionsFrom(INDEPENDENCE_LABELS, INDEPENDENCE_ORDER)

const REGISTER_LABELS: Readonly<Record<Register, string>> = {
  low: 'Lower',
  default: "Level's default",
  high: 'Higher',
}
const REGISTER_ORDER: readonly Register[] = ['low', 'default', 'high']

export const REGISTER_OPTIONS = optionsFrom(REGISTER_LABELS, REGISTER_ORDER)

/** Piano's real range — a register shift can never walk a request off the instrument. */
const LOWEST_PIANO_KEY = 21
const HIGHEST_PIANO_KEY = 108

const REGISTER_SHIFT_SEMITONES: Readonly<Record<Register, number>> = {
  low: -12,
  default: 0,
  high: 12,
}

function shiftRange(range: MidiRange, semitones: number): MidiRange {
  if (semitones === 0) return range
  return {
    low: asMidi(Math.max(LOWEST_PIANO_KEY, range.low + semitones)),
    high: asMidi(Math.min(HIGHEST_PIANO_KEY, range.high + semitones)),
  }
}

/** `label` for the key picker — mirrors `melody.ts`'s own `scoreId` naming. */
export function keyLabel(key: Key): string {
  return keyName(key)
}

/** True once any field is set away from "leave the level's own default alone". */
export function isCustomizationActive(customization: SightReadingCustomization): boolean {
  return (
    customization.key !== undefined ||
    customization.hands !== undefined ||
    customization.rhythm !== undefined ||
    customization.noAccidentals === true ||
    customization.handIndependence !== undefined ||
    (customization.register !== undefined && customization.register !== 'default')
  )
}

/**
 * `base` (a level's `defaultParamsForLevel`) with every set field of
 * `customization` applied on top. Fields left `undefined` in `customization`
 * pass `base`'s own value through unchanged — this is a merge, not a
 * replacement, so a learner picking only a key keeps the level's rhythm,
 * hands and range exactly as they were.
 */
export function applyCustomization(
  base: GeneratorParams,
  customization: SightReadingCustomization,
): GeneratorParams {
  const shift = REGISTER_SHIFT_SEMITONES[customization.register ?? 'default']
  return {
    ...base,
    ...(customization.key === undefined ? {} : { key: customization.key }),
    ...(customization.hands === undefined ? {} : { hands: customization.hands }),
    ...(customization.rhythm === undefined ? {} : { rhythm: customization.rhythm }),
    ...(customization.noAccidentals === true ? { accidentalDensity: 0 } : {}),
    ...(customization.handIndependence === undefined
      ? {}
      : { handIndependence: customization.handIndependence }),
    rightRange: shiftRange(base.rightRange, shift),
    ...(base.leftRange === undefined ? {} : { leftRange: shiftRange(base.leftRange, shift) }),
  }
}
