import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { generateRhythm, type RhythmPattern } from '@core/generator/rhythm.ts'
import { seededRng } from '@core/ports/rng.ts'
import { makeTempoMap, tickToMs, type TempoMap } from '@core/timing/tempo.ts'
import { bpm, millis, ticks, type Millis } from '@core/shared/units.ts'
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
 * short draw can legitimately fall short of a target note count).
 *
 * `allowRests` defaults to `false` (rests off), which is what guarantees the
 * retry terminates — every bar then contributes at least one real onset. When
 * `true` (MINOR-5 review finding: production always calls `generateRhythm`
 * with `allowRests: true` — `useClapbackDrill.ts` — but every property test
 * here used to draw with rests forced off, so the rest-filtering path at
 * `clapback.ts:120` was covered only by two hand-built all-rest fixtures)
 * growing `bars` up to 8 still terminates in every practical case: an entire
 * multi-bar draw landing all-rest is the same vanishingly small-odds event
 * `generateNonEmptyPattern`'s own review finding (MINOR-4,
 * `useClapbackDrill.ts`) measured directly (59/3000 seeds at level 2, 7/3000
 * at level 3, for a single bar).
 */
function patternWithAtLeast(
  min: number,
  level: ClapbackLevel,
  seed: number,
  allowRests = false,
): RhythmPattern {
  for (let bars = 1; bars <= 8; bars++) {
    const pattern = generateRhythm(
      {
        bars,
        timeSignature: { beats: 4, beatType: 4 },
        complexity: level,
        allowRests,
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
const allowRestsArb = fc.boolean()

describe('gradeClapback — perfect taps', () => {
  // MINOR-5 review finding: `allowRestsArb` covers both `allowRests: false`
  // (the old fixed behaviour) and `true` (production's actual
  // `useClapbackDrill.ts` call) — a pattern containing rests used to never
  // reach any property test here at all.
  it('a perfect tap sequence scores full accuracy, zero deviation, tempoScale 1', () => {
    fc.assert(
      fc.property(levelArb, seedArb, allowRestsArb, (level, seed, allowRests) => {
        const pattern = patternWithAtLeast(1, level, seed, allowRests)
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

  // MINOR-6 review finding: the double-speed property test above only ever
  // asserted `accuracy < 1`, which any implementation that merely never
  // returns 1 satisfies — and there was no half-speed test at all. These pin
  // exact numbers on a fixed seed instead, so a regression that still grades
  // "less than perfect" but at the wrong magnitude, or a half-speed fit that
  // stops landing on the tempo-scale clamp, would actually fail.
  it('double speed pins an exact, well-below-1 accuracy with no tempo-scale forgiveness', () => {
    const level: ClapbackLevel = 3
    const pattern = patternWithAtLeast(8, level, 208)
    const tempo = defaultTempo()
    const onsets = expectedOnsetMs(pattern, tempo)
    const anchor = onsets[0] as number
    const taps = onsets.map((ms) => millis(anchor + 2 * (ms - anchor)))

    const grade = gradeClapback(pattern, taps, tempo, level)

    expect(grade.tempoScale).toBe(1)
    expect(grade.accuracy).toBeCloseTo(0.3, 10)
  })

  it('half speed pins its fitted tempoScale to the clamp (1/DEFAULT_MAX_TEMPO_SCALE) and an exact accuracy', () => {
    const level: ClapbackLevel = 3
    const pattern = patternWithAtLeast(8, level, 208)
    const tempo = defaultTempo()
    const onsets = expectedOnsetMs(pattern, tempo)
    const anchor = onsets[0] as number
    const taps = onsets.map((ms) => millis(anchor + 0.5 * (ms - anchor)))

    const grade = gradeClapback(pattern, taps, tempo, level)

    expect(grade.tempoScale).toBeCloseTo(1 / DEFAULT_MAX_TEMPO_SCALE, 10)
    expect(grade.accuracy).toBeCloseTo(0.4444444444444444, 10)
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

describe('gradeClapback — the tolerance window is genuinely tempo-scaled, not a flat ms number (MAJOR-2 review finding)', () => {
  // Confirmed surviving mutant (roadmap 3.21 review): replacing
  // `clapback.ts`'s `Number(tickToMs(tempo, toleranceTicks))` with plain
  // `Number(toleranceTicks)` — deleting the tick->ms conversion, i.e. treating
  // a TICK count as though it were already a MILLISECOND count — left every
  // existing test in this file green, because every one of them used
  // `defaultTempo()` (120bpm), and 120bpm is the one tempo at which that
  // particular substitution happens to be off by a merely-quantitative factor
  // that no existing assertion pinned tightly enough to notice. It is not
  // off by a constant factor at every tempo (the real conversion is
  // `ticks * 125 / bpm`), so the same absolute-ms tap grades differently
  // depending on tempo under the real implementation, and identically
  // (tempo-blind) under the mutant — that difference is what this pins.
  it('the identical isolated tap grades matched at 60bpm and unmatched at 200bpm, for the SAME level-1 tolerance window', () => {
    const isolated: RhythmPattern = {
      timeSignature: { beats: 4, beatType: 4 },
      bars: 1,
      onsets: [{ tick: ticks(0), durationTicks: ticks(1920), isRest: false }],
    }
    // Level 1's window is 160 ticks (BASE_TOLERANCE_TICKS[1], clapback.ts).
    // At 60bpm that is 160 * 125/60 ≈ 333ms; at 200bpm it is 160 * 125/200 = 100ms.
    const slow = makeTempoMap([{ tick: ticks(0), bpm: bpm(60) }])
    const fast = makeTempoMap([{ tick: ticks(0), bpm: bpm(200) }])

    // 250ms is inside the 60bpm window (~333ms) but outside the mutant's flat
    // 160ms one.
    expect(gradeClapback(isolated, [millis(250)], slow, 1).matched).toBe(1)
    // 130ms is outside the 200bpm window (100ms) but inside the mutant's flat
    // 160ms one.
    expect(gradeClapback(isolated, [millis(130)], fast, 1).matched).toBe(0)
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
      fc.property(levelArb, seedArb, allowRestsArb, (level, seed, allowRests) => {
        const pattern = patternWithAtLeast(2, level, seed, allowRests)
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

describe('gradeClapback — matching prefers the globally nearest pairing, not first-onset-first (MAJOR-3 review finding)', () => {
  // Confirmed surviving mutant (roadmap 3.21 review): changing the candidate
  // sort's primary key from `a.dist - b.dist` to `a.ei - b.ei` — turning the
  // global-nearest-first greedy into a first-onset-first greedy, a genuinely
  // different matching algorithm — left every existing test in this file
  // green, because none of them ever put two onsets in genuine CONTEST over
  // one tap (a tap within tolerance of both, closer to one, while the OTHER
  // onset's only other candidate lies even farther). This fixture
  // manufactures exactly that contest.
  it('the earlier onset takes its own farther candidate, leaving the later onset the shared near one — global-nearest, not onset order', () => {
    const pattern: RhythmPattern = {
      timeSignature: { beats: 4, beatType: 4 },
      bars: 1,
      onsets: [
        { tick: ticks(0), durationTicks: ticks(240), isRest: false },
        { tick: ticks(480), durationTicks: ticks(240), isRest: false },
      ],
    }
    // 480 ticks is exactly one quarter, i.e. 500ms at the default 120bpm — the
    // two onsets land at 0ms and 500ms.
    const tempo = defaultTempo()
    const toleranceTicks = ticks(384) // 400ms at 120bpm.

    // N (300ms) is within tolerance of BOTH onsets, but genuinely closer to
    // the LATER one (dist 200) than the earlier one (dist 300) — the tap onset
    // 1 actually owns. F (-350ms) is within tolerance of the EARLIER onset
    // only (dist 350, outside onset 1's own 400ms window at dist 850). Global
    // nearest-first assigns N to onset 1 first (dist 200 is the smallest of
    // all four onset/tap distances) and only then gives onset 0 its remaining
    // candidate, F — both match. First-onset-first instead lets onset 0
    // (processed first) grab N — its own nearer local candidate, dist 300 <
    // 350 — stranding onset 1 (F is outside its tolerance) and leaving F
    // itself unused.
    const taps = [millis(-350), millis(300)]

    const grade = gradeClapback(pattern, taps, tempo, 1, { toleranceTicks })

    expect(grade.matched).toBe(2)
    expect(grade.missed).toBe(0)
    expect(grade.extra).toBe(0)
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
