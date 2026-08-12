import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { buildTestScore, type TestNote } from '@test/fixtures.ts'
import type { Hand, Score } from '@core/notation/score.ts'
import {
  EIGHTH,
  HALF,
  QUARTER,
  SIXTEENTH,
  midi as asMidi,
  ticks as asTicks,
  type Midi,
} from '@core/shared/units.ts'
import {
  pianoRollNotes,
  pianoRollWindowAround,
  type PianoRollLaneRange,
  type PianoRollNote,
  type PianoRollWindow,
} from './pianoRoll.ts'

// -------------------------------------------------------------------- helpers

const win = (fromTick: number, toTick: number): PianoRollWindow => ({
  fromTick: asTicks(fromTick),
  toTick: asTicks(toTick),
})
const lane = (lowMidi: number, highMidi: number): PianoRollLaneRange => ({
  lowMidi: asMidi(lowMidi),
  highMidi: asMidi(highMidi),
})

/**
 * A generous single measure (200/4 — 96000 ticks) so every generated note,
 * however it lands, stays inside its own bar. `pianoRollNotes` never reads
 * `score.measures` (only `notes`/`maxNoteDurationTicks`, via `soundingAtTick`/
 * `notesInRange`), so the metre here is arbitrary scaffolding `makeScore`
 * needs, not something the module under test cares about.
 */
const ONE_HUGE_MEASURE = { timeSignature: { beats: 200, beatType: 4 } }

const midiArb = fc.integer({ min: 21, max: 108 })
const startTickArb = fc.integer({ min: 0, max: 40 }).map((n) => n * SIXTEENTH)
const durationArb = fc.constantFrom(0, SIXTEENTH, EIGHTH, QUARTER, HALF)
const handArb = fc.constantFrom<Hand>('left', 'right')

const noteArb: fc.Arbitrary<TestNote> = fc.record({
  midi: midiArb,
  startTick: startTickArb,
  durationTicks: durationArb,
  hand: handArb,
})

/** Arbitrary notes — pitches and spans may freely overlap. */
const anyScoreArb: fc.Arbitrary<Score> = fc
  .array(noteArb, { maxLength: 20 })
  .map((notes) => buildTestScore(notes, ONE_HUGE_MEASURE))

/** One pitch's onsets, spaced so their spans never overlap. */
const nonOverlappingSpansArb = fc
  .array(
    fc.record({ gapSixteenths: fc.integer({ min: 0, max: 8 }), durationSixteenths: fc.integer({ min: 1, max: 6 }) }),
    { maxLength: 6 },
  )
  .map((specs) => {
    let cursor = 0
    return specs.map(({ gapSixteenths, durationSixteenths }) => {
      const startTick = (cursor + gapSixteenths) * SIXTEENTH
      const durationTicks = durationSixteenths * SIXTEENTH
      cursor = cursor + gapSixteenths + durationSixteenths
      return { startTick, durationTicks }
    })
  })

/** Distinct pitches, each with its own non-overlapping onset list — so the WHOLE score never overlaps a pitch against itself. */
const nonOverlappingScoreArb: fc.Arbitrary<Score> = fc
  .uniqueArray(fc.record({ midi: midiArb, hand: handArb, spans: nonOverlappingSpansArb }), {
    selector: (g) => g.midi,
    maxLength: 5,
  })
  .map((groups) => {
    const notes: TestNote[] = groups.flatMap((g) =>
      g.spans.map((s) => ({ midi: g.midi, hand: g.hand, startTick: s.startTick, durationTicks: s.durationTicks })),
    )
    return buildTestScore(notes, ONE_HUGE_MEASURE)
  })

const windowArb: fc.Arbitrary<PianoRollWindow> = fc
  .tuple(fc.integer({ min: 0, max: 40 }), fc.integer({ min: 0, max: 30 }))
  .map(([fromUnit, lengthUnit]) => win(fromUnit * SIXTEENTH, fromUnit * SIXTEENTH + lengthUnit * SIXTEENTH))

const laneRangeArb: fc.Arbitrary<PianoRollLaneRange> = fc
  .tuple(fc.integer({ min: 21, max: 100 }), fc.integer({ min: 0, max: 24 }))
  .map(([low, width]) => lane(low, Math.min(108, low + width)))

