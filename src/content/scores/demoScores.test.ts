import { describe, expect, it } from 'vitest'
import { notesInMeasure, validateScore, type ScoreNote } from '@core/notation/score.ts'
import { midi, TICKS_PER_QUARTER } from '@core/shared/units.ts'
import { analyseScore } from '@core/theory/analysis.ts'
import { buildChord } from '@core/theory/chords.ts'
import { classifyCadence, romanNumeralFor } from '@core/theory/harmony.ts'
import { keyFromFifths } from '@core/theory/keys.ts'
import { spell } from '@core/theory/pitch.ts'
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
  'demo-i-iv-i-c-major',
  'demo-authentic-cadence-c-major',
  'demo-c-major-and-a-minor-triads',
  'demo-g-major-to-g-dominant-seventh',
  'demo-four-cadence-types-c-major',
  'demo-common-progressions-c-major',
  'demo-a-minor-three-scale-forms',
  'demo-secondary-dominant-v-of-v-c-major',
  'demo-modulation-c-major-to-g-major',
  'demo-hands-together-parallel-motion-c',
  'demo-lh-root-rh-melody-simple-piece',
  'demo-g-major-scale-one-octave-rh',
  'demo-f-major-scale-one-octave-rh',
  'demo-c-major-scale-two-octaves-hands-together',
  'demo-rhythm-reading-eighth-notes',
  'demo-dotted-rhythm-3-4',
  'demo-circle-of-fifths-c-g-f',
  'demo-contrary-motion-different-rhythms-c',
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
    'demo-c-major-scale-two-octaves-hands-together': 0,
    'demo-rhythm-reading-eighth-notes': 0,
    'demo-dotted-rhythm-3-4': 0,
    'demo-i-iv-i-c-major': 0,
    'demo-c-major-and-a-minor-triads': 0,
    'demo-contrary-motion-different-rhythms-c': 0,
    'demo-g-major-to-g-dominant-seventh': 0,
    'demo-four-cadence-types-c-major': 0,
    'demo-common-progressions-c-major': 0,
    'demo-a-minor-three-scale-forms': 0,
    'demo-secondary-dominant-v-of-v-c-major': 0,
  }

  const MIXED_KEY_DEMO_IDS = [
    'demo-key-signatures-g-and-f',
    'demo-keys-d-major-and-b-flat-major',
    'demo-circle-of-fifths-c-g-f',
    'demo-modulation-c-major-to-g-major',
  ]

  it('every single-key demo carries its documented key signature throughout', () => {
    expect(Object.keys(EXPECTED_KEY_FIFTHS).sort()).toEqual(
      DEMO_SCORES.map((d) => d.id)
        .filter((id) => !MIXED_KEY_DEMO_IDS.includes(id))
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

  it('demo-dotted-rhythm-3-4 keeps its 3/4 time signature', () => {
    const demo = requireDemo('demo-dotted-rhythm-3-4')
    expect(
      demo.score.measures.every((m) => m.timeSignature.beats === 3 && m.timeSignature.beatType === 4),
    ).toBe(true)
  })

  it('demo-circle-of-fifths-c-g-f changes key mid-score: C major, then G major (1 sharp), then F major (1 flat)', () => {
    const demo = requireDemo('demo-circle-of-fifths-c-g-f')
    expect(demo.score.measures.map((m) => m.keyFifths)).toEqual([0, 0, 1, 1, -1, -1])
  })

  it('demo-modulation-c-major-to-g-major changes key mid-score: C major, then G major (1 sharp) — the pivot (roadmap 5.10)', () => {
    const demo = requireDemo('demo-modulation-c-major-to-g-major')
    expect(demo.score.measures.map((m) => m.keyFifths)).toEqual([0, 0, 1, 1])
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

  it('demo-i-iv-i-c-major reads as I, IV, I — stopping short of the dominant (roadmap 5.9a)', () => {
    const analysis = analyseScore(requireDemo('demo-i-iv-i-c-major').score, cMajor)
    const degrees = analysis.chords.map((c) => c.numeral?.degree)
    const qualities = analysis.chords.map((c) => c.numeral?.quality)
    expect(degrees).toEqual([1, 4, 1])
    expect(qualities).toEqual(['major', 'major', 'major'])
    expect(analysis.chords.map((c) => c.numeral?.inversion)).toEqual([0, 0, 0])
  })

  it('demo-c-major-and-a-minor-triads reads as I, then vi — the relative minor (roadmap 5.9a)', () => {
    const analysis = analyseScore(requireDemo('demo-c-major-and-a-minor-triads').score, cMajor)
    const degrees = analysis.chords.map((c) => c.numeral?.degree)
    const qualities = analysis.chords.map((c) => c.numeral?.quality)
    expect(degrees).toEqual([1, 6])
    expect(qualities).toEqual(['major', 'minor'])
  })

  it('demo-authentic-cadence-c-major reads as a root-position V then I and is classified perfect authentic', () => {
    const analysis = analyseScore(requireDemo('demo-authentic-cadence-c-major').score, cMajor)
    expect(analysis.chords.map((c) => c.numeral?.degree)).toEqual([5, 1])
    expect(analysis.chords.map((c) => c.numeral?.inversion)).toEqual([0, 0])
    expect(analysis.cadences.some((c) => c.type === 'perfect-authentic')).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // roadmap 5.10 — the six real demonstrations for the level 4-5 topics that
  // previously pointed at an existing-but-off-topic demo (see
  // `harmonyDemoScores.ts`'s own module comment for the full list of what was
  // closed). Same discipline as the 5.9a tests above: read the demo's own
  // notes back through the same theory core the lesson teaches from, never
  // just its title.
  // ---------------------------------------------------------------------------

  it("demo-g-major-to-g-dominant-seventh reads as V (triad), then V (dominant 7th) — the extra note roadmap 5.10's l4-seventh-chords lesson names", () => {
    const score = requireDemo('demo-g-major-to-g-dominant-seventh').score
    const analysis = analyseScore(score, cMajor)
    expect(analysis.chords.map((c) => c.numeral?.degree)).toEqual([5, 5])
    expect(analysis.chords.map((c) => c.numeral?.quality)).toEqual(['major', 'dominant7'])

    const rightHandNotesByMeasure = [0, 1].map(
      (m) => notesInMeasure(score, m).filter((n) => n.hand === 'right').length,
    )
    expect(rightHandNotesByMeasure, 'the triad has 3 right-hand notes, the 7th chord 4').toEqual([3, 4])
  })

  it('demo-four-cadence-types-c-major plays I-V-I-IV-I-V-vi — every degree/quality the four named cadence types need (roadmap 5.10)', () => {
    const analysis = analyseScore(requireDemo('demo-four-cadence-types-c-major').score, cMajor)
    expect(analysis.chords.map((c) => c.numeral?.degree)).toEqual([1, 5, 1, 4, 1, 5, 6])
    expect(analysis.chords.map((c) => c.numeral?.quality)).toEqual([
      'major',
      'major',
      'major',
      'major',
      'major',
      'major',
      'minor',
    ])
  })

  it('demo-four-cadence-types-c-major genuinely contains a perfect authentic, a plagal, a half and a deceptive cadence (roadmap 5.10)', () => {
    // Proven directly against `classifyCadence` on the same root-position
    // `Chord` objects `harmonyDemoScores.ts` builds the notes from, rather
    // than relying on `analyseScore`'s harmonic-run heuristics to surface
    // every internal pair — see that file's own comment on this demo for why.
    const cMajorTriad = buildChord(spell('C', 0, 4), 'major', 0)
    const gMajorTriad = buildChord(spell('G', 0, 4), 'major', 0)
    const fMajorTriad = buildChord(spell('F', 0, 4), 'major', 0)
    const aMinorTriad = buildChord(spell('A', 0, 4), 'minor', 0)
    const TONIC_C5 = midi(72)

    expect(classifyCadence(gMajorTriad, cMajorTriad, cMajor, TONIC_C5)).toBe('perfect-authentic')
    expect(classifyCadence(fMajorTriad, cMajorTriad, cMajor)).toBe('plagal')
    expect(classifyCadence(cMajorTriad, gMajorTriad, cMajor)).toBe('half')
    expect(classifyCadence(gMajorTriad, aMinorTriad, cMajor)).toBe('deceptive')
  })

  it('demo-common-progressions-c-major plays I-IV-V-I, then ii-V-I, then I-vi-IV-V — all three named progressions (roadmap 5.10)', () => {
    const analysis = analyseScore(requireDemo('demo-common-progressions-c-major').score, cMajor)
    expect(analysis.chords.map((c) => c.numeral?.degree)).toEqual([1, 4, 5, 1, 2, 5, 1, 1, 6, 4, 5])
    expect(analysis.chords.map((c) => c.numeral?.quality)).toEqual([
      'major',
      'major',
      'major',
      'major',
      'minor',
      'major',
      'major',
      'major',
      'minor',
      'major',
      'major',
    ])
  })

  it('demo-secondary-dominant-v-of-v-c-major reads D major as V/V (the applied dominant), resolving to plain V, then I (roadmap 5.10)', () => {
    const analysis = analyseScore(requireDemo('demo-secondary-dominant-v-of-v-c-major').score, cMajor)
    expect(analysis.chords.map((c) => c.numeral?.text)).toEqual(['V/V', 'V', 'I'])
    expect(analysis.chords[0]?.numeral?.appliedTo, 'D major is applied TO degree 5 (V)').toBe(5)
    expect(analysis.chords[1]?.numeral?.appliedTo, 'the plain G major V is not itself applied').toBeUndefined()
  })

  it('demo-modulation-c-major-to-g-major restates the identical G major triad as V in C, then as I in G — the pivot the lesson names (roadmap 5.10)', () => {
    const gMajorTriad = buildChord(spell('G', 0, 4), 'major', 0)
    const dMajorTriad = buildChord(spell('D', 0, 4), 'major', 0)
    const cMajorKey = keyFromFifths(0, 'major')
    const gMajorKey = keyFromFifths(1, 'major')

    expect(romanNumeralFor(gMajorTriad, cMajorKey)?.degree, 'G major is V in C major').toBe(5)
    expect(romanNumeralFor(gMajorTriad, gMajorKey)?.degree, 'the SAME chord is I in G major').toBe(1)
    expect(romanNumeralFor(dMajorTriad, gMajorKey)?.degree, "D major is G major's own V").toBe(5)
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

  it('demo-c-major-scale-two-octaves-hands-together keeps both hands two octaves apart at every simultaneous pair (roadmap 5.9a)', () => {
    const notes = requireDemo('demo-c-major-scale-two-octaves-hands-together').score.notes
    const byTick = new Map<number, { right?: number; left?: number }>()
    for (const n of notes) {
      const entry = byTick.get(n.startTick) ?? {}
      if (n.hand === 'right') entry.right = n.midi
      else entry.left = n.midi
      byTick.set(n.startTick, entry)
    }
    let pairsChecked = 0
    for (const { right, left } of byTick.values()) {
      if (right === undefined || left === undefined) continue
      expect(right - left).toBe(24)
      pairsChecked++
    }
    expect(pairsChecked).toBeGreaterThan(0)
    const rightNotes = notes.filter((n) => n.hand === 'right').map((n) => n.midi)
    expect(Math.max(...rightNotes) - Math.min(...rightNotes)).toBeGreaterThanOrEqual(24)
  })

  it('demo-rhythm-reading-eighth-notes actually contains eighth notes, not just quarters and a title (roadmap 5.9a)', () => {
    const notes = requireDemo('demo-rhythm-reading-eighth-notes').score.notes
    const EIGHTH_TICKS = TICKS_PER_QUARTER / 2
    expect(notes.some((n) => n.durationTicks === EIGHTH_TICKS)).toBe(true)
    expect(notes.every((n) => n.durationTicks <= TICKS_PER_QUARTER)).toBe(true)
  })

  it('demo-dotted-rhythm-3-4 pairs a dotted quarter with an eighth — the long-short pattern (roadmap 5.9a)', () => {
    const notes = requireDemo('demo-dotted-rhythm-3-4').score.notes
    const DOTTED_QUARTER_TICKS = (TICKS_PER_QUARTER * 3) / 2
    const EIGHTH_TICKS = TICKS_PER_QUARTER / 2
    let foundLongShortPair = false
    for (let i = 0; i + 1 < notes.length; i++) {
      const a = at(notes, i)
      const b = at(notes, i + 1)
      if (a.durationTicks === DOTTED_QUARTER_TICKS && b.durationTicks === EIGHTH_TICKS) {
        foundLongShortPair = true
      }
    }
    expect(foundLongShortPair).toBe(true)
  })

  it('demo-circle-of-fifths-c-g-f sounds no accidentals in the C bars, F# in the G bars, Bb in the F bars (roadmap 5.9a)', () => {
    const score = requireDemo('demo-circle-of-fifths-c-g-f').score
    const cBars = [...notesInMeasure(score, 0), ...notesInMeasure(score, 1)].map((n) => n.midi % 12)
    const gBars = [...notesInMeasure(score, 2), ...notesInMeasure(score, 3)].map((n) => n.midi % 12)
    const fBars = [...notesInMeasure(score, 4), ...notesInMeasure(score, 5)].map((n) => n.midi % 12)
    expect(cBars).not.toContain(6)
    expect(cBars).not.toContain(10)
    expect(gBars).toContain(6)
    expect(fBars).toContain(10)
  })

  it('demo-contrary-motion-different-rhythms-c moves the hands in opposite directions with different note values (roadmap 5.9a)', () => {
    const notes = requireDemo('demo-contrary-motion-different-rhythms-c').score.notes
    const rightNotes = notes.filter((n) => n.hand === 'right')
    const leftNotes = notes.filter((n) => n.hand === 'left')
    expect(rightNotes.length).toBeGreaterThan(0)
    expect(leftNotes.length).toBeGreaterThan(0)

    const rightDurations = new Set(rightNotes.map((n) => n.durationTicks))
    const leftDurations = new Set(leftNotes.map((n) => n.durationTicks))
    expect([...rightDurations].some((d) => leftDurations.has(d))).toBe(false)

    // Bar 1 (ticks 0..W): right hand rises, left hand falls.
    const barTicks = TICKS_PER_QUARTER * 4
    const rightBar1 = rightNotes.filter((n) => n.startTick < barTicks)
    const leftBar1 = leftNotes.filter((n) => n.startTick < barTicks)
    const rightBar1Direction = at(rightBar1, rightBar1.length - 1).midi - at(rightBar1, 0).midi
    const leftBar1Direction = at(leftBar1, leftBar1.length - 1).midi - at(leftBar1, 0).midi
    expect(rightBar1Direction).toBeGreaterThan(0)
    expect(leftBar1Direction).toBeLessThan(0)

    // Bar 2: directions swap, so both bars are genuinely contrary.
    const rightBar2 = rightNotes.filter((n) => n.startTick >= barTicks)
    const leftBar2 = leftNotes.filter((n) => n.startTick >= barTicks)
    const rightBar2Direction = at(rightBar2, rightBar2.length - 1).midi - at(rightBar2, 0).midi
    const leftBar2Direction = at(leftBar2, leftBar2.length - 1).midi - at(leftBar2, 0).midi
    expect(rightBar2Direction).toBeLessThan(0)
    expect(leftBar2Direction).toBeGreaterThan(0)
  })

  it('demo-a-minor-three-scale-forms actually sounds three different 6th/7th degrees, not the same scale three times (roadmap 5.10)', () => {
    const score = requireDemo('demo-a-minor-three-scale-forms').score
    const BAR8_TICKS = TICKS_PER_QUARTER * 8
    const naturalRun = score.notes.filter((n) => n.startTick < BAR8_TICKS).map((n) => n.midi % 12)
    const harmonicRun = score.notes
      .filter((n) => n.startTick >= BAR8_TICKS && n.startTick < BAR8_TICKS * 2)
      .map((n) => n.midi % 12)
    const melodicRun = score.notes.filter((n) => n.startTick >= BAR8_TICKS * 2).map((n) => n.midi % 12)

    // Natural minor: plain F and G, no raised 7th.
    expect(naturalRun).toContain(5) // F
    expect(naturalRun).toContain(7) // G
    expect(naturalRun).not.toContain(8) // G# — the harmonic/melodic raised 7th

    // Harmonic minor: raises the 7th (G#) but keeps the plain 6th (F).
    expect(harmonicRun).toContain(5) // F
    expect(harmonicRun).toContain(8) // G#
    expect(harmonicRun).not.toContain(6) // F# — only melodic minor raises the 6th

    // Melodic minor ascending: raises BOTH the 6th (F#) and 7th (G#).
    expect(melodicRun).toContain(6) // F#
    expect(melodicRun).toContain(8) // G#
    expect(melodicRun).not.toContain(5) // F natural

    expect(naturalRun.length).toBe(8)
    expect(harmonicRun.length).toBe(8)
    expect(melodicRun.length).toBe(8)
  })
})
