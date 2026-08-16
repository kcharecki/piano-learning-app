import { describe, expect, it } from 'vitest'
import { at } from '@core/shared/invariant.ts'
import { seededRng } from '@core/ports/rng.ts'
import { pitchClass, spelledPitchClass } from '@core/theory/pitch.ts'
import { WHOLE, HALF, QUARTER } from '@core/shared/units.ts'
import type { Score, ScoreNote } from '@core/notation/score.ts'
import { defaultParamsForLevel, MAX_GENERATOR_LEVEL } from './levelDefaults.ts'
import { generateMelody, type MidiRange, type RhythmStyle } from './melody.ts'
import { RHYTHM_POOLS } from './rhythmPools.ts'

const LEVELS = Array.from({ length: MAX_GENERATOR_LEVEL }, (_, i) => i + 1)

/** The largest unit (in sixteenth-note units) `style`'s pool can draw in one note. */
function maxRhythmUnit(style: RhythmStyle): number {
  const pool = RHYTHM_POOLS[style]
  let max = 0
  for (let i = 0; i < pool.length; i += 2) max = Math.max(max, at(pool, i))
  return max
}

const BAR_UNITS: Record<string, number> = {
  '4-4': 16,
  '3-4': 12,
  '6-8': 12,
}

function minNotesInBar(rhythm: RhythmStyle, ts: { beats: number; beatType: number }): number {
  const key = `${ts.beats}-${ts.beatType}`
  const barUnits = BAR_UNITS[key]
  if (barUnits === undefined) {
    throw new Error(`levelDefaults.test.ts: unmapped time signature ${key}`)
  }
  return Math.ceil(barUnits / maxRhythmUnit(rhythm))
}

/**
 * The worst case a cadence ever has to close, for a walk confined to `range`
 * in a key whose tonic pitch class is `tonicPc`: the largest distance from
 * ANY position in `range` to the nearest tonic occurrence also inside
 * `range`. This mirrors `generateMelodicLine`'s own `bestDist` exactly
 * (nearest tonic occurrence in range, not range width) — see
 * `levelDefaults.ts`'s module doc, roadmap 5.53 review F3/F6/F7. Range width
 * is a ~2.7x looser over-approximation of this for every row in this table.
 */
function worstCaseNearestTonicDistance(range: MidiRange, tonicPc: number): number {
  const occurrences: number[] = []
  for (let m = range.low; m <= range.high; m++) {
    if (pitchClass(m) === tonicPc) occurrences.push(m)
  }
  let worst = 0
  for (let m = range.low; m <= range.high; m++) {
    let best = Infinity
    for (const t of occurrences) best = Math.min(best, Math.abs(m - t))
    worst = Math.max(worst, best)
  }
  return worst
}