// ------------------------------------------------------------------ examples

describe('pianoRollNotes — examples', () => {
  it('includes a note that starts inside the window', () => {
    const score = buildTestScore([{ midi: 60, startTick: 480, durationTicks: 240 }], ONE_HUGE_MEASURE)
    const result = pianoRollNotes(score, win(0, 960), lane(21, 108))
    expect(result.map((r) => r.noteId)).toEqual([score.notes[0]?.id])
  })

  it('excludes a note that ends before the window opens', () => {
    const score = buildTestScore([{ midi: 60, startTick: 0, durationTicks: 240 }], ONE_HUGE_MEASURE)
    const result = pianoRollNotes(score, win(240, 960), lane(21, 108))
    expect(result).toEqual([])
  })

  it('excludes a note that starts at or after the window closes', () => {
    const score = buildTestScore([{ midi: 60, startTick: 960, durationTicks: 240 }], ONE_HUGE_MEASURE)
    const result = pianoRollNotes(score, win(0, 960), lane(21, 108))
    expect(result).toEqual([])
  })

  it('includes a long note that started before the window but is still sounding', () => {
    const score = buildTestScore([{ midi: 60, startTick: 0, durationTicks: 4000 }], ONE_HUGE_MEASURE)
    const result = pianoRollNotes(score, win(2000, 2500), lane(21, 108))
    expect(result.map((r) => r.noteId)).toEqual([score.notes[0]?.id])
    // The rectangle reports the note's TRUE span, not one clipped to the window.
    expect(result[0]?.startTick).toBe(0)
    expect(result[0]?.lengthTicks).toBe(4000)
  })

  it('a zero-length note is included exactly when its onset tick is inside the window, and degrades cleanly (lengthTicks stays 0)', () => {
    const score = buildTestScore([{ midi: 60, startTick: 480, durationTicks: 0 }], ONE_HUGE_MEASURE)
    expect(pianoRollNotes(score, win(0, 480), lane(21, 108)).map((r) => r.noteId)).toEqual([])
    const inWindow = pianoRollNotes(score, win(0, 481), lane(21, 108))
    expect(inWindow.map((r) => r.noteId)).toEqual([score.notes[0]?.id])
    expect(inWindow[0]?.lengthTicks).toBe(0)
    expect(pianoRollNotes(score, win(481, 960), lane(21, 108))).toEqual([])
  })

  it('a note outside the lane range degrades cleanly: no throw, simply absent', () => {
    const score = buildTestScore(
      [
        { midi: 40, startTick: 0 },
        { midi: 60, startTick: 0 },
        { midi: 90, startTick: 0 },
      ],
      ONE_HUGE_MEASURE,
    )
    expect(() => pianoRollNotes(score, win(0, 960), lane(50, 70))).not.toThrow()
    const result = pianoRollNotes(score, win(0, 960), lane(50, 70))
    expect(result.map((r) => r.midi)).toEqual([60])
  })

  it('a degenerate window (toTick <= fromTick) returns no rectangles, never throws', () => {
    const score = buildTestScore([{ midi: 60, startTick: 0 }], ONE_HUGE_MEASURE)
    expect(pianoRollNotes(score, win(480, 480), lane(21, 108))).toEqual([])
    expect(pianoRollNotes(score, win(960, 480), lane(21, 108))).toEqual([])
  })

  it('a degenerate lane range (highMidi < lowMidi) returns no rectangles, never throws', () => {
    const score = buildTestScore([{ midi: 60, startTick: 0 }], ONE_HUGE_MEASURE)
    expect(pianoRollNotes(score, win(0, 960), lane(70, 50))).toEqual([])
  })

  it('an empty score degrades cleanly to no rectangles', () => {
    const score = buildTestScore([], ONE_HUGE_MEASURE)
    expect(pianoRollNotes(score, win(0, 960), lane(21, 108))).toEqual([])
  })

  it('lane is 0-based from the low end of the range and increases with pitch', () => {
    const score = buildTestScore(
      [
        { midi: 60, startTick: 0 },
        { midi: 64, startTick: 0 },
      ],
      ONE_HUGE_MEASURE,
    )
    const result = pianoRollNotes(score, win(0, 480), lane(60, 72))
    const byMidi = new Map(result.map((r) => [r.midi, r.lane]))
    expect(byMidi.get(asMidi(60))).toBe(0)
    expect(byMidi.get(asMidi(64))).toBe(4)
  })

  it('pianoRollWindowAround clamps at tick 0 rather than going negative', () => {
    expect(pianoRollWindowAround(100, 500, 1000)).toEqual(win(0, 1100))
    expect(pianoRollWindowAround(0, 500, 1000)).toEqual(win(0, 1000))
  })
})

