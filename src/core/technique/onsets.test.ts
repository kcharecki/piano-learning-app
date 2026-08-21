import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  CHORD_WINDOW_GAP_FRACTION,
  chordWindowMs,
  describeRoll,
  groupOnsets,
  ROLL_REPORT_MS,
  shortestGapMs,
} from './onsets.ts'
import { techniqueLibrary, techniqueScore } from '@core/technique/library.ts'
import { makeTempoMap, tickToMs } from '@core/timing/tempo.ts'
import { MATCHER_DEFAULTS } from '@core/practice/matcher.ts'

/** The matcher's attribution tolerance, the cap every window is bounded by. */
const TOLERANCE_MS = 150

// ---------------------------------------------------------------------------
// shortestGapMs
// ---------------------------------------------------------------------------

describe('shortestGapMs', () => {
  it('finds the fastest thing the score writes, not the first or the typical', () => {
    // A drill that changes note value part-way through: a window sized off the
    // slow half would swallow the fast half.
    expect(shortestGapMs([0, 1000, 2000, 2100, 3100])).toBe(100)
  })

  it('ignores repeated times — those are one written chord, not a zero gap', () => {
    expect(shortestGapMs([0, 0, 0, 500])).toBe(500)
  })

  it('has no gap to report for one onset or none', () => {
    expect(shortestGapMs([])).toBe(0)
    expect(shortestGapMs([42])).toBe(0)
    expect(shortestGapMs([42, 42])).toBe(0)
  })

  it('property: the answer is always one of the actual gaps, and the smallest', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 5000 }), { minLength: 2, maxLength: 40 }),
        (raw) => {
          const ascending = [...raw].sort((a, b) => a - b)
          const gaps = ascending.slice(1).map((t, i) => t - (ascending[i] ?? 0)).filter((g) => g > 0)
          const answer = shortestGapMs(ascending)
          if (gaps.length === 0) {
            expect(answer).toBe(0)
            return
          }
          expect(answer).toBe(Math.min(...gaps))
        },
      ),
    )
  })
})

// ---------------------------------------------------------------------------
// chordWindowMs
// ---------------------------------------------------------------------------

describe('chordWindowMs', () => {
  it('tracks the tempo instead of sitting at a fixed 80ms', () => {
    // Quarters at the triad drill's ♩=60 — a whole second between onsets, so
    // the cap decides.
    expect(chordWindowMs(1000, TOLERANCE_MS)).toBe(TOLERANCE_MS)
    // Eighth-note triplets at ♩=300: a 66.7ms gap. The old flat 80ms was WIDER
    // than the gap and swallowed notes the score wrote as separate.
    expect(chordWindowMs(200 / 3, TOLERANCE_MS)).toBeCloseTo(100 / 3, 9)
  })

  it('never reaches the next written onset, so two written notes cannot merge', () => {
    // The fast end's bug, stated as an example before it is stated as a
    // property: an 80ms window against a 66.7ms gap merged a whole triad.
    const gap = 200 / 3
    expect(chordWindowMs(gap, TOLERANCE_MS)).toBeLessThan(gap)
    expect(80).toBeGreaterThan(gap)
  })

  it('is capped by the matcher tolerance, so evenness and accuracy agree', () => {
    // Beyond `toleranceMs` the matcher does not attribute a press to the note
    // at all; grouping past it would have the two halves of the verdict
    // disagreeing about what was played.
    expect(chordWindowMs(10_000, TOLERANCE_MS)).toBe(TOLERANCE_MS)
  })

  it('falls back to the cap for a score with a single onset', () => {
    // No next note to run into, so the only bound that means anything is the
    // matcher's.
    expect(chordWindowMs(0, TOLERANCE_MS)).toBe(TOLERANCE_MS)
  })

  it('property: the window is always strictly inside the written gap', () => {
    // The load-bearing invariant. Everything else here is a judgement call;
    // this one is arithmetic, and it is what the fixed window broke.
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 5000, noNaN: true }),
        fc.double({ min: 0, max: 1000, noNaN: true }),
        (gap, tolerance) => {
          expect(chordWindowMs(gap, tolerance)).toBeLessThan(gap)
        },
      ),
    )
  })

  it('property: never exceeds the tolerance cap, and never goes negative', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 5000, noNaN: true }),
        fc.double({ min: 0, max: 1000, noNaN: true }),
        (gap, tolerance) => {
          const window = chordWindowMs(gap, tolerance)
          expect(window).toBeLessThanOrEqual(tolerance)
          expect(window).toBeGreaterThanOrEqual(0)
        },
      ),
    )
  })

  it('property: a slower run never gets a narrower window', () => {
    // Monotone in the written gap — a mutant that inverted the relationship,
    // or clamped the wrong way round, survives every example above.
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 2000, noNaN: true }),
        fc.double({ min: 1, max: 2000, noNaN: true }),
        (a, b) => {
          const [slow, fast] = a >= b ? [a, b] : [b, a]
          expect(chordWindowMs(slow, TOLERANCE_MS)).toBeGreaterThanOrEqual(
            chordWindowMs(fast, TOLERANCE_MS),
          )
        },
      ),
    )
  })

  it('rejects nonsense rather than quietly producing it', () => {
    expect(() => chordWindowMs(Number.NaN, TOLERANCE_MS)).toThrow(/shortestWrittenGapMs/)
    expect(() => chordWindowMs(-1, TOLERANCE_MS)).toThrow(/shortestWrittenGapMs/)
    expect(() => chordWindowMs(100, Number.POSITIVE_INFINITY)).toThrow(/toleranceMs/)
  })
})