describe('LEVEL_ROWS — cadence reachability', () => {
  it('every non-stepwise level can always cadence: minNotesInLastBar * maxLeap >= worst-case distance to the nearest tonic in range', () => {
    for (const level of LEVELS) {
      const p = defaultParamsForLevel(level)
      if (p.stepwiseOneDirection) continue
      const minNotes = minNotesInBar(p.rhythm, p.timeSignature)
      const tonicPc = spelledPitchClass(p.key.tonic)
      const worstRight = worstCaseNearestTonicDistance(p.rightRange, tonicPc)
      expect(minNotes * p.maxLeapSemitones).toBeGreaterThanOrEqual(worstRight)

      if (p.handIndependence === 'independent' && p.leftRange !== undefined) {
        const worstLeft = worstCaseNearestTonicDistance(p.leftRange, tonicPc)
        expect(minNotes * p.maxLeapSemitones).toBeGreaterThanOrEqual(worstLeft)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// leap ceiling — graded by pedagogy, proven on GENERATED output
// (roadmap 5.53 review F5/F9: the two tests this block replaced asserted
// against the LEVEL_ROWS table itself — one duplicated melody.test.ts's own
// table-based monotonicity check verbatim, the other hardcoded `[1, 2, 3]`
// and so could never see a level move. Neither one engraved a single note.
// These assert the property that actually matters: what the generator
// PRODUCES, sampled over real seeds, for every level and both hands.)
// ---------------------------------------------------------------------------

const SAMPLE_SEEDS = 200

/** Notes for one hand, in a Score's own engraved order. */
function handNotes(score: Score, hand: 'left' | 'right'): readonly ScoreNote[] {
  return score.notes.filter((n) => n.hand === hand)
}

/**
 * `hand`'s melodic pitch sequence, in onset order, with chord tones excluded:
 * an onset where more than one note of the hand fires at once (`'blocked-chords'`
 * hand independence, `generateBlockChords` in `melody.ts`) is a simultaneity,
 * not a melodic step, and `maxLeapSemitones` never governs it — only
 * `generateMelodicLine` and the leap-bounded half of `doubleHand` do.
 */
function monophonicSequence(score: Score, hand: 'left' | 'right'): readonly number[] {
  const byTick = new Map<number, number[]>()
  for (const n of handNotes(score, hand)) {
    const pitches = byTick.get(n.startTick) ?? []
    pitches.push(n.midi)
    byTick.set(n.startTick, pitches)
  }
  const ticks = [...byTick.keys()].sort((a, b) => a - b)
  const out: number[] = []
  for (const tick of ticks) {
    const pitches = byTick.get(tick)
    if (pitches !== undefined && pitches.length === 1) out.push(at(pitches, 0))
  }
  return out
}

/** Every consecutive-pair interval, both hands, chord tones excluded. */
function engravedIntervals(score: Score): readonly number[] {
  const out: number[] = []
  for (const hand of ['right', 'left'] as const) {
    const seq = monophonicSequence(score, hand)
    for (let i = 1; i < seq.length; i++) out.push(Math.abs(at(seq, i) - at(seq, i - 1)))
  }
  return out
}

describe('LEVEL_ROWS — leap ceiling is graded by pedagogy, not just reachability (roadmap 5.53)', () => {
  it('no engraved interval, either hand, chord tones excluded, ever exceeds its level’s declared maxLeapSemitones', () => {
    for (const level of LEVELS) {
      const params = defaultParamsForLevel(level)
      for (let seed = 0; seed < SAMPLE_SEEDS; seed++) {
        const result = generateMelody(params, seededRng(seed))
        if (!result.ok) continue
        for (const interval of engravedIntervals(result.value)) {
          expect(interval).toBeLessThanOrEqual(params.maxLeapSemitones)
        }
      }
    }
  })

  /**
   * The pedagogical ceiling this task exists to enforce (roadmap 5.53):
   * level 1 is stepwise, levels 1-3 never exceed a 5th (7 semitones), and
   * levels 4-6 grade upward from there. Hardcoded here — NOT read from
   * `LEVEL_ROWS`/`defaultParamsForLevel` — because the generator now
   * faithfully enforces whatever `maxLeapSemitones` a level declares (that
   * is the F1/F2 fix): comparing engraved output back against the SAME
   * (possibly wrong) declared value can never catch the declared value
   * itself being too loose, e.g. level 3 regressing to 10. This is the
   * independent reference the review's re-check exercises.
   */
  const EXPECTED_MAX_LEAP: readonly number[] = [2, 7, 7, 10, 11, 12]

  it('the per-level engraved max leap (both hands, sampled) is non-decreasing across levels, and never exceeds its level’s pedagogical ceiling', () => {
    const maxByLevel = LEVELS.map((level) => {
      const params = defaultParamsForLevel(level)
      let max = 0
      for (let seed = 0; seed < SAMPLE_SEEDS; seed++) {
        const result = generateMelody(params, seededRng(seed))
        if (!result.ok) continue
        for (const interval of engravedIntervals(result.value)) max = Math.max(max, interval)
      }
      return max
    })
    for (let i = 1; i < maxByLevel.length; i++) {
      expect(at(maxByLevel, i)).toBeGreaterThanOrEqual(at(maxByLevel, i - 1))
    }
    for (const level of LEVELS) {
      expect(at(maxByLevel, level - 1)).toBeLessThanOrEqual(at(EXPECTED_MAX_LEAP, level - 1))
    }
  })
})

// ---------------------------------------------------------------------------
// rhythm ladder — engraved duration vocabulary (roadmap 5.54)
// ---------------------------------------------------------------------------

const RHYTHM_SAMPLE_SEEDS = 300

/** The set of `durationTicks` values engraved for `hand`, over `seeds` seeds of `level`. */
function engravedDurationVocabulary(level: number, hand: 'left' | 'right', seeds: number): Set<number> {
  const params = defaultParamsForLevel(level)
  const durations = new Set<number>()
  for (let seed = 0; seed < seeds; seed++) {
    const result = generateMelody(params, seededRng(seed))
    if (!result.ok) continue
    for (const n of handNotes(result.value, hand)) durations.add(n.durationTicks)
  }
  return durations
}

describe('LEVEL_ROWS — rhythm ladder engraves the right note values (roadmap 5.54)', () => {
  it("level 1 ('quarter-half') never engraves a whole note, over 300 seeds — the exact defect this task fixes", () => {
    const durations = engravedDurationVocabulary(1, 'right', RHYTHM_SAMPLE_SEEDS)
    expect(durations.has(WHOLE)).toBe(false)
  })

  it("level 1 ('quarter-half') engraves BOTH quarter and half notes, over 300 seeds", () => {
    const durations = engravedDurationVocabulary(1, 'right', RHYTHM_SAMPLE_SEEDS)
    expect(durations.has(QUARTER)).toBe(true)
    expect(durations.has(HALF)).toBe(true)
  })

  /**
   * The frozen "ladder is monotonic in vocabulary" decision, scoped to the
   * 1 -> 2 step this task actually changes (see `levelDefaults.ts`'s module
   * doc for why 2 -> 3 .. 5 -> 6 are explicitly NOT asserted here yet —
   * `eighths`/`dotted`/`syncopated` predate this task and `eighths` has no
   * half note at all). Proven on ENGRAVED output, not the declared
   * `RHYTHM_POOLS` table, so a bug in `buildBarDurations` or in
   * `generateStepwiseOneDirectionLine`'s use of it would fail this test even
   * if the table itself were correct.
   */
  it("level 1's engraved duration vocabulary is a subset of level 2's, over 300 seeds", () => {
    const level1 = engravedDurationVocabulary(1, 'right', RHYTHM_SAMPLE_SEEDS)
    const level2 = engravedDurationVocabulary(2, 'right', RHYTHM_SAMPLE_SEEDS)
    expect(level1.size).toBeGreaterThan(0)
    for (const d of level1) expect(level2.has(d)).toBe(true)
  })
})

describe('LEVEL_ROWS — hand-range congruency (roadmap 5.11 regression)', () => {
  it("'unison' rows keep left and right ranges the same width, one fixed octave apart", () => {
    // doubleHand's 'unison' path transposes by a SINGLE octave shift computed
    // once from the primary hand's first note. Any row that doesn't keep the
    // two ranges congruent this way still generates without erroring, but
    // silently folds the second hand into whatever octave overlaps instead
    // of tracking the first hand — the defect an earlier draft of this table
    // shipped (right widened to 60..79, left left behind at 48..60).
    for (const level of LEVELS) {
      const p = defaultParamsForLevel(level)
      if (p.handIndependence !== 'unison' || p.leftRange === undefined) continue
      const rightWidth = p.rightRange.high - p.rightRange.low
      const leftWidth = p.leftRange.high - p.leftRange.low
      expect(leftWidth).toBe(rightWidth)
      expect(p.rightRange.low - p.leftRange.low).toBe(p.rightRange.high - p.leftRange.high)
    }
  })

  /**
   * roadmap 5.53b: the `'unison'` check above only covers rows whose
   * `levelDescriptions.ts` prose promises octave doubling. Level 3's own
   * prose ("Both hands move in parallel thirds") is checked by
   * `handIndependence === 'parallel'` here instead — `levelDescriptions.ts`'s
   * own module doc says hand-independence prose describes
   * `generateSecondHand`'s literal per-case behaviour, so `'parallel'` is the
   * field that stands for that sentence, the same way `'unison'` stands for
   * the octave-doubling one above.
   *
   * Unlike the `'unison'` check, this is NOT provable from `LEVEL_ROWS`
   * alone: a `leftRange` can be perfectly plausible-looking on paper and
   * still leave `doubleHand`'s register-correct target unreachable for the
   * high end of `rightRange`, silently degrading "parallel thirds" into
   * "mostly wrong intervals" (5.2% of level 3's engraved simultaneities,
   * before this task — see `levelDefaults.ts`'s own module doc for the
   * measured before/after). So this asserts on GENERATED output, sampled
   * over real seeds, exactly like the leap-ceiling block above.
   */
  it("'parallel' rows engrave a diatonic third (or tenth) between the hands on almost every simultaneity, matching levelDescriptions.ts's promise", () => {
    for (const level of LEVELS) {
      const params = defaultParamsForLevel(level)
      if (params.handIndependence !== 'parallel') continue

      let thirdOrTenth = 0
      let dissonant = 0 // tritone (6) or minor/major 7th (10, 11) — never a "parallel third"
      let total = 0
      for (let seed = 0; seed < SAMPLE_SEEDS; seed++) {
        const result = generateMelody(params, seededRng(seed))
        if (!result.ok) continue
        const right = handNotes(result.value, 'right')
        const left = handNotes(result.value, 'left')
        const leftByTick = new Map<number, number[]>()
        for (const n of left) leftByTick.set(n.startTick, [...(leftByTick.get(n.startTick) ?? []), n.midi])
        const rightByTick = new Map<number, number[]>()
        for (const n of right) rightByTick.set(n.startTick, [...(rightByTick.get(n.startTick) ?? []), n.midi])
        for (const [tick, rPitches] of rightByTick) {
          const lPitches = leftByTick.get(tick)
          // A simultaneity: exactly one note per hand at this tick. `doubleHand`
          // mirrors the primary line's rhythm exactly, so every onset here IS
          // one — this mirrors `verticalIntervals`'s exclusion of chord tones
          // the same way `monophonicSequence` above excludes them for leaps.
          if (lPitches === undefined || rPitches.length !== 1 || lPitches.length !== 1) continue
          const interval = Math.abs((rPitches[0] as number) - (lPitches[0] as number))
          total += 1
          if (interval === 3 || interval === 4 || interval === 15 || interval === 16) thirdOrTenth += 1
          if (interval === 6 || interval === 10 || interval === 11) dissonant += 1
        }
      }
      expect(total).toBeGreaterThan(0)
      // Pinned to what was actually measured for level 3's re-graded
      // leftRange (roadmap 5.53b, `scratchpad-vertical-probe.ts`, 200 seeds,
      // not committed): 99.8% thirds/tenths, 0 tritones/7ths out of 8907
      // simultaneities. Thresholds sit with margin below/above that so the
      // test isn't flaky on a different sample, but ABOVE the old `48..67`
      // leftRange's own measured baseline (94.7% thirds/tenths, 78
      // tritones/8907) — reverting `levelDefaults.ts`'s level-3 leftRange
      // back to `48..67` fails both assertions below (hand-verified).
      expect(thirdOrTenth / total).toBeGreaterThanOrEqual(0.97)
      expect(dissonant).toBe(0)
    }
  })
})