// ------------------------------------------------------------------ properties

describe('pianoRollNotes — properties', () => {
  it('a note is present iff its (possibly widened, for zero-length) span intersects the window AND its pitch is in range', () => {
    fc.assert(
      fc.property(anyScoreArb, windowArb, laneRangeArb, (score, window, laneRange) => {
        const result = pianoRollNotes(score, window, laneRange)
        const resultIds = new Set(result.map((r) => r.noteId))
        const windowNonEmpty = window.toTick > window.fromTick
        for (const note of score.notes) {
          const soundingEndTick = note.durationTicks > 0 ? note.startTick + note.durationTicks : note.startTick + 1
          const intersects =
            windowNonEmpty && note.startTick < window.toTick && soundingEndTick > window.fromTick
          const inRange = note.midi >= laneRange.lowMidi && note.midi <= laneRange.highMidi
          expect(resultIds.has(note.id)).toBe(intersects && inRange)
        }
      }),
    )
  })

  it('every returned rectangle really does belong to a note in the score, unchanged (startTick/lengthTicks/hand/midi round-trip)', () => {
    fc.assert(
      fc.property(anyScoreArb, windowArb, laneRangeArb, (score, window, laneRange) => {
        const byId = new Map(score.notes.map((n) => [n.id, n] as const))
        for (const r of pianoRollNotes(score, window, laneRange)) {
          const source = byId.get(r.noteId)
          expect(source).toBeDefined()
          expect(r.midi).toBe(source?.midi)
          expect(r.hand).toBe(source?.hand)
          expect(r.startTick).toBe(source?.startTick)
          expect(r.lengthTicks).toBe(source?.durationTicks)
        }
      }),
    )
  })

  it('lane is a strictly monotonic, bijective function of pitch: lane === midi - lowMidi', () => {
    fc.assert(
      fc.property(anyScoreArb, windowArb, laneRangeArb, (score, window, laneRange) => {
        for (const r of pianoRollNotes(score, window, laneRange)) {
          expect(r.lane).toBe(r.midi - laneRange.lowMidi)
        }
      }),
    )
  })

  it('never draws two overlapping rectangles for the same pitch', () => {
    fc.assert(
      fc.property(nonOverlappingScoreArb, windowArb, laneRangeArb, (score, window, laneRange) => {
        const result = pianoRollNotes(score, window, laneRange)
        const byMidi = new Map<Midi, PianoRollNote[]>()
        for (const r of result) {
          const list = byMidi.get(r.midi) ?? []
          list.push(r)
          byMidi.set(r.midi, list)
        }
        for (const list of byMidi.values()) {
          const sorted = [...list].sort((a, b) => a.startTick - b.startTick)
          for (let i = 1; i < sorted.length; i++) {
            const prev = sorted[i - 1] as PianoRollNote
            const current = sorted[i] as PianoRollNote
            expect(current.startTick).toBeGreaterThanOrEqual(prev.startTick + prev.lengthTicks)
          }
        }
      }),
    )
  })

  it('never throws, for any score/window/lane-range combination, including degenerate ones', () => {
    fc.assert(
      fc.property(
        anyScoreArb,
        fc.tuple(fc.integer({ min: -10, max: 40 }), fc.integer({ min: -10, max: 40 })).map(([a, b]) =>
          win(a * SIXTEENTH, b * SIXTEENTH),
        ),
        fc.tuple(fc.integer({ min: 0, max: 108 }), fc.integer({ min: 0, max: 108 })).map(([a, b]) => lane(a, b)),
        (score, window, laneRange) => {
          expect(() => pianoRollNotes(score, window, laneRange)).not.toThrow()
        },
      ),
    )
  })
})