// ---------------------------------------------------------------------------
// The fast end, against the real score
// ---------------------------------------------------------------------------

describe('the window on a real drill at the top of the tempo range', () => {
  /** The distinct written onsets of a drill's score, in ms at `bpm`. */
  function writtenOnsetsMs(drillId: string, bpm: number): readonly number[] {
    const drill = techniqueLibrary(1).find((d) => d.id === drillId)
    if (drill === undefined) throw new Error(`expected drill "${drillId}"`)
    const score = techniqueScore(drill, bpm)
    const tempo = makeTempoMap(score.tempos)
    return [...new Set(score.notes.filter((n) => !n.tiedFrom).map((n) => n.startTick))]
      .sort((a, b) => a - b)
      .map((startTick) => tickToMs(tempo, startTick) as number)
  }

  it('is narrower than a triplet gap at 300bpm, where the old flat 80ms was wider', () => {
    // The roadmap's fast-end number, recomputed off the real score rather than
    // quoted: the broken triad sequence is triplets, so at the top of the
    // app's tempo range (MAX_BPM) successive onsets are 66.7ms apart.
    const onsets = writtenOnsetsMs('triad-sequence-c-major-broken-hands-right', 300)
    const gap = shortestGapMs(onsets)
    expect(gap).toBeCloseTo(200 / 3, 6)

    // The old window swallowed notes the score wrote as separate, which is how
    // a visibly jittery run reported "Evenness 100% — Clean at 300bpm".
    expect(MATCHER_DEFAULTS.chordWindowMs).toBeGreaterThan(gap)
    // The new one cannot, at this or any tempo — see the property test below.
    expect(chordWindowMs(gap, MATCHER_DEFAULTS.toleranceMs)).toBeLessThan(gap)
  })

  it('is the matcher tolerance, not a sliver, at the target tempo of the same drill', () => {
    // The slow end of the same drill: the window must be generous enough to
    // hold a chord struck with one mouse pointer (~100ms of spread), and the
    // cap is what stops it growing past the point where the matcher would
    // stop attributing those presses to the note at all.
    const onsets = writtenOnsetsMs('triad-sequence-c-major-solid-hands-right', 72)
    const window = chordWindowMs(shortestGapMs(onsets), MATCHER_DEFAULTS.toleranceMs)
    expect(window).toBe(MATCHER_DEFAULTS.toleranceMs)
    expect(window).toBeGreaterThan(100)
  })
})

// ---------------------------------------------------------------------------
// groupOnsets
// ---------------------------------------------------------------------------

