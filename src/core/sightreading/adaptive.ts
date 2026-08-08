/**
 * Difficulty adaptation for the sight-reading trainer (roadmap 2.6, REQ-3.4.6).
 *
 * ## The band, not the score
 *
 * A single low read is not evidence the level is wrong — nerves, an awkward
 * page turn, anything can cost one piece. What actually means "this level is
 * wrong" is a *run*: several reads in a row that land on the same side of the
 * 80–90% target band. `adaptLevel` looks at the most recent `window` records
 * (3 by default) and only moves the level when *all* of them agree — every
 * one above the band's top raises it by one, every one below the bottom
 * lowers it by one. A run with even one in-band or opposite-side read breaks
 * that unanimity, so a mixed run (high, high, one bad read, high, high) can
 * never flip the level back and forth on a single outlier — see the "mixed
 * sequence" test in `adaptive.test.ts` for the concrete case this guards
 * against.
 *
 * Fewer than `window` records is not evidence either way (there is no run
 * yet), so the level is left exactly where it is.
 *
 * `recent` is read oldest-first — the same order `retire` appends in — and
 * only its tail (the `window` most recent reads) is ever examined; callers
 * are expected to pass the caller's full history and let `adaptLevel` take
 * the slice, rather than pre-trimming it themselves.
 *
 * ## Level bounds
 *
 * Sight-reading levels are `MIN_LEVEL..MAX_LEVEL`, matching
 * `core/generator/melody.ts`'s `defaultParamsForLevel` ladder exactly
 * (`MAX_LEVEL` is re-exported from that ladder's own length, not a second
 * hand-maintained copy of it). `adaptLevel` clamps every result (and
 * `current`, defensively) to that range, so it can never hand back a level
 * the generator does not know how to build for.
 *
 * ## Picking the next piece
 *
 * `nextExerciseParams` starts from the level's canonical
 * `defaultParamsForLevel` shape — which fixes everything that actually
 * defines the difficulty tier: rhythm, hand independence, ranges, time
 * signature — and, if that exact piece has already been read, searches
 * nearby *variants* until it finds one whose id is not in `history`.
 *
 * A generated score's id is entirely a function of its `GeneratorParams`
 * (`generateMelody`'s module doc), never of anything its `Rng` draws. So the
 * only way to get a new id is to vary the params themselves — re-rolling the
 * same params against a fresh `Rng` produces different notes but the exact
 * same id, and would look "retired" forever after the first read. The two
 * knobs varied here are the ones that change an id the least in difficulty
 * terms: transposition (`key`, all 15 legal `-7..7` fifths spellings for the
 * level's mode) and a handful of extra bar counts on top of the level's
 * canonical length.
 *
 * `melody.ts` does not export a way to predict an id from `GeneratorParams`
 * without generating a score — this module has no cheap "would this id
 * collide" check available and has to actually call `generateMelody` and read
 * `.value.id` back for each candidate it tries, which is real, reported
 * friction: an exported `scoreIdFor(params)` in `melody.ts` would make this
 * cheaper and remove the risk of a second, hand-rolled copy of the id format
 * drifting out of sync with the real one.
 *
 * The search space (15 keys × 8 bar-count variants, per level) is large but
 * finite, exactly like every other bounded search in the generator
 * (`nearestValid`, `buildBarDurations`): if a level's entire generated pool
 * has genuinely been read, `nextExerciseParams` gives up and returns the last
 * candidate it tried rather than looping forever. REQ-3.4.3 already
 * anticipates this case — "it may move to repertoire" — so exhausting a
 * level's generated pool is a curriculum-level concern, not this module's.
 */
import {
  defaultParamsForLevel,
  generateMelody,
  MAX_GENERATOR_LEVEL,
  type GeneratorParams,
} from '@core/generator/melody.ts'
import { keyFromFifths } from '@core/theory/keys.ts'
import { randomInt, type Rng } from '@core/ports/rng.ts'
import { invariant } from '@core/shared/invariant.ts'
import { isRetired, type SightReadingRecord } from './session.ts'

