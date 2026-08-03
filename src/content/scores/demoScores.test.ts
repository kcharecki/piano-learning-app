import { describe, expect, it } from 'vitest'
import { validateScore, type ScoreNote } from '@core/notation/score.ts'
import { analyseScore } from '@core/theory/analysis.ts'
import { keyFromFifths } from '@core/theory/keys.ts'
import { DEMO_SCORES, demoScoreById, type DemoScore } from './demoScores.ts'

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/

function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i]
  if (v === undefined) throw new Error(`index ${i} out of range (length ${arr.length})`)
  return v
}

function requireDemo(id: string): DemoScore {
  const demo = demoScoreById(id)
  if (demo === undefined) throw new Error(`test fixture: missing demo '${id}'`)
  return demo
}

const AUTHORED_DEMO_IDS = [
  'demo-middle-c-position-rh',
  'demo-middle-c-position-lh',
  'demo-five-finger-c-major-hands-separately',
  'demo-steps-vs-skips',
  'demo-c-major-scale-one-octave-rh',
  'demo-rhythm-reading-4-4',
  'demo-waltz-rhythm-3-4',
  'demo-c-major-triad-blocked',
  'demo-c-major-triad-broken',
  'demo-i-v-i-c-major',
  'demo-i-iv-v-i-c-major',
  'demo-authentic-cadence-c-major',
  'demo-hands-together-parallel-motion-c',
  'demo-lh-root-rh-melody-simple-piece',
]

describe('DEMO_SCORES registry', () => {
  it('contains at least the 14 required demonstrations', () => {
    expect(DEMO_SCORES.length).toBeGreaterThanOrEqual(14)
  })

  it('pins the published id set and authored order — the curriculum references these ids by literal string', () => {
    expect(DEMO_SCORES.map((d) => d.id)).toEqual(AUTHORED_DEMO_IDS)
  })

  it("every demo's score.id matches its DemoScore.id and has a non-empty score title", () => {
    for (const demo of DEMO_SCORES) {
      expect(demo.score.id).toBe(demo.id)
      expect(demo.score.meta.title.length).toBeGreaterThan(0)
    }
  })

  it('keeps hands on their expected side of middle C (RH >= C4, LH <= C4)', () => {
    for (const demo of DEMO_SCORES) {
      for (const n of demo.score.notes) {
        if (n.hand === 'right') expect(n.midi).toBeGreaterThanOrEqual(60)
        else expect(n.midi).toBeLessThanOrEqual(60)
      }
    }
  })

  it('the level 1/2 hand-authored demos carry an explicit, sane teaching tempo (60-90 bpm)', () => {
    const LEVEL_1_2_IDS = [
      'demo-middle-c-position-rh',
      'demo-middle-c-position-lh',
      'demo-five-finger-c-major-hands-separately',
    ]
    for (const id of LEVEL_1_2_IDS) {
      const demo = requireDemo(id)
      const first = demo.score.tempos[0]
      expect(first, `${id} has no tempo mark`).toBeDefined()
      if (first === undefined) continue
      expect(first.tick).toBe(0)
      expect(first.bpm).toBeGreaterThanOrEqual(60)
      expect(first.bpm).toBeLessThanOrEqual(90)
    }
  })

  it('every demo is in C major (keyFifths 0)', () => {
    for (const demo of DEMO_SCORES) {
      expect(demo.score.measures.every((m) => m.keyFifths === 0)).toBe(true)
    }
  })

  it('demo-waltz-rhythm-3-4 keeps its 3/4 time signature', () => {
    const demo = requireDemo('demo-waltz-rhythm-3-4')
    expect(
      demo.score.measures.every((m) => m.timeSignature.beats === 3 && m.timeSignature.beatType === 4),
    ).toBe(true)
  })

  it('every entry has a unique, non-empty, kebab-case id', () => {
    const seen = new Set<string>()
    for (const demo of DEMO_SCORES) {
      expect(demo.id.length).toBeGreaterThan(0)
      expect(demo.id).toMatch(KEBAB_CASE)
      expect(seen.has(demo.id)).toBe(false)
      seen.add(demo.id)
    }
  })

  it('every entry has a non-empty title and description', () => {
    for (const demo of DEMO_SCORES) {
      expect(demo.title.length).toBeGreaterThan(0)
      expect(demo.description.length).toBeGreaterThan(0)
    }
  })

  it('every score in the registry passes validateScore', () => {
    for (const demo of DEMO_SCORES) {
      const result = validateScore(demo.score)
      expect(result.ok, `${demo.id}: ${result.ok ? '' : result.error}`).toBe(true)
    }
  })

  it('every score is non-empty', () => {
    for (const demo of DEMO_SCORES) {
      expect(demo.score.notes.length).toBeGreaterThan(0)
    }
  })

  it("every score's notes are sorted ascending by startTick", () => {
    for (const demo of DEMO_SCORES) {
      const notes: readonly ScoreNote[] = demo.score.notes
      for (let i = 1; i < notes.length; i++) {
        expect(at(notes, i).startTick).toBeGreaterThanOrEqual(at(notes, i - 1).startTick)
      }
    }
  })

  it('demoScoreById resolves every registered id back to its own entry', () => {
    for (const demo of DEMO_SCORES) {
      expect(demoScoreById(demo.id)).toBe(demo)
    }
  })

  it('demoScoreById returns undefined for an unknown id', () => {
    expect(demoScoreById('not-a-real-demo-id')).toBeUndefined()
    expect(demoScoreById('')).toBeUndefined()
  })
})

