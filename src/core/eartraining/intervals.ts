/**
 * Melodic and harmonic interval recognition by ear (REQ-3.6.1).
 *
 * ## Level progression (roadmap 5.30)
 *
 * Pinned by the tests below. Each level's set is the previous level's set
 * plus its own additions — `intervalsForLevel` is built as a cumulative
 * concatenation, so it is monotonic by construction:
 *
 *   1: M3, m3                               — RCM's own Level 1 pair.
 *   2: + P5                                 — RCM Level 2.
 *   3: + P4                                 — RCM Level 3.
 *   4: + P8 (the octave)                    — RCM Level 4.
 *   5: + M2, m2, M6, m6, M7, m7, the tritone (spelled A4), and the compound
 *      (+ octave) of every interval unlocked through level 4 except the
 *      octave itself (compounding P8 would only give P15, which teaches
 *      nothing a plain octave doesn't) — every interval RCM's later grades
 *      introduce, folded into one final tier since this drill's own level
 *      ladder caps at 5 and RCM's source material does not specify a finer
 *      within-tier order for the rest.
 *
 * Levels above 5 return the level-5 set; there is nothing further to unlock.
 *
 * This ordering follows the Royal Conservatory of Music (RCM) syllabus, and
 * is a DEFENSIBLE CHOICE, not the only reasonable one: Trinity's grade books
 * introduce every interval from a 2nd through a 6th together at their first
 * grade, and Musical U's own ear-training curriculum argues for teaching 2nds
 * before 3rds on the grounds that a 2nd is the smallest, most-heard melodic
 * step. RCM is picked here because m3/M3 (thirds) are, by ear, the easiest
 * pair to tell apart AND the interval most learners already have some
 * association with (a "sad" vs "happy" third) before they ever start
 * ear training, which is why RCM leads its own syllabus with them rather
 * than the smaller-but-less-recognisable 2nd. A future session with evidence
 * that a different ordering measurably teaches faster should feel free to
 * change this — the tiers exist precisely so that decision lives in one
 * place.
 *
 * Grading compares semitones, not spelling: an augmented second and a minor
 * third sound identical, and this is an EAR drill, so marking `A2` wrong when
 * the learner heard three semitones would be a bug, not strictness. Direction
 * is a different story: the contract requires it to match, so
 * `gradeIntervalAnswer` also takes the learner's claimed `direction`
 * (defaulting to ascending, since {@link Interval} itself — by construction,
 * `makeInterval` rejects `number < 1` — carries no sign) and compares it
 * against the sign encoded in `item.answerKey`.
 */
import { at, invariant } from '@core/shared/invariant.ts'
import type { EarGrade, EarItem, EarItemKind } from '@core/eartraining/item.ts'
import { type Hand, makeScore } from '@core/notation/score.ts'
import { pick, randomInt, type Rng } from '@core/ports/rng.ts'
import {
  type Interval,
  type IntervalQuality,
  intervalName,
  makeInterval,
  parseInterval,
} from '@core/theory/intervals.ts'
import { HALF, type Midi, midi, QUARTER } from '@core/shared/units.ts'

const MIDDLE_C = 60

// ---------------------------------------------------------------------------
// level vocabulary
// ---------------------------------------------------------------------------

/** Only for pairs already known to be legal — every one below is exercised by the tests. */
function iv(number: number, quality: IntervalQuality): Interval {
  const result = makeInterval(number, quality)
  invariant(result.ok, `eartraining/intervals: illegal interval ${quality} ${number}`)
  return result.value
}

/** Same interval, an octave higher: same quality, number + 7 — always a legal pair. */
function compound(i: Interval): Interval {
  return iv(i.number + 7, i.quality)
}

const P5 = iv(5, 'perfect')
const P8 = iv(8, 'perfect')
const M3 = iv(3, 'major')
const m3 = iv(3, 'minor')
const M2 = iv(2, 'major')
const m2 = iv(2, 'minor')
const P4 = iv(4, 'perfect')
const M6 = iv(6, 'major')
const m6 = iv(6, 'minor')
const M7 = iv(7, 'major')
const m7 = iv(7, 'minor')
const TRITONE = iv(4, 'augmented')

const LEVEL_1_INTERVALS: readonly Interval[] = [M3, m3]
const LEVEL_2_INTERVALS: readonly Interval[] = [...LEVEL_1_INTERVALS, P5]
const LEVEL_3_INTERVALS: readonly Interval[] = [...LEVEL_2_INTERVALS, P4]
const LEVEL_4_INTERVALS: readonly Interval[] = [...LEVEL_3_INTERVALS, P8]
const LEVEL_5_INTERVALS: readonly Interval[] = [
  ...LEVEL_4_INTERVALS,
  M2,
  m2,
  M6,
  m6,
  M7,
  m7,
  TRITONE,
  ...LEVEL_4_INTERVALS.filter((i) => i.number !== 8).map(compound),
]

const INTERVALS_BY_LEVEL: readonly (readonly Interval[])[] = [
  LEVEL_1_INTERVALS,
  LEVEL_2_INTERVALS,
  LEVEL_3_INTERVALS,
  LEVEL_4_INTERVALS,
  LEVEL_5_INTERVALS,
]