/** Matches `defaultParamsForLevel`'s ladder in `core/generator/melody.ts`. */
export const MIN_LEVEL = 1
export const MAX_LEVEL = MAX_GENERATOR_LEVEL

const DEFAULT_WINDOW = 3
const DEFAULT_BAND: readonly [number, number] = [0.8, 0.9]

const clampLevel = (level: number): number => Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, level))

export type AdaptOptions = {
  /** How many of the most recent reads must agree before the level moves. Defaults to 3. */
  readonly window?: number
  /** Target accuracy band, `[low, high]`. Defaults to `[0.8, 0.9]` (REQ-3.4.6). */
  readonly band?: readonly [number, number]
}

/**
 * REQ-3.4.6: nudge the level up or down by exactly one step when the most
 * recent `window` reads unanimously clear the target band on one side;
 * otherwise hold. See the module doc for why unanimity, not average, is the
 * trigger.
 */
export function adaptLevel(
  current: number,
  recent: readonly SightReadingRecord[],
  opts: AdaptOptions = {},
): number {
  const window = opts.window ?? DEFAULT_WINDOW
  const [low, high] = opts.band ?? DEFAULT_BAND
  invariant(
    Number.isInteger(window) && window >= 1,
    `adaptLevel: window must be a positive integer, got ${window}`,
  )
  invariant(low <= high, `adaptLevel: band low (${low}) must be <= band high (${high})`)

  const clamped = clampLevel(current)
  if (recent.length < window) return clamped

  const run = recent.slice(-window)
  if (run.every((r) => r.accuracy > high)) return clampLevel(clamped + 1)
  if (run.every((r) => r.accuracy < low)) return clampLevel(clamped - 1)
  return clamped
}

// ---------------------------------------------------------------------------
// next exercise
// ---------------------------------------------------------------------------

/** Legal key signatures run `-7..7` fifths (`core/theory/keys.ts`'s `MAX_FIFTHS`). */
const FIFTHS_RANGE = 7
const KEY_VARIANTS = 2 * FIFTHS_RANGE + 1
/** How many extra bars, at most, a variant may add on top of the level's canonical length. */
const BAR_VARIANTS = 8
const TOTAL_VARIANTS = KEY_VARIANTS * BAR_VARIANTS

/** The `index`-th variant of `base`: one of `KEY_VARIANTS * BAR_VARIANTS` (key, extra-bars) pairs. */
function variantParams(base: GeneratorParams, index: number): GeneratorParams {
  const keySlot = index % KEY_VARIANTS
  const barSlot = Math.floor(index / KEY_VARIANTS) % BAR_VARIANTS
  const fifths = keySlot - FIFTHS_RANGE
  return {
    ...base,
    key: keyFromFifths(fifths, base.key.mode),
    bars: base.bars + barSlot,
  }
}

/**
 * REQ-3.4.2 / REQ-3.4.6: parameters for a fresh, unretired exercise at
 * `level`. See the module doc for the search strategy and its bound.
 */
export function nextExerciseParams(
  level: number,
  rng: Rng,
  history: readonly SightReadingRecord[],
): GeneratorParams {
  const base = defaultParamsForLevel(level)
  const baseGenerated = generateMelody(base, rng)
  if (baseGenerated.ok && !isRetired(history, baseGenerated.value.id)) return base

  const start = randomInt(rng, 0, TOTAL_VARIANTS - 1)
  let lastTried = base
  for (let step = 0; step < TOTAL_VARIANTS; step++) {
    const candidate = variantParams(base, (start + step) % TOTAL_VARIANTS)
    lastTried = candidate
    const generated = generateMelody(candidate, rng)
    if (generated.ok && !isRetired(history, generated.value.id)) return candidate
  }
  return lastTried
}
