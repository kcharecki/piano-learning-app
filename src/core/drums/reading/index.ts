/**
 * Public surface of the rhythm reading generator (DR-11). Everything a
 * consumer (the app's reading trainer, its own tests) needs comes through
 * here rather than reaching into `cells.ts`/`levels.ts`/`generate.ts`/
 * `adapt.ts` directly, so the internal split between "vocabulary", "level
 * ladder", "generator" and "adaptive advance" can change without moving
 * import paths at every call site.
 */
export type { RhythmCell, CellOnset } from './cells.ts'
export { RHYTHM_CELLS, cellSpanTicks } from './cells.ts'

export type { ReadingLevel, ReadingLevelSpec } from './levels.ts'
export {
  MIN_READING_LEVEL,
  MAX_READING_LEVEL,
  isReadingLevel,
  READING_LEVELS,
  cellsForLevel,
  describeReadingLevel,
} from './levels.ts'

export type { ReadingExerciseOptions } from './generate.ts'
export { generateReadingExercise, readingOnsetCount } from './generate.ts'

export type { ReadingRunRecord } from './adapt.ts'
export { READING_ADAPT_WINDOW, READING_ADAPT_BAND, adaptReadingLevel } from './adapt.ts'
