/**
 * `rudimentToScore` must turn ANY well-formed `Rudiment` into a valid
 * `GrooveScore` for any repeat count — it is the one bridge every one of the
 * 40 PAS rudiments flows through, so a single missed case here would be a
 * silent trap for whichever rudiment happens to hit it. Hence a property
 * test over synthetic rudiments rather than only the worked examples.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { validateGrooveScore } from '@core/drums/model/groove.ts'
import { rudimentToScore } from './score.ts'
import type { Rudiment, RudimentStroke } from './types.ts'

const SIXTEENTH = 120

function makeRudiment(strokeCount: number, unitTicks: number): Rudiment {
  const strokes: RudimentStroke[] = []
  for (let i = 0; i < strokeCount; i++) {
    strokes.push({
      sticking: i % 2 === 0 ? 'R' : 'L',
      tick: i * unitTicks,
      durationTicks: unitTicks,
      ...(i === strokeCount - 1 ? { accent: true as const } : {}),
    })
  }
  const rawSpan = strokeCount * unitTicks
  const patternTicks = Math.ceil(rawSpan / 480) * 480 || 480
  return {
    id: 'test-rudiment',
    pasNumber: 1,
    name: 'Test Rudiment',
    tier: 1,
    family: 'roll',
    patternTicks,
    strokes,
    bpmBand: { start: 60, target: 100 },
    transfer: 'test only',
  }
}

describe('rudimentToScore', () => {
  it('places cycles back to back on the snare pad', () => {
    const rudiment = makeRudiment(4, SIXTEENTH)
    const score = rudimentToScore(rudiment, 2)
    expect(score.notes).toHaveLength(8)
    expect(score.notes.every((n) => n.pad === 'snare')).toBe(true)
    expect(score.notes.map((n) => n.tick)).toEqual([0, 120, 240, 360, 480, 600, 720, 840])
  })

  it('carries sticking, accent and articulation through', () => {
    const rudiment: Rudiment = {
      id: 'flam-test',
      pasNumber: 20,
      name: 'Flam Test',
      tier: 1,
      family: 'flam',
      patternTicks: 960,
      strokes: [
        { sticking: 'R', tick: 0, durationTicks: 480, articulation: 'flam' },
        { sticking: 'L', tick: 480, durationTicks: 480, articulation: 'flam', accent: true },
      ],
      bpmBand: { start: 60, target: 100 },
      transfer: 'test only',
    }
    const score = rudimentToScore(rudiment, 1)
    expect(score.notes[0]?.sticking).toBe('R')
    expect(score.notes[0]?.articulations).toEqual(['flam'])
    expect(score.notes[0]?.dynamics).toBe('normal')
    expect(score.notes[1]?.sticking).toBe('L')
    expect(score.notes[1]?.dynamics).toBe('accent')
  })

  it('pads a non-bar-aligned total with a silent tail instead of throwing', () => {
    // 3 beats (1440 ticks) * 2 cycles = 2880 ticks = 1.5 bars.
    const rudiment = makeRudiment(12, SIXTEENTH)
    expect(rudiment.patternTicks).toBe(1440)
    const score = rudimentToScore(rudiment, 2)
    expect(score.measures).toHaveLength(2)
    expect(score.notes).toHaveLength(24)
  })

  it('property: for any grid-aligned rudiment and 1..4 cycles, the score validates with cycles * strokes.length notes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 17 }),
        fc.constantFrom(60, 80, 120, 160, 240, 480),
        fc.integer({ min: 1, max: 4 }),
        (strokeCount, unitTicks, cycles) => {
          const rudiment = makeRudiment(strokeCount, unitTicks)
          const score = rudimentToScore(rudiment, cycles)
          expect(validateGrooveScore(score).ok).toBe(true)
          expect(score.notes).toHaveLength(cycles * strokeCount)
        },
      ),
    )
  })
})
