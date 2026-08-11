import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { generateRhythm, type RhythmPattern } from '@core/generator/rhythm.ts'
import { seededRng } from '@core/ports/rng.ts'
import { makeTempoMap, tickToMs, type TempoMap } from '@core/timing/tempo.ts'
import { millis, ticks, type Millis } from '@core/shared/units.ts'
import { gradeClapback, DEFAULT_MAX_TEMPO_SCALE, type ClapbackLevel } from './clapback.ts'

const LEVELS = [1, 2, 3, 4, 5] as const satisfies readonly ClapbackLevel[]

const defaultTempo = (): TempoMap => makeTempoMap([])

function expectedOnsetMs(pattern: RhythmPattern, tempo: TempoMap): number[] {
  return pattern.onsets
    .filter((o) => !o.isRest)
    .map((o) => Number(tickToMs(tempo, o.tick)))
    .sort((a, b) => a - b)
}

/**
 * Draws a pattern with at least `min` real (non-rest) onsets, growing `bars`
 * until it clears the floor — mirrors the bar-growth retry
 * `core/eartraining/dictation.ts` uses for the same reason (a rest-heavy or
 * short draw can legitimately fall short of a target note count). Rests are
 * forced off so the retry is guaranteed to terminate: every bar then
 * contributes at least one real onset.
 */
function patternWithAtLeast(min: number, level: ClapbackLevel, seed: number): RhythmPattern {
  for (let bars = 1; bars <= 8; bars++) {
    const pattern = generateRhythm(
      {
        bars,
        timeSignature: { beats: 4, beatType: 4 },
        complexity: level,
        allowRests: false,
        allowTies: level >= 4,
      },
      seededRng(seed),
    )
    const count = pattern.onsets.filter((o) => !o.isRest).length
    if (count >= min) return pattern
  }
  throw new Error(`patternWithAtLeast: could not reach ${min} onsets for level ${level}, seed ${seed}`)
}

const seedArb = fc.integer({ min: 1, max: 5000 })
const levelArb = fc.constantFrom(...LEVELS)

describe('gradeClapback — perfect taps', () => {
  it('a perfect tap sequence scores full accuracy, zero deviation, tempoScale 1', () => {
    fc.assert(
      fc.property(levelArb, seedArb, (level, seed) => {
        const pattern = patternWithAtLeast(1, level, seed)
        const tempo = defaultTempo()
        const taps = expectedOnsetMs(pattern, tempo).map((ms) => millis(ms))

        const grade = gradeClapback(pattern, taps, tempo, level)

        expect(grade.matched).toBe(taps.length)
        expect(grade.missed).toBe(0)
        expect(grade.extra).toBe(0)
        expect(grade.accuracy).toBe(1)
        expect(grade.meanAbsDeviationMs).toBe(0)
        expect(grade.tempoScale).toBe(1)
      }),
      { numRuns: 200 },
    )
  })

  it('scores 1 with nothing expected and nothing tapped, for every level', () => {
    const empty: RhythmPattern = {
      timeSignature: { beats: 4, beatType: 4 },
      bars: 1,
      onsets: [{ tick: ticks(0), durationTicks: ticks(1920), isRest: true }],
    }
    const tempo = defaultTempo()
    for (const level of LEVELS) {
      const grade = gradeClapback(empty, [], tempo, level)
      expect(grade.accuracy).toBe(1)
      expect(grade.meanAbsDeviationMs).toBe(0)
      expect(grade.matched).toBe(0)
    }
  })
})