/** The intervals a level draws from — level 1 is the small, easy, common ones. */
export function intervalsForLevel(level: number): readonly Interval[] {
  invariant(
    Number.isInteger(level) && level >= 1,
    `intervalsForLevel: level must be a positive integer, got ${level}`,
  )
  const index = Math.min(level, INTERVALS_BY_LEVEL.length) - 1
  return at(INTERVALS_BY_LEVEL, index)
}

// ---------------------------------------------------------------------------
// item generation
// ---------------------------------------------------------------------------

export type IntervalItemOptions = {
  /** Both notes together (harmonic) or one after the other (melodic). */
  readonly harmonic: boolean
  /** MIDI range the lower note is drawn from. Defaults to a comfortable middle register. */
  readonly range?: { readonly low: Midi; readonly high: Midi }
  /** Descending intervals become possible above level 1; pass false to force ascending. */
  readonly allowDescending?: boolean
}

/** C3..C5 — comfortable middle register, well clear of the keyboard's ends either way. */
const DEFAULT_RANGE = { low: midi(48), high: midi(72) }

/**
 * Ascending always at level 1 (the decision this drill teaches first) and
 * always for a harmonic item — both notes sound at tick 0, so there is no
 * first note, no second note, and nothing for direction to describe. A coin
 * flip otherwise, above level 1.
 */
function pickDirection(level: number, opts: IntervalItemOptions, rng: Rng): 1 | -1 {
  const allowed = !opts.harmonic && level > 1 && opts.allowDescending !== false
  if (!allowed) return 1
  return randomInt(rng, 0, 1) === 0 ? 1 : -1
}

export function generateIntervalItem(level: number, opts: IntervalItemOptions, rng: Rng): EarItem {
  const range = opts.range ?? DEFAULT_RANGE
  invariant(
    range.low <= range.high,
    `generateIntervalItem: range.low (${range.low}) must be <= range.high (${range.high})`,
  )
  const pool = intervalsForLevel(level).filter(
    (i) => range.low + i.semitones <= 127 && range.low <= Math.min(range.high, 127 - i.semitones),
  )
  invariant(
    pool.length > 0,
    `generateIntervalItem: range ${range.low}..${range.high} cannot fit any level-${level} interval`,
  )
  const interval = pick(rng, pool)
  const direction = pickDirection(level, opts, rng)

  const maxLow = Math.min(range.high, 127 - interval.semitones)
  const lowMidi = midi(randomInt(rng, range.low, maxLow))
  const highMidi = midi(lowMidi + interval.semitones)
  const hand: Hand = lowMidi >= MIDDLE_C ? 'right' : 'left'

  const kind: EarItemKind = opts.harmonic ? 'interval-harmonic' : 'interval-melodic'
  const id = `${kind}:${lowMidi}:${highMidi}:${direction === -1 ? 'desc' : 'asc'}`
  const answerKey = `${direction === -1 ? '-' : ''}${intervalName(interval)}`

  const prompt = opts.harmonic
    ? makeScore({
        id,
        measures: [{}],
        notes: [
          { midi: lowMidi, startTick: 0, durationTicks: HALF, hand, staff: 1 },
          { midi: highMidi, startTick: 0, durationTicks: HALF, hand, staff: 1 },
        ],
      })
    : makeScore({
        id,
        measures: [{}],
        notes: [
          {
            midi: direction === 1 ? lowMidi : highMidi,
            startTick: 0,
            durationTicks: QUARTER,
            hand,
            staff: 1,
          },
          {
            midi: direction === 1 ? highMidi : lowMidi,
            startTick: QUARTER,
            durationTicks: QUARTER,
            hand,
            staff: 1,
          },
        ],
      })

  // The lower note anchors the tonal context (roadmap 5.28) — an interval
  // item has no real key, so the lower note itself is the most honest thing
  // to call "the tonic" here: it is the note the learner's ear settles on
  // before the interval moves away from it.
  return { id, kind, prompt, answerKey, level, contextTonicMidi: lowMidi }
}

// ---------------------------------------------------------------------------
// grading
// ---------------------------------------------------------------------------

/** The interval an `answerKey` names, direction stripped — `parseInterval` never sees the sign. */
function intervalFromAnswerKey(key: string): Interval {
  const unsigned = key.startsWith('-') ? key.slice(1) : key
  const parsed = parseInterval(unsigned)
  invariant(parsed.ok, `eartraining/intervals: answerKey '${key}' is not a valid interval name`)
  return parsed.value
}

/** -1 if the answerKey carries the descending sign, 1 otherwise. */
function directionOf(answerKey: string): 1 | -1 {
  return answerKey.startsWith('-') ? -1 : 1
}

/**
 * Grade an answer. Aurally identical spellings count as correct — see the
 * module comment. `direction` is the learner's claim about which way the
 * interval went (ascending by default); it must match the item's own
 * direction for the answer to be marked correct, and `given` carries the same
 * '-' sign convention as `expected` so the two read as comparable strings.
 */
export function gradeIntervalAnswer(
  item: EarItem,
  answer: Interval,
  direction: 1 | -1 = 1,
): EarGrade {
  const expected = intervalFromAnswerKey(item.answerKey)
  const correct =
    answer.semitones === expected.semitones && directionOf(item.answerKey) === direction
  return {
    correct,
    expected: item.answerKey,
    given: `${direction === -1 ? '-' : ''}${intervalName(answer)}`,
  }
}