describe('harmony demonstrations analyse as intended', () => {
  const cMajor = keyFromFifths(0, 'major')

  it('demo-i-v-i-c-major reads as I, V, I', () => {
    const analysis = analyseScore(requireDemo('demo-i-v-i-c-major').score, cMajor)
    const degrees = analysis.chords.map((c) => c.numeral?.degree)
    const qualities = analysis.chords.map((c) => c.numeral?.quality)
    expect(degrees).toEqual([1, 5, 1])
    expect(qualities).toEqual(['major', 'major', 'major'])
    expect(analysis.chords.map((c) => c.numeral?.inversion)).toEqual([0, 0, 0])
  })

  it('demo-i-iv-v-i-c-major reads as I, IV, V, I', () => {
    const analysis = analyseScore(requireDemo('demo-i-iv-v-i-c-major').score, cMajor)
    const degrees = analysis.chords.map((c) => c.numeral?.degree)
    const qualities = analysis.chords.map((c) => c.numeral?.quality)
    expect(degrees).toEqual([1, 4, 5, 1])
    expect(qualities).toEqual(['major', 'major', 'major', 'major'])
    expect(analysis.chords.map((c) => c.numeral?.inversion)).toEqual([0, 0, 0, 0])
  })

  it('demo-c-major-triad-blocked reads as I in root position, first, second inversion, root', () => {
    const analysis = analyseScore(requireDemo('demo-c-major-triad-blocked').score, cMajor)
    expect(
      analysis.chords.every((c) => c.numeral?.degree === 1 && c.numeral.quality === 'major'),
    ).toBe(true)
    expect(analysis.chords.map((c) => c.numeral?.inversion)).toEqual([0, 1, 2, 0])
  })

  it('demo-authentic-cadence-c-major reads as a root-position V then I and is classified perfect authentic', () => {
    const analysis = analyseScore(requireDemo('demo-authentic-cadence-c-major').score, cMajor)
    expect(analysis.chords.map((c) => c.numeral?.degree)).toEqual([5, 1])
    expect(analysis.chords.map((c) => c.numeral?.inversion)).toEqual([0, 0])
    expect(analysis.cadences.some((c) => c.type === 'perfect-authentic')).toBe(true)
  })
})

describe('non-harmony demonstrations carry the content they claim to', () => {
  it('demo-steps-vs-skips alternates a step, a skip, a step, a skip', () => {
    const notes = requireDemo('demo-steps-vs-skips').score.notes
    const intervals: number[] = []
    for (let i = 0; i + 1 < notes.length; i += 2) {
      const a = at(notes, i)
      const b = at(notes, i + 1)
      intervals.push(b.midi - a.midi)
    }
    expect(intervals).toEqual([2, 4, 2, 3])
  })

  it('demo-rhythm-reading-4-4 plays a whole, two halves, then four quarters', () => {
    const notes = requireDemo('demo-rhythm-reading-4-4').score.notes
    expect(notes.map((n) => n.durationTicks)).toEqual([1920, 960, 960, 480, 480, 480, 480])
  })

  it('demo-hands-together-parallel-motion-c keeps the hands an octave apart at every simultaneous pair', () => {
    const notes = requireDemo('demo-hands-together-parallel-motion-c').score.notes
    const byTick = new Map<number, { right?: number; left?: number }>()
    for (const n of notes) {
      const entry = byTick.get(n.startTick) ?? {}
      if (n.hand === 'right') entry.right = n.midi
      else entry.left = n.midi
      byTick.set(n.startTick, entry)
    }
    for (const { right, left } of byTick.values()) {
      expect(right).toBeDefined()
      expect(left).toBeDefined()
      if (right !== undefined && left !== undefined) expect(right - left).toBe(12)
    }
  })
})