describe('gradeClapback — tempo-scale robustness (roadmap 3.21, mirrors dictation roadmap 3.23)', () => {
  it('a phrase tapped at a single consistent tempo within the forgiven band still scores full accuracy', () => {
    fc.assert(
      fc.property(
        levelArb,
        seedArb,
        // Comfortably inside [1/1.15, 1.15] on both sides.
        fc.double({ min: 0.88, max: 1.13, noNaN: true }),
        (level, seed, scale) => {
          const pattern = patternWithAtLeast(2, level, seed)
          const tempo = defaultTempo()
          const onsets = expectedOnsetMs(pattern, tempo)
          const anchor = onsets[0] as number
          const taps = onsets.map((ms) => millis(anchor + scale * (ms - anchor)))

          const grade = gradeClapback(pattern, taps, tempo, level)

          expect(grade.matched).toBe(taps.length)
          expect(grade.missed).toBe(0)
          expect(grade.extra).toBe(0)
          expect(grade.accuracy).toBe(1)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('a tempo difference outside the forgiven band is never rescued — it grades as real timing error', () => {
    fc.assert(
      fc.property(levelArb, seedArb, (level, seed) => {
        const pattern = patternWithAtLeast(3, level, seed)
        const tempo = defaultTempo()
        const onsets = expectedOnsetMs(pattern, tempo)
        const anchor = onsets[0] as number
        // Double speed: no clamp lets this pass as "the same rhythm, just faster".
        const taps = onsets.map((ms) => millis(anchor + 2 * (ms - anchor)))

        const grade = gradeClapback(pattern, taps, tempo, level)

        expect(grade.accuracy).toBeLessThan(1)
      }),
      { numRuns: 100 },
    )
  })

  it('maxTempoScale: 1 pins the grading to the pattern-s own tempo exactly, undoing the forgiveness', () => {
    const level: ClapbackLevel = 3
    const pattern = patternWithAtLeast(3, level, 42)
    const tempo = defaultTempo()
    const onsets = expectedOnsetMs(pattern, tempo)
    const anchor = onsets[0] as number
    const taps = onsets.map((ms) => millis(anchor + 1.08 * (ms - anchor)))

    const forgiven = gradeClapback(pattern, taps, tempo, level)
    const pinned = gradeClapback(pattern, taps, tempo, level, { maxTempoScale: 1 })

    expect(forgiven.accuracy).toBe(1)
    expect(pinned.tempoScale).toBe(1)
    // Pinning removes the very forgiveness that made `forgiven` perfect —
    // this is the one case in the file where degrading is the correct proof.
    expect(pinned.accuracy).toBeLessThanOrEqual(forgiven.accuracy)
  })

  it('a constant additive offset (played consistently LATE, not at a different tempo) is never absorbed as tempo', () => {
    const level: ClapbackLevel = 2
    const pattern = patternWithAtLeast(3, level, 7)
    const tempo = defaultTempo()
    const onsets = expectedOnsetMs(pattern, tempo)
    // Shifted well outside the level's own tolerance window, uniformly — a
    // pure offset, not a stretch, so `fitTempoScale`'s own gap-based fit must
    // land on 1 and leave this genuinely wrong.
    const taps = onsets.map((ms) => millis(ms + 500))

    const grade = gradeClapback(pattern, taps, tempo, level)

    expect(grade.tempoScale).toBe(1)
    expect(grade.accuracy).toBeLessThan(1)
  })
})

describe('gradeClapback — extra and missed taps', () => {
  it('a phrase with one extra tap (far from any onset) is not a correct answer', () => {
    fc.assert(
      fc.property(levelArb, seedArb, (level, seed) => {
        const pattern = patternWithAtLeast(1, level, seed)
        const tempo = defaultTempo()
        const onsets = expectedOnsetMs(pattern, tempo)
        const lastOnset = onsets[onsets.length - 1] as number
        // Far past the end of the phrase and past any tolerance window at
        // any level (the largest is level 1's 160-tick/~333ms-at-120bpm).
        const taps = [...onsets, lastOnset + 5000].map((ms) => millis(ms))

        const grade = gradeClapback(pattern, taps, tempo, level)

        expect(grade.matched).toBe(onsets.length)
        expect(grade.extra).toBe(1)
        expect(grade.missed).toBe(0)
        expect(grade.accuracy).toBeLessThan(1)
      }),
      { numRuns: 200 },
    )
  })

  it('a dropped tap is exactly one missed, never cascades into the rest', () => {
    fc.assert(
      fc.property(levelArb, seedArb, (level, seed) => {
        const pattern = patternWithAtLeast(2, level, seed)
        const tempo = defaultTempo()
        const onsets = expectedOnsetMs(pattern, tempo)
        const taps = onsets.slice(1).map((ms) => millis(ms))

        const grade = gradeClapback(pattern, taps, tempo, level)

        expect(grade.matched).toBe(taps.length)
        expect(grade.missed).toBe(1)
        expect(grade.extra).toBe(0)
      }),
      { numRuns: 200 },
    )
  })

  it('taps against an all-rest pattern are all extra, accuracy 0', () => {
    const restOnly = generateRhythm(
      { bars: 1, timeSignature: { beats: 4, beatType: 4 }, complexity: 1, allowRests: false, allowTies: false },
      seededRng(1),
    )
    const empty: RhythmPattern = {
      ...restOnly,
      onsets: restOnly.onsets.map((o) => ({ ...o, isRest: true })),
    }
    const tempo = defaultTempo()
    const grade = gradeClapback(empty, [millis(0), millis(500)], tempo, 1)
    expect(grade.matched).toBe(0)
    expect(grade.missed).toBe(0)
    expect(grade.extra).toBe(2)
    expect(grade.accuracy).toBe(0)
  })
})

describe('gradeClapback — order independence', () => {
  it('shuffled taps grade identically to the same taps in order', () => {
    fc.assert(
      fc.property(levelArb, seedArb, (level, seed) => {
        const pattern = patternWithAtLeast(2, level, seed)
        const tempo = defaultTempo()
        const onsets = expectedOnsetMs(pattern, tempo)
        const inOrder = onsets.map((ms) => millis(ms))
        const shuffled = [...onsets].reverse().map((ms) => millis(ms))

        expect(gradeClapback(pattern, shuffled, tempo, level)).toEqual(
          gradeClapback(pattern, inOrder, tempo, level),
        )
      }),
      { numRuns: 100 },
    )
  })
})

describe('gradeClapback — level-scaled tolerance', () => {
  it('the tolerance window strictly narrows as level rises', () => {
    // A single onset, isolated from any neighbour, so a deviated tap can only
    // ever match (or not) that one onset — no ambiguity from a nearby onset
    // absorbing it instead, which a busy level-5 pattern would otherwise risk.
    const isolated: RhythmPattern = {
      timeSignature: { beats: 4, beatType: 4 },
      bars: 1,
      onsets: [{ tick: ticks(0), durationTicks: ticks(1920), isRest: false }],
    }
    const tempo = defaultTempo()
    const deviation = 100 // between level 5's ~40-tick (~42ms) and level 1's 160-tick (~167ms) window

    const grade1 = gradeClapback(isolated, [millis(deviation)], tempo, 1)
    expect(grade1.matched).toBe(1)

    const grade5 = gradeClapback(isolated, [millis(deviation)], tempo, 5)
    expect(grade5.matched).toBe(0)
  })

  it('accepts an explicit toleranceTicks override', () => {
    const pattern = patternWithAtLeast(1, 3, 9)
    const tempo = defaultTempo()
    const onset = expectedOnsetMs(pattern, tempo)[0] as number
    const taps = [millis(onset + 60)]
    expect(gradeClapback(pattern, taps, tempo, 3, { toleranceTicks: ticks(200) }).matched).toBe(1)
    expect(gradeClapback(pattern, taps, tempo, 3, { toleranceTicks: ticks(5) }).matched).toBe(0)
  })
})

describe('gradeClapback — invariants', () => {
  it('throws on a negative toleranceTicks or a maxTempoScale below 1', () => {
    const pattern = patternWithAtLeast(1, 2, 1)
    const tempo = defaultTempo()
    const taps: readonly Millis[] = [millis(0)]
    expect(() =>
      gradeClapback(pattern, taps, tempo, 2, { toleranceTicks: ticks(-1) }),
    ).toThrow()
    expect(() => gradeClapback(pattern, taps, tempo, 2, { maxTempoScale: 0.5 })).toThrow()
  })

  it('DEFAULT_MAX_TEMPO_SCALE is greater than 1 (some forgiveness by default)', () => {
    expect(DEFAULT_MAX_TEMPO_SCALE).toBeGreaterThan(1)
  })
})
