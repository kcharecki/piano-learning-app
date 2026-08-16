import { describe, expect, it } from 'vitest'
import { seededRng } from '@core/ports/rng.ts'
import { midi, HALF, QUARTER, WHOLE } from '@core/shared/units.ts'
import { spelledPitchClass } from '@core/theory/pitch.ts'
import { buildScale } from '@core/theory/scales.ts'
import { keyFromFifths } from '@core/theory/keys.ts'
import { measureDurationTicks } from '@core/notation/score.ts'
import { generateStepwiseOneDirectionLine } from './stepwiseLine.ts'
import type { MidiRange, PlacedNote } from './melody.ts'

const FOUR_FOUR = { beats: 4, beatType: 4 }
const range = (low: number, high: number): MidiRange => ({ low: midi(low), high: midi(high) })

function cMajorPcs(): ReadonlySet<number> {
  const scale = buildScale(keyFromFifths(0, 'major').tonic, 'major')
  return new Set(scale.notes.map(spelledPitchClass))
}

/** Group a line's notes into consecutive runs of the same pitch — one run per bar, roadmap 5.54. */
function groupByPitch(notes: readonly PlacedNote[]): (readonly PlacedNote[])[] {
  const groups: PlacedNote[][] = []
  for (const n of notes) {
    const current = groups[groups.length - 1]
    if (current !== undefined && current[0]?.midi === n.midi) current.push(n)
    else groups.push([n])
  }
  return groups
}

describe('generateStepwiseOneDirectionLine', () => {
  it('rejects a non-positive or non-integer bars', () => {
    const scalePcs = cMajorPcs()
    for (const bars of [0, -1, 2.5]) {
      const result = generateStepwiseOneDirectionLine(
        seededRng(1),
        bars,
        FOUR_FOUR,
        range(60, 79),
        scalePcs,
        'quarter-half',
      )
      expect(result.ok).toBe(false)
    }
  })

  it('errors when the range cannot hold enough scale tones', () => {
    const scalePcs = cMajorPcs()
    // 60..63 holds only C and D (60, 62) — two tones, four bars requested.
    const result = generateStepwiseOneDirectionLine(
      seededRng(1),
      4,
      FOUR_FOUR,
      range(60, 63),
      scalePcs,
      'quarter-half',
    )
    expect(result.ok).toBe(false)
  })

  it('tiles the bars exactly: each bar holds one stepped pitch, re-articulated by style, no gaps or overlaps', () => {
    const scalePcs = cMajorPcs()
    const barTicks = measureDurationTicks(FOUR_FOUR)
    const result = generateStepwiseOneDirectionLine(
      seededRng(3),
      4,
      FOUR_FOUR,
      range(60, 79),
      scalePcs,
      'quarter-half',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const notes = result.value
    // No gaps or overlaps across the whole line: onsets tile [0, 4*barTicks).
    let cursor = 0
    for (const n of notes) {
      expect(n.startTick).toBe(cursor)
      cursor += n.durationTicks
    }
    expect(cursor).toBe(4 * barTicks)
    // Exactly 4 pitch groups (one per bar, roadmap 5.54's "four-note melody"
    // still means four STEPPED PITCHES, not four raw notes), each of which
    // starts on a bar boundary and spans exactly one bar in total.
    const groups = groupByPitch(notes)
    expect(groups).toHaveLength(4)
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]
      expect(group).toBeDefined()
      if (group === undefined) continue
      expect(group[0]?.startTick).toBe(i * barTicks)
      const spanned = group.reduce((sum, n) => sum + n.durationTicks, 0)
      expect(spanned).toBe(barTicks)
      // quarter-half's own units are {4, 8} sixteenth-note units — QUARTER or
      // HALF ticks, never WHOLE.
      for (const n of group) {
        expect([QUARTER, HALF]).toContain(n.durationTicks)
        expect(n.durationTicks).not.toBe(WHOLE)
      }
    }
  })

  it("quarter-half never engraves a whole note and engraves both quarter and half notes, over 300 seeds", () => {
    const scalePcs = cMajorPcs()
    const seenDurations = new Set<number>()
    for (let seed = 0; seed < 300; seed++) {
      const result = generateStepwiseOneDirectionLine(
        seededRng(seed),
        4,
        FOUR_FOUR,
        range(60, 79),
        scalePcs,
        'quarter-half',
      )
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      for (const n of result.value) {
        expect(n.durationTicks).not.toBe(WHOLE)
        seenDurations.add(n.durationTicks)
      }
    }
    expect(seenDurations.has(QUARTER)).toBe(true)
    expect(seenDurations.has(HALF)).toBe(true)
  })

  it('over many seeds, produces both directions and more than one starting position', () => {
    const scalePcs = cMajorPcs()
    const firstPitches = new Set<number>()
    const directions = new Set<'up' | 'down'>()
    for (let seed = 0; seed < 200; seed++) {
      const result = generateStepwiseOneDirectionLine(
        seededRng(seed),
        4,
        FOUR_FOUR,
        range(60, 79),
        scalePcs,
        'quarter-half',
      )
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      // One stepped pitch per bar (roadmap 5.54: a bar can now hold more than
      // one note of that same pitch), so compare bar-level pitches — the
      // first note of each pitch group — not raw note indices.
      const groups = groupByPitch(result.value)
      const bar0 = groups[0]?.[0]?.midi
      const bar1 = groups[1]?.[0]?.midi
      expect(bar0).toBeDefined()
      expect(bar1).toBeDefined()
      if (bar0 === undefined || bar1 === undefined) continue
      firstPitches.add(bar0)
      directions.add(bar1 > bar0 ? 'up' : 'down')
    }
    // A hardcoded direction or a hardcoded start position would collapse one
    // of these sets to size 1 — this is the mutant-killer the property test
    // in melody.test.ts alone does not cover (it never checks for variety,
    // only that whichever direction/start it got was internally consistent).
    expect(directions.size).toBe(2)
    expect(firstPitches.size).toBeGreaterThan(1)
  })
})