describe('groupOnsets', () => {
  it('collapses a rolled chord into one onset, at the moment it began', () => {
    expect(groupOnsets([0, 20, 40], 150).onsets).toEqual([0])
  })

  it('keeps notes the score wrote apart as separate onsets', () => {
    const window = chordWindowMs(500, TOLERANCE_MS)
    expect(groupOnsets([0, 500, 1000], window).onsets).toEqual([0, 500, 1000])
  })

  it('grades the mouse-pointer learner the same as the keyboard one (roadmap T.11)', () => {
    // The measured cliff: eight solid triads at ♩=60, rolled 30ms per note and
    // then 45ms per note. Under the old flat 80ms the first gave 8 onsets and
    // the second 16 — evenness 100% then 0%, for 15ms of difference.
    const window = chordWindowMs(1000, TOLERANCE_MS)
    const run = (perNote: number): number[] =>
      Array.from({ length: 8 }, (_, chord) => [0, 1, 2].map((n) => chord * 1000 + n * perNote)).flat()
    expect(groupOnsets(run(30), window).onsets).toHaveLength(8)
    expect(groupOnsets(run(45), window).onsets).toHaveLength(8)
    // And the mouse pointer, at ~50ms per note — 100ms of spread, which the
    // old window could not have held.
    expect(groupOnsets(run(50), window).onsets).toHaveLength(8)
  })

  it('does not let a slow arpeggio walk one group open, hop by hop', () => {
    // Each press is within the window of the PREVIOUS one, but the group is
    // measured from its FIRST press — otherwise a run played slightly slower
    // than written would collapse into a single onset and score a perfect 1.
    const window = 50
    const walking = [0, 40, 80, 120, 160]
    expect(groupOnsets(walking, window).onsets).toEqual([0, 80, 160])
  })

  it('treats a press exactly on the window edge as part of the chord', () => {
    // Inclusive, like every other window in the app.
    expect(groupOnsets([0, 50], 50).onsets).toEqual([0])
    expect(groupOnsets([0, 50.001], 50).onsets).toEqual([0, 50.001])
  })

  it('sorts presses that arrive out of order', () => {
    // MIDI events can land a millisecond out of order; unsorted input would
    // start a spurious group and report a phantom gap.
    expect(groupOnsets([40, 0, 20], 150).onsets).toEqual([0])
  })

  it('measures the widest group, not the last one', () => {
    const g = groupOnsets([0, 10, 1000, 1100, 2000], 150)
    expect(g.onsets).toEqual([0, 1000, 2000])
    expect(g.maxSpreadMs).toBe(100)
  })

  it('counts only the groups worth mentioning as rolled', () => {
    // 10ms is two keys under one hand; 90ms is a roll.
    const g = groupOnsets([0, 10, 1000, 1090, 2000, 2100], 150)
    expect(g.rolledGroups).toBe(2)
    expect(ROLL_REPORT_MS).toBe(30)
  })

  it('says nothing happened for an empty run', () => {
    expect(groupOnsets([], 150)).toEqual({ onsets: [], maxSpreadMs: 0, rolledGroups: 0 })
  })

  it('property: never invents or loses time — every onset is a real press', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 20_000 }), { maxLength: 60 }),
        fc.double({ min: 0, max: 200, noNaN: true }),
        (presses, window) => {
          const g = groupOnsets(presses, window)
          for (const onset of g.onsets) expect(presses).toContain(onset)
          expect(g.onsets.length).toBeLessThanOrEqual(presses.length)
          // Ascending, so `evennessOf` sees a real gap sequence.
          for (let i = 1; i < g.onsets.length; i += 1) {
            expect(g.onsets[i] ?? 0).toBeGreaterThan(g.onsets[i - 1] ?? 0)
          }
        },
      ),
    )
  })

  it('property: presses written a full gap apart are never merged', () => {
    // The two halves composed: take a written gap, derive the window from it,
    // play every note early or late by up to half the window, and the onset
    // count still equals the note count. This is the guarantee the ♩=300
    // triplet run lost.
    fc.assert(
      fc.property(
        fc.double({ min: 40, max: 2000, noNaN: true }),
        fc.integer({ min: 2, max: 12 }),
        (gap, count) => {
          const window = chordWindowMs(gap, TOLERANCE_MS)
          const presses = Array.from({ length: count }, (_, i) => i * gap)
          expect(groupOnsets(presses, window).onsets).toHaveLength(count)
        },
      ),
    )
  })

  it('property: a chord rolled inside the window is always one onset', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 40, max: 2000, noNaN: true }),
        fc.integer({ min: 2, max: 4 }),
        (gap, notes) => {
          const window = chordWindowMs(gap, TOLERANCE_MS)
          // `min`, because `(i * w) / (n - 1)` can land an ULP ABOVE `w` for
          // n = 4 — a fact about this line's arithmetic, not about the window.
          const rolled = Array.from({ length: notes }, (_, i) =>
            Math.min(window, (i * window) / (notes - 1)),
          )
          expect(groupOnsets(rolled, window).onsets).toEqual([0])
        },
      ),
    )
  })

  it('rejects a nonsense window', () => {
    expect(() => groupOnsets([0], Number.NaN)).toThrow(/windowMs/)
    expect(() => groupOnsets([0], -1)).toThrow(/windowMs/)
  })
})

// ---------------------------------------------------------------------------
// describeRoll
// ---------------------------------------------------------------------------

describe('describeRoll', () => {
  it('says nothing when nothing was rolled', () => {
    // A line printed after every run is a line nobody reads.
    expect(describeRoll(groupOnsets([0, 5, 1000, 1005], 150))).toBeNull()
  })

  it('names the widest spread in milliseconds', () => {
    expect(describeRoll(groupOnsets([0, 104], 150))).toBe(
      'One chord was rolled — up to 104ms between the notes.',
    )
  })

  it('counts the chords when more than one was rolled', () => {
    expect(describeRoll(groupOnsets([0, 90, 1000, 1104], 150))).toBe(
      '2 chords were rolled — up to 104ms between the notes.',
    )
  })

  it('does not say "1 chords"', () => {
    const text = describeRoll(groupOnsets([0, 104], 150)) ?? ''
    expect(text).not.toContain('1 chords')
  })

  it('property: whenever it speaks, it names the measured spread', () => {
    fc.assert(
      fc.property(fc.integer({ min: ROLL_REPORT_MS, max: 149 }), (spread) => {
        const text = describeRoll(groupOnsets([0, spread], 150))
        expect(text).not.toBeNull()
        expect(text ?? '').toContain(`${String(spread)}ms`)
      }),
    )
  })

  it('property: stays silent for every spread under the reporting threshold', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: ROLL_REPORT_MS - 1 }), (spread) => {
        expect(describeRoll(groupOnsets([0, spread], 150))).toBeNull()
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// the constant itself
// ---------------------------------------------------------------------------

it('pins the gap fraction at a half, which is what makes the merge impossible', () => {
  // Raising this above 0.5 breaks the "never reaches the next onset" property
  // silently, so the number is asserted where a reader will see it.
  expect(CHORD_WINDOW_GAP_FRACTION).toBeLessThanOrEqual(0.5)
  expect(CHORD_WINDOW_GAP_FRACTION).toBe(0.5)
})
