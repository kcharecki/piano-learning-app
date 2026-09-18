/**
 * The 40-rudiment table is authored by hand (`rudiments.tier12.ts`,
 * `rudiments.tier34.ts`), so these tests exist to catch the two failure
 * modes hand-authored data actually has: a copy-paste slip (duplicate id,
 * duplicate/missing PAS number, overlapping strokes) and a rudiment that
 * silently can't be turned into a playable score. The exact-sticking
 * assertions pin down the two patterns AGENTS.md's DR-10 brief names
 * explicitly, so a future edit can't quietly corrupt them.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { validateGrooveScore } from '@core/drums/model/groove.ts'
import { rudimentToScore } from '@core/drums/rudiment/score.ts'
import type { RudimentStroke } from '@core/drums/rudiment/types.ts'
import { RUDIMENTS, rudimentById, rudimentsInTier } from './rudiments.ts'

const TIER_1_IDS = [
  'single-stroke-roll',
  'multiple-bounce-roll',
  'double-stroke-open-roll',
  'single-paradiddle',
  'flam',
  'drag',
]

function stickingOf(id: string): string {
  const rudiment = rudimentById(id)
  if (rudiment === undefined) throw new Error(`no such rudiment: ${id}`)
  return rudiment.strokes.map((s) => s.sticking).join('')
}

describe('RUDIMENTS', () => {
  it('has exactly 40 entries', () => {
    expect(RUDIMENTS).toHaveLength(40)
  })

  it('has unique ids', () => {
    const ids = RUDIMENTS.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has unique PAS numbers covering 1..40', () => {
    const numbers = RUDIMENTS.map((r) => r.pasNumber).sort((a, b) => a - b)
    expect(new Set(numbers).size).toBe(40)
    expect(numbers).toEqual(Array.from({ length: 40 }, (_, i) => i + 1))
  })

  it('is sorted by tier then PAS number', () => {
    for (let i = 1; i < RUDIMENTS.length; i++) {
      const prev = RUDIMENTS[i - 1]
      const cur = RUDIMENTS[i]
      if (prev === undefined || cur === undefined) throw new Error('unreachable')
      const inOrder = prev.tier < cur.tier || (prev.tier === cur.tier && prev.pasNumber < cur.pasNumber)
      expect(inOrder).toBe(true)
    }
  })

  it('tier 1 is exactly the six named rudiments', () => {
    const tier1Ids = rudimentsInTier(1).map((r) => r.id)
    expect(new Set(tier1Ids)).toEqual(new Set(TIER_1_IDS))
    expect(tier1Ids).toHaveLength(6)
  })

  it('every rudiment has a patternTicks that is a whole number of beats', () => {
    for (const r of RUDIMENTS) {
      expect(r.patternTicks % 480).toBe(0)
      expect(r.patternTicks).toBeGreaterThan(0)
    }
  })

  it('every rudiment’s strokes are sorted, non-overlapping and within patternTicks', () => {
    for (const r of RUDIMENTS) {
      expect(r.strokes.length).toBeGreaterThan(0)
      let prevEnd = -1
      let prevTick = -1
      for (const s of r.strokes) {
        expect(s.tick).toBeGreaterThanOrEqual(0)
        expect(s.durationTicks).toBeGreaterThan(0)
        expect(s.tick + s.durationTicks).toBeLessThanOrEqual(r.patternTicks)
        expect(s.tick).toBeGreaterThanOrEqual(prevTick)
        expect(s.tick).toBeGreaterThanOrEqual(prevEnd)
        prevEnd = s.tick + s.durationTicks
        prevTick = s.tick
      }
    }
  })

  it('rudimentById / rudimentsInTier agree with RUDIMENTS', () => {
    for (const r of RUDIMENTS) {
      expect(rudimentById(r.id)).toBe(r)
    }
    expect(rudimentById('not-a-real-rudiment')).toBeUndefined()
    for (const tier of [1, 2, 3, 4] as const) {
      for (const r of rudimentsInTier(tier)) expect(r.tier).toBe(tier)
    }
    expect(rudimentsInTier(1).length + rudimentsInTier(2).length + rudimentsInTier(3).length + rudimentsInTier(4).length).toBe(40)
  })

  it('single stroke roll alternates R/L exactly', () => {
    expect(stickingOf('single-stroke-roll')).toBe('RLRLRLRL')
  })

  it('single paradiddle sticking is exactly RLRR LRLL', () => {
    expect(stickingOf('single-paradiddle')).toBe('RLRRLRLL')
  })

  it('double paradiddle sticking is exactly RLRLRR LRLRLL', () => {
    expect(stickingOf('double-paradiddle')).toBe('RLRLRRLRLRLL')
  })

  it('double stroke open roll sticking is exactly RRLL RRLL', () => {
    expect(stickingOf('double-stroke-open-roll')).toBe('RRLLRRLL')
  })

  it('the six formerly-unverified tier-3/4 stickings match their cited sources', () => {
    // Transcribed from the Percussive Arts Society "40 International Drum Rudiments"
    // PDF (https://pas.org/wp-content/uploads/2024/04/pas-rudiments.pdf), fetched
    // 2026-09-18 — see the `// Source:` comment on each entry in rudiments.tier34.ts
    // for the sticking exactly as printed. Indices are 0-based into the stripped
    // sticking string, matching `seq()`'s `SeqOptions`.
    const expected: Readonly<
      Record<string, { sticking: string; flams?: readonly number[]; drags?: readonly number[]; accents: readonly number[] }>
    > = {
      'single-flammed-mill': { sticking: 'RRLRLLRL', flams: [0, 4], accents: [0, 4] },
      'flam-drag': { sticking: 'RLLRLRRL', flams: [0, 4], accents: [0, 4] },
      'double-drag-tap': { sticking: 'RRLLLR', drags: [0, 1, 3, 4], accents: [2, 5] },
      'single-dragadiddle': { sticking: 'RLRRLRLL', drags: [0, 4], accents: [0, 4] },
      'inverted-flam-tap': { sticking: 'RLLRRLLR', flams: [0, 2, 4, 6], accents: [0, 2, 4, 6] },
      'lesson-25': { sticking: 'RLRRLR', drags: [0, 3], accents: [2, 5] },
    }

    for (const [id, exp] of Object.entries(expected)) {
      const rudiment = rudimentById(id)
      if (rudiment === undefined) throw new Error(`no such rudiment: ${id}`)
      expect(stickingOf(id)).toBe(exp.sticking)

      const strokes = rudiment.strokes
      const indicesWhere = (pred: (s: RudimentStroke) => boolean): number[] =>
        strokes.reduce<number[]>((acc, s, i) => (pred(s) ? [...acc, i] : acc), [])

      expect(indicesWhere((s) => s.articulation === 'flam')).toEqual(exp.flams ?? [])
      expect(indicesWhere((s) => s.articulation === 'drag')).toEqual(exp.drags ?? [])
      expect(indicesWhere((s) => s.accent === true)).toEqual(exp.accents)
    }
  })

  it('every rudiment converts through rudimentToScore into a validating score, for 1..4 cycles', () => {
    for (const r of RUDIMENTS) {
      for (const cycles of [1, 2, 3, 4]) {
        const score = rudimentToScore(r, cycles)
        const result = validateGrooveScore(score)
        expect(result.ok, `${r.id} x${cycles}: ${result.ok ? '' : result.error}`).toBe(true)
        expect(score.notes).toHaveLength(cycles * r.strokes.length)
      }
    }
  })

  it('property: every rudiment converts for any cycle count 1..4', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...RUDIMENTS),
        fc.integer({ min: 1, max: 4 }),
        (rudiment, cycles) => {
          const score = rudimentToScore(rudiment, cycles)
          expect(validateGrooveScore(score).ok).toBe(true)
          expect(score.notes).toHaveLength(cycles * rudiment.strokes.length)
        },
      ),
    )
  })
})
