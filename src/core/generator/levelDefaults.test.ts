import { describe, expect, it } from 'vitest'
import { defaultParamsForLevel, MAX_GENERATOR_LEVEL } from './levelDefaults.ts'

const LEVELS = Array.from({ length: MAX_GENERATOR_LEVEL }, (_, i) => i + 1)

/**
 * Mirrors `melody.ts`'s `RHYTHM_POOLS` maxima and `GRID`-unit bar sizes —
 * duplicated here (not imported) because this is a property of the DATA in
 * `LEVEL_ROWS`, checked independently of the generator's own internals, the
 * same way an adversarial reviewer re-derives it by hand rather than trusting
 * the implementation under test.
 */
const RHYTHM_MAX_UNIT: Record<string, number> = {
  'whole-half': 16,
  quarters: 8,
  eighths: 4,
  dotted: 6,
  syncopated: 4,
}
const BAR_UNITS: Record<string, number> = {
  '4-4': 16,
  '3-4': 12,
  '6-8': 12,
}

function minNotesInBar(rhythm: string, ts: { beats: number; beatType: number }): number {
  const key = `${ts.beats}-${ts.beatType}`
  const barUnits = BAR_UNITS[key]
  const maxUnit = RHYTHM_MAX_UNIT[rhythm]
  if (barUnits === undefined || maxUnit === undefined) {
    throw new Error(`levelDefaults.test.ts: unmapped rhythm/time-signature ${rhythm} ${key}`)
  }
  return Math.ceil(barUnits / maxUnit)
}

describe('LEVEL_ROWS — cadence reachability', () => {
  it('every non-stepwise level can always cadence: minNotesInLastBar * maxLeap >= range width', () => {
    for (const level of LEVELS) {
      const p = defaultParamsForLevel(level)
      if (p.stepwiseOneDirection) continue
      const minNotes = minNotesInBar(p.rhythm, p.timeSignature)
      const width = p.rightRange.high - p.rightRange.low
      expect(minNotes * p.maxLeapSemitones).toBeGreaterThanOrEqual(width)

      if (p.handIndependence === 'independent' && p.leftRange !== undefined) {
        const leftWidth = p.leftRange.high - p.leftRange.low
        expect(minNotes * p.maxLeapSemitones).toBeGreaterThanOrEqual(leftWidth)
      }
    }
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
})
