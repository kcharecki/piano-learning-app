import { describe, expect, it } from 'vitest'
import { seededRng } from '@core/ports/rng.ts'
import { midi } from '@core/shared/units.ts'
import { spelledPitchClass } from '@core/theory/pitch.ts'
import { buildScale } from '@core/theory/scales.ts'
import { keyFromFifths } from '@core/theory/keys.ts'
import { measureDurationTicks } from '@core/notation/score.ts'
import { generateStepwiseOneDirectionLine } from './stepwiseLine.ts'
import type { MidiRange } from './melody.ts'

const FOUR_FOUR = { beats: 4, beatType: 4 }
const range = (low: number, high: number): MidiRange => ({ low: midi(low), high: midi(high) })

function cMajorPcs(): ReadonlySet<number> {
  const scale = buildScale(keyFromFifths(0, 'major').tonic, 'major')
  return new Set(scale.notes.map(spelledPitchClass))
}

describe('generateStepwiseOneDirectionLine', () => {
  it('rejects a non-positive or non-integer bars', () => {
    const scalePcs = cMajorPcs()
    for (const bars of [0, -1, 2.5]) {
      const result = generateStepwiseOneDirectionLine(seededRng(1), bars, FOUR_FOUR, range(60, 79), scalePcs)
      expect(result.ok).toBe(false)
    }
  })

  it('errors when the range cannot hold enough scale tones', () => {
    const scalePcs = cMajorPcs()
    // 60..63 holds only C and D (60, 62) — two tones, four bars requested.
    const result = generateStepwiseOneDirectionLine(seededRng(1), 4, FOUR_FOUR, range(60, 63), scalePcs)
    expect(result.ok).toBe(false)
  })

  it('tiles the bars exactly: one whole-bar note per bar, no gaps or overlaps', () => {
    const scalePcs = cMajorPcs()
    const barTicks = measureDurationTicks(FOUR_FOUR)
    const result = generateStepwiseOneDirectionLine(seededRng(3), 4, FOUR_FOUR, range(60, 79), scalePcs)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toHaveLength(4)
    for (let i = 0; i < result.value.length; i++) {
      const note = result.value[i]
      expect(note).toBeDefined()
      expect(note?.startTick).toBe(i * barTicks)
      expect(note?.durationTicks).toBe(barTicks)
    }
  })

  it('over many seeds, produces both directions and more than one starting position', () => {
    const scalePcs = cMajorPcs()
    const firstNotes = new Set<number>()
    const directions = new Set<'up' | 'down'>()
    for (let seed = 0; seed < 200; seed++) {
      const result = generateStepwiseOneDirectionLine(seededRng(seed), 4, FOUR_FOUR, range(60, 79), scalePcs)
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      const notes = result.value
      firstNotes.add(notes[0]?.midi as number)
      directions.add((notes[1]?.midi as number) > (notes[0]?.midi as number) ? 'up' : 'down')
    }
    // A hardcoded direction or a hardcoded start position would collapse one
    // of these sets to size 1 — this is the mutant-killer the property test
    // in melody.test.ts alone does not cover (it never checks for variety,
    // only that whichever direction/start it got was internally consistent).
    expect(directions.size).toBe(2)
    expect(firstNotes.size).toBeGreaterThan(1)
  })
})
