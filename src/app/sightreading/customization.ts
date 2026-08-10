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

export const RHYTHM_OPTIONS: readonly { readonly value: RhythmStyle; readonly label: string }[] = [
  { value: 'whole-half', label: 'Whole and half notes' },
  { value: 'quarters', label: 'Quarter notes' },
  { value: 'eighths', label: 'Eighth notes' },
  { value: 'dotted', label: 'Dotted rhythms' },
  { value: 'syncopated', label: 'Syncopated' },
]

export const HANDS_OPTIONS: readonly { readonly value: GeneratorParams['hands']; readonly label: string }[] = [
  { value: 'right', label: 'Right hand only' },
  { value: 'left', label: 'Left hand only' },
  { value: 'both', label: 'Both hands' },
]

export const INDEPENDENCE_OPTIONS: readonly {
  readonly value: HandIndependence
  readonly label: string
}[] = [
  { value: 'unison', label: 'Unison (octaves apart)' },
  { value: 'parallel', label: 'Parallel motion' },
  { value: 'blocked-chords', label: 'Blocked chords' },
  { value: 'independent', label: 'Independent lines' },
]

export const REGISTER_OPTIONS: readonly { readonly value: Register; readonly label: string }[] = [
  { value: 'low', label: 'Lower' },
  { value: 'default', label: "Level's default" },
  { value: 'high', label: 'Higher' },
]

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
