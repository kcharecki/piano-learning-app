/**
 * The Reed-style level ladder for one-line rhythm reading (DR-11). Pedagogy
 * lives here as DATA — each level is a name, a learner-facing sentence, and a
 * vocabulary of `cells.ts` cell ids — never as branching code, so the
 * research digest's progression can be audited by reading this file top to
 * bottom and so `generate.test.ts`'s monotonicity property
 * (`cellIds(n) ⊃ cellIds(n-1)`) has a single table to check against.
 *
 * Levels are strictly cumulative: nothing is ever retired, because a learner
 * who has mastered syncopation should still see quarter notes turn up in the
 * mix. `cellsForLevel` is what the generator (`generate.ts`) actually reads;
 * `READING_LEVELS` is the source of truth it is derived from.
 */
import { invariant } from '@core/shared/invariant.ts'
import { RHYTHM_CELLS, type RhythmCell } from './cells.ts'

export type ReadingLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7

export const MIN_READING_LEVEL: ReadingLevel = 1
export const MAX_READING_LEVEL: ReadingLevel = 7

export function isReadingLevel(value: number): value is ReadingLevel {
  return Number.isInteger(value) && value >= MIN_READING_LEVEL && value <= MAX_READING_LEVEL
}

export type ReadingLevelSpec = {
  readonly level: ReadingLevel
  readonly name: string
  /** Learner-facing sentence, authored data — used by the app header (DR-11). */
  readonly description: string
  /** Cumulative: level n's list is a strict superset of level n-1's. */
  readonly cellIds: readonly string[]
}

const L1_CELLS = ['q_note', 'q_rest']
const L2_CELLS = [...L1_CELLS, 'ee']
const L3_CELLS = [...L2_CELLS, 'rest_e', 'e_rest']
const L4_CELLS = [...L3_CELLS, 'ssss', 'e_ss', 'ss_e']
const L5_CELLS = [...L4_CELLS, 'de_s', 's_de', 'dq_e']
const L6_CELLS = [...L5_CELLS, 'triplet']
const L7_CELLS = [...L6_CELLS, 'sync_a', 'sync_b']

export const READING_LEVELS: readonly ReadingLevelSpec[] = [
  {
    level: 1,
    name: 'Quarters',
    description: 'Quarters: one note or one silence per beat.',
    cellIds: L1_CELLS,
  },
  {
    level: 2,
    name: 'Eighths',
    description: 'Eighths: a beat can split into two even notes.',
    cellIds: L2_CELLS,
  },
  {
    level: 3,
    name: 'Eighth rests',
    description: 'Eighth rests: the off-beat can be silent.',
    cellIds: L3_CELLS,
  },
  {
    level: 4,
    name: 'Sixteenths',
    description: 'Sixteenths: a beat can split into four, or two plus a faster pair.',
    cellIds: L4_CELLS,
  },
  {
    level: 5,
    name: 'Dotted',
    description: 'Dotted rhythms: a long note leans into a short one, on and off the beat.',
    cellIds: L5_CELLS,
  },
  {
    level: 6,
    name: 'Triplets',
    description: 'Triplets: three even notes fit in one beat.',
    cellIds: L6_CELLS,
  },
  {
    level: 7,
    name: 'Syncopation',
    description: 'Syncopation: a note can start off the beat and hold across it.',
    cellIds: L7_CELLS,
  },
]

const LEVEL_BY_NUMBER: ReadonlyMap<ReadingLevel, ReadingLevelSpec> = new Map(
  READING_LEVELS.map((spec) => [spec.level, spec]),
)

function specFor(level: ReadingLevel): ReadingLevelSpec {
  const spec = LEVEL_BY_NUMBER.get(level)
  invariant(spec !== undefined, `no ReadingLevelSpec for level ${level}`)
  return spec
}

/** The cell vocabulary available at `level`, resolved from `RHYTHM_CELLS`. Throws on a bad id. */
export function cellsForLevel(level: ReadingLevel): readonly RhythmCell[] {
  return specFor(level).cellIds.map((id) => {
    const cell = RHYTHM_CELLS[id]
    invariant(cell !== undefined, `level ${level} references unknown cell id "${id}"`)
    return cell
  })
}

/** The learner-facing sentence for `level` — used by the app header (DR-11). */
export function describeReadingLevel(level: ReadingLevel): string {
  return specFor(level).description
}
