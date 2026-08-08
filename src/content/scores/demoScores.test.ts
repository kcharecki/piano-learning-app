import { describe, expect, it } from 'vitest'
import { notesInMeasure, validateScore, type ScoreNote } from '@core/notation/score.ts'
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
  'demo-g-major-scale-one-octave-rh',
  'demo-f-major-scale-one-octave-rh',
  'demo-key-signatures-g-and-f',
  'demo-keys-d-major-and-b-flat-major',
]

describe('DEMO_SCORES registry', () => {
  it('contains at least the 18 required demonstrations', () => {
    expect(DEMO_SCORES.length).toBeGreaterThanOrEqual(18)
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

  // Every demo's expected key signature, written out explicitly rather than
  // derived from the implementation — the two mixed-key demos change key
  // mid-score, so this table only covers the single-key ones; those two get
  // their own per-measure sequence assertions below.
  const EXPECTED_KEY_FIFTHS: Readonly<Record<string, number>> = {
    'demo-middle-c-position-rh': 0,
    'demo-middle-c-position-lh': 0,
    'demo-five-finger-c-major-hands-separately': 0,
    'demo-steps-vs-skips': 0,
    'demo-c-major-scale-one-octave-rh': 0,
    'demo-rhythm-reading-4-4': 0,
    'demo-waltz-rhythm-3-4': 0,
    'demo-c-major-triad-blocked': 0,
    'demo-c-major-triad-broken': 0,
    'demo-i-v-i-c-major': 0,
    'demo-i-iv-v-i-c-major': 0,
    'demo-authentic-cadence-c-major': 0,
    'demo-hands-together-parallel-motion-c': 0,
    'demo-lh-root-rh-melody-simple-piece': 0,
    'demo-g-major-scale-one-octave-rh': 1,
    'demo-f-major-scale-one-octave-rh': -1,
  }

  it('every single-key demo carries its documented key signature throughout', () => {
    expect(Object.keys(EXPECTED_KEY_FIFTHS).sort()).toEqual(
      DEMO_SCORES.map((d) => d.id)
        .filter((id) => id !== 'demo-key-signatures-g-and-f' && id !== 'demo-keys-d-major-and-b-flat-major')
        .sort(),
    )
    for (const [id, expected] of Object.entries(EXPECTED_KEY_FIFTHS)) {
      const demo = requireDemo(id)
      expect(demo.score.measures.every((m) => m.keyFifths === expected)).toBe(true)
    }
  })

  it('demo-key-signatures-g-and-f changes key mid-score: G major (1 sharp), then F major (1 flat)', () => {
    const demo = requireDemo('demo-key-signatures-g-and-f')
    expect(demo.score.measures.map((m) => m.keyFifths)).toEqual([1, 1, -1, -1])
  })

  it('demo-keys-d-major-and-b-flat-major changes key mid-score: D major (2 sharps), then B-flat major (2 flats)', () => {
    const demo = requireDemo('demo-keys-d-major-and-b-flat-major')
    expect(demo.score.measures.map((m) => m.keyFifths)).toEqual([2, 2, -2, -2])
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

  it('demo-g-major-scale-one-octave-rh actually sounds F# (pitch class 6), never F natural (pitch class 5)', () => {
    const pitchClasses = requireDemo('demo-g-major-scale-one-octave-rh').score.notes.map((n) => n.midi % 12)
    expect(pitchClasses).toContain(6)
    expect(pitchClasses).not.toContain(5)
  })

  it('demo-f-major-scale-one-octave-rh actually sounds Bb (pitch class 10), never B natural (pitch class 11)', () => {
    const pitchClasses = requireDemo('demo-f-major-scale-one-octave-rh').score.notes.map((n) => n.midi % 12)
    expect(pitchClasses).toContain(10)
    expect(pitchClasses).not.toContain(11)
  })

  it('demo-key-signatures-g-and-f sounds F# in bars 1-2 (the G major half) and Bb in bars 3-4 (the F major half)', () => {
    const score = requireDemo('demo-key-signatures-g-and-f').score
    const firstHalf = [...notesInMeasure(score, 0), ...notesInMeasure(score, 1)].map((n) => n.midi % 12)
    const secondHalf = [...notesInMeasure(score, 2), ...notesInMeasure(score, 3)].map((n) => n.midi % 12)
    expect(firstHalf).toContain(6)
    expect(secondHalf).toContain(10)
  })

  it('demo-keys-d-major-and-b-flat-major sounds F# and C# in bars 1-2 (D major), Bb and Eb in bars 3-4 (B-flat major)', () => {
    const score = requireDemo('demo-keys-d-major-and-b-flat-major').score
    const firstHalf = [...notesInMeasure(score, 0), ...notesInMeasure(score, 1)].map((n) => n.midi % 12)
    const secondHalf = [...notesInMeasure(score, 2), ...notesInMeasure(score, 3)].map((n) => n.midi % 12)
    expect(firstHalf).toContain(6)
    expect(firstHalf).toContain(1)
    expect(secondHalf).toContain(10)
    expect(secondHalf).toContain(3)
  })
})
