/**
 * Human-readable descriptions of the sight-reading trainer's own six levels
 * (roadmap U.1). `core/generator/levelDefaults.ts`'s `LEVEL_ROWS` is the only
 * source of truth for what each level actually generates; this module is
 * hand-authored prose derived from that table, not a second copy of it.
 *
 * This is the TRAINER'S level (`useSightReadingTrainer`'s `level`, adapted by
 * `core/sightreading/adaptive.ts` from recent run accuracy) — roadmap 5.57
 * already named this out distinctly from the curriculum track's level number
 * on Progress, which is a different number that moves on a different signal.
 * `SightReadingScreen` shows this text as the page subtitle, which is what
 * UI-11 wanted ("Level 1 — notes around middle C") but could not build: no
 * such field existed on either `GeneratorParams` or the curriculum-track
 * level, and borrowing the curriculum description would have reintroduced
 * exactly the two-numbers-one-word collision 5.57 fixed.
 *
 * ## Why these sentences and not others
 *
 * Every claim below is checked against `LEVEL_ROWS` two ways:
 *
 * 1. **Range bounds** (e.g. "middle C to the G above the staff") are stated
 *    as the closed interval a hand's notes are GENERATED WITHIN, never as
 *    where the melody starts or clusters. `generateMelodicLine` starts its
 *    walk at the range's MIDPOINT, not its floor (`rangeMid = round((low +
 *    high) / 2)`), and level 1's `generateStepwiseOneDirectionLine` picks a
 *    random contiguous slice of the range's scale tones — so "starts at
 *    middle C" would be false on plenty of actual runs, but "between middle
 *    C and the G above the staff" is guaranteed by every candidate search in
 *    `melody.ts` (`nearestValid`, `pickNextMelodic`, `pickSteeredNote`),
 *    which all reject anything outside `range`.
 * 2. **Hand-independence prose** ("doubles... an octave below", "parallel
 *    thirds", "block chords") describes `generateSecondHand`'s literal
 *    per-case behaviour (`doubleHand`, `generateBlockChords` in melody.ts),
 *    not a guess at what those internal labels mean.
 *
 * Deliberately NOT stated: exact `maxLeapSemitones` values or specific
 * rhythm note-values for levels 1-2. Two sibling roadmap tasks are landing
 * concurrently with this one: 5.53 re-grades the leap column so levels below
 * 4 stay within a 5th, and 5.54 changes levels 1-2's rhythm to quarters and
 * halves. A sentence naming today's exact interval or note-value would go
 * stale the moment either merges. Range/position facts and the
 * hand-independence shape don't move in either change, so those carry the
 * per-level distinction instead — rhythm is named only where it's a level
 * this task does not touch (eighths at level 3, dotted at level 4, syncopated
 * at levels 5-6), and always in qualitative terms.
 */
import { MAX_GENERATOR_LEVEL } from '@core/generator/levelDefaults.ts'
import { invariant } from '@core/shared/invariant.ts'

/**
 * Index `i` describes trainer level `i + 1`. Kept as a plain array (not a
 * keyed map) because the levels are dense `1..MAX_GENERATOR_LEVEL` with no
 * gaps — the length check below is what actually enforces that a level was
 * not forgotten, the same discipline `curriculum.ts` uses for its own
 * authored content.
 */
const LEVEL_DESCRIPTIONS: readonly string[] = [
  // Level 1 — right hand alone (levelDefaults row 0: hands 'right',
  // stepwiseOneDirection true, rightRange 60..79).
  'Right hand only, moving stepwise, from middle C to the G above the staff.',
  // Level 2 — both hands, left an octave below the right (row 1:
  // handIndependence 'unison', rightRange 60..79, leftRange 48..67 — the
  // same width, one octave apart, which is what makes 'unison' a clean
  // octave-doubling rather than a fold, per doubleHand's own module doc).
  'Both hands: the left doubles the right, one octave below.',
  // Level 3 — hands in parallel thirds (row 2: handIndependence 'parallel',
  // rhythm 'eighths' — not touched by 5.54, which only reaches levels 1-2).
  'Both hands move in parallel thirds, with eighth notes.',
  // Level 4 — melody over block chords (row 3: handIndependence
  // 'blocked-chords' → generateBlockChords' one root-position triad per bar;
  // rhythm 'dotted', likewise outside 5.54's scope).
  'The left hand plays block chords under a dotted-rhythm melody.',
  // Level 5 — independent hands, minor key, wider range (row 4:
  // handIndependence 'independent', mode 'minor' — stable under
  // adaptive.ts's transposition search, which varies fifths but never mode —
  // rightRange 60..84 / leftRange 36..60, each four semitones wider on both
  // ends than levels 2-4's ranges).
  'Both hands play independent lines in a minor key, over a wider range.',
  // Level 6 — independent hands, the widest range of any level, syncopated
  // (row 5: rightRange 55..88 / leftRange 31..67 — wider on both ends than
  // every other row, including level 5's; rhythm 'syncopated', outside
  // 5.54's scope).
  'Both hands play independent lines, syncopated, across the widest range yet.',
]

invariant(
  LEVEL_DESCRIPTIONS.length === MAX_GENERATOR_LEVEL,
  `levelDescriptions: expected one description per generator level ` +
    `(${MAX_GENERATOR_LEVEL}), got ${LEVEL_DESCRIPTIONS.length}`,
)
invariant(
  LEVEL_DESCRIPTIONS.every((d) => d.trim().length > 0),
  'levelDescriptions: every trainer level must have a non-empty description',
)

/**
 * The trainer level's one-line, learner-facing description — e.g. for level
 * 1, `"Right hand only, moving stepwise, from middle C to the G above the
 * staff."`. `level` is clamped into `1..MAX_GENERATOR_LEVEL` the same way
 * `defaultParamsForLevel` clamps it (`core/generator/levelDefaults.ts`), so
 * an out-of-range value — which should never happen, `adaptLevel` already
 * clamps before this is ever called — still returns a real sentence instead
 * of `undefined`.
 */
export function sightReadingLevelDescription(level: number): string {
  const index = Math.min(MAX_GENERATOR_LEVEL, Math.max(1, Math.round(level))) - 1
  const description = LEVEL_DESCRIPTIONS[index]
  invariant(description !== undefined, `levelDescriptions: no entry at index ${index}`)
  return description
}
