import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { makeScore, measureDurationTicks, noteId, validateScore, type Score, type ScoreNote } from './score.ts'
import {
  ALL_FIXTURES,
  buildTestScore,
  C_MAJOR_SCALE_RH,
  MID_PIECE_CLEF_CHANGE,
  PICKUP_MEASURE,
  SINGLE_NOTE,
  SIX_EIGHT,
  TEMPO_CHANGE,
  TIED_NOTES,
  TWO_HAND_CHORDS,
} from '@test/fixtures.ts'
import { at } from '@core/shared/invariant.ts'
import { bpm, ticks, type Midi, type Ticks } from '@core/shared/units.ts'
import { scoreArb } from '@test/scoreArbitraries.ts'

const T = (n: number): Ticks => ticks(n)
/** A MIDI number the constructor would refuse — for testing validateScore itself. */
const forgedMidi = (n: number): Midi => n as unknown as Midi
const BAR = 1920

const errorOf = (result: { ok: boolean; error?: string }): string =>
  result.ok ? '<unexpectedly ok>' : (result.error ?? '')

const ids = (notes: readonly ScoreNote[]): string[] => notes.map((n) => n.id)
const midis = (notes: readonly ScoreNote[]): number[] => notes.map((n) => n.midi)

/** Two bars of 4/4 with a C4 on beat 1 and an E4 on beat 2 — the mutation base. */
const baseScore = (): Score =>
  buildTestScore(
    [
      { midi: 60, startTick: 0 },
      { midi: 64, startTick: 480 },
    ],
    { measureCount: 2 },
  )

describe('measureDurationTicks', () => {
  it('measures common metres', () => {
    expect(measureDurationTicks({ beats: 4, beatType: 4 })).toBe(1920)
    expect(measureDurationTicks({ beats: 3, beatType: 4 })).toBe(1440)
    expect(measureDurationTicks({ beats: 6, beatType: 8 })).toBe(1440) // compound: 6 × 240
    expect(measureDurationTicks({ beats: 2, beatType: 2 })).toBe(1920) // cut time
    expect(measureDurationTicks({ beats: 7, beatType: 16 })).toBe(840)
  })

  it('rejects nonsense metres', () => {
    expect(() => measureDurationTicks({ beats: 0, beatType: 4 })).toThrow(/beats/)
    expect(() => measureDurationTicks({ beats: 1.5, beatType: 4 })).toThrow(/beats/)
    expect(() => measureDurationTicks({ beats: 4, beatType: 0 })).toThrow(/beat type/)
    expect(() => measureDurationTicks({ beats: 4, beatType: 7 })).toThrow(/tick-exact/)
  })
})

describe('noteId', () => {
  it('encodes measure, hand, tick and pitch', () => {
    expect(noteId({ measureIndex: 3, hand: 'right', startTick: 480, midi: 60 })).toBe('m3.r.480.60')
    expect(noteId({ measureIndex: 0, hand: 'left', startTick: 0, midi: 48 })).toBe('m0.l.0.48')
  })
})

describe('makeScore', () => {
  it('sorts notes by startTick, then by midi', () => {
    const score = buildTestScore([
      { midi: 67, startTick: 480 },
      { midi: 64, startTick: 0 },
      { midi: 60, startTick: 0 },
      { midi: 62, startTick: 480 },
    ])
    expect(midis(score.notes)).toEqual([60, 64, 62, 67])
    expect(score.notes.map((n) => n.startTick)).toEqual([0, 0, 480, 480])
  })

  it('assigns position-derived ids and disambiguates collisions', () => {
    const score = buildTestScore([
      { midi: 60, startTick: 480, hand: 'right' },
      { midi: 60, startTick: 480, hand: 'right', voice: 2 },
      { midi: 60, startTick: 480, hand: 'right', voice: 3 },
      { midi: 60, startTick: 480, hand: 'left' },
    ])
    // Same tick and same pitch: the sort is stable, so input order decides.
    expect(ids(score.notes)).toEqual([
      'm0.r.480.60',
      'm0.r.480.60#2',
      'm0.r.480.60#3',
      'm0.l.480.60',
    ])
  })

  it('derives measureIndex from startTick', () => {
    const score = buildTestScore([
      { midi: 60, startTick: 0 },
      { midi: 62, startTick: BAR - 480 },
      { midi: 64, startTick: BAR },
      { midi: 65, startTick: 2 * BAR },
    ])
    expect(score.notes.map((n) => n.measureIndex)).toEqual([0, 0, 1, 2])
    expect(score.measures).toHaveLength(3)
  })

  it('fills in defaults for the optional note fields', () => {
    const score = buildTestScore([{ midi: 60, startTick: 0, hand: 'left' }])
    const note = at(score.notes, 0)
    expect(note.velocity).toBe(64)
    expect(note.voice).toBe(1)
    expect(note.staff).toBe(2) // left hand defaults to the lower staff
    expect(note.tiedFrom).toBe(false)
    expect(note.tiedTo).toBe(false)
    expect('fingering' in note).toBe(false)
  })

  it('keeps explicitly given note fields', () => {
    const score = buildTestScore([
      {
        midi: 60,
        startTick: 0,
        voice: 2,
        staff: 1,
        velocity: 100,
        tiedFrom: true,
        tiedTo: true,
        fingering: 3,
      },
    ])
    expect(at(score.notes, 0)).toMatchObject({
      voice: 2,
      staff: 1,
      velocity: 100,
      tiedFrom: true,
      tiedTo: true,
      fingering: 3,
    })
  })

  it('carries a written spelling that sounds as the declared midi', () => {
    const score = buildTestScore([
      { midi: 65, startTick: 0, spelling: { letter: 'E', alter: 1, octave: 4 } }, // E#4 sounds F4
    ])
    expect(at(score.notes, 0).spelling).toEqual({ letter: 'E', alter: 1, octave: 4 })
  })

  it('omits spelling when the caller gave none', () => {
    const score = buildTestScore([{ midi: 60, startTick: 0 }])
    expect('spelling' in at(score.notes, 0)).toBe(false)
  })

  it('rejects a spelling that does not sound as the declared midi', () => {
    expect(() =>
      buildTestScore([
        { midi: 60, startTick: 0, spelling: { letter: 'E', alter: 1, octave: 4 } }, // E#4 sounds F4, not C4
      ]),
    ).toThrow(/spelling E#4 sounds as 65, not the declared midi 60/)
  })

  it('inherits time signature and key from the previous measure', () => {
    const score = makeScore({
      id: 's',
      measures: [{ timeSignature: { beats: 3, beatType: 4 }, keyFifths: 2 }, {}, { keyFifths: -3 }],
      notes: [],
    })
    expect(score.measures.map((m) => m.timeSignature)).toEqual([
      { beats: 3, beatType: 4 },
      { beats: 3, beatType: 4 },
      { beats: 3, beatType: 4 },
    ])
    expect(score.measures.map((m) => m.keyFifths)).toEqual([2, 2, -3])
    expect(score.measures.map((m) => m.startTick)).toEqual([0, 1440, 2880])
  })

  it('numbers measures from 1, or from 0 when the first bar is a pickup', () => {
    expect(C_MAJOR_SCALE_RH.measures.map((m) => m.number)).toEqual(['1', '2'])
    expect(PICKUP_MEASURE.measures.map((m) => m.number)).toEqual(['0', '1', '2'])
    const explicit = makeScore({
      id: 's',
      measures: [{ number: '1' }, { number: '1a' }],
      notes: [],
    })
    expect(explicit.measures.map((m) => m.number)).toEqual(['1', '1a'])
  })

  it('defaults the tempo map to 120 bpm at tick 0 and sorts what it is given', () => {
    expect(SINGLE_NOTE.tempos).toEqual([{ tick: 0, bpm: 120 }])
    const score = makeScore({
      id: 's',
      measures: [{}, {}],
      notes: [],
      tempos: [
        { tick: 1920, bpm: 60 },
        { tick: 0, bpm: 90 },
      ],
    })
    expect(score.tempos).toEqual([
      { tick: 0, bpm: 90 },
      { tick: 1920, bpm: 60 },
    ])
  })

  it('derives staves from the hands present, defaulting to a grand staff', () => {
    expect(SINGLE_NOTE.staves).toEqual([{ staff: 1, clef: 'treble', hand: 'right' }])
    expect(TWO_HAND_CHORDS.staves).toEqual([
      { staff: 1, clef: 'treble', hand: 'right' },
      { staff: 2, clef: 'bass', hand: 'left' },
    ])
    const empty = makeScore({ id: 's', measures: [{}], notes: [] })
    expect(empty.staves).toEqual([
      { staff: 1, clef: 'treble', hand: 'right' },
      { staff: 2, clef: 'bass', hand: 'left' },
    ])
  })

  it('accepts declared staves and sorts them by staff number', () => {
    const score = makeScore({
      id: 's',
      measures: [{}],
      notes: [{ midi: 60, startTick: 0, durationTicks: 480, hand: 'left', staff: 2 }],
      staves: [
        { staff: 2, clef: 'alto', hand: 'left' },
        { staff: 1, clef: 'tenor', hand: 'right' },
      ],
    })
    expect(score.staves.map((s) => s.staff)).toEqual([1, 2])
  })

  it('fills in meta, keeping source only when supplied', () => {
    const bare = makeScore({ id: 's', measures: [{}], notes: [] })
    expect(bare.meta).toEqual({ title: '', composer: '' })
    expect('source' in bare.meta).toBe(false)
    const full = makeScore({
      id: 's',
      meta: { title: 'Minuet', composer: 'Bach', source: 'imported.musicxml' },
      measures: [{}],
      notes: [],
    })
    expect(full.meta).toEqual({ title: 'Minuet', composer: 'Bach', source: 'imported.musicxml' })
  })

  it('rejects structurally impossible input', () => {
    expect(() => makeScore({ id: '', measures: [{}], notes: [] })).toThrow(/id must not be empty/)
    expect(() => makeScore({ id: 's', measures: [], notes: [] })).toThrow(/at least one measure/)
    expect(() => makeScore({ id: 's', measures: [{ durationTicks: 0 }], notes: [] })).toThrow(
      /positive integer/,
    )
    expect(() => makeScore({ id: 's', measures: [{ durationTicks: 1.5 }], notes: [] })).toThrow(
      /positive integer/,
    )
    expect(() => makeScore({ id: 's', measures: [{ keyFifths: 8 }], notes: [] })).toThrow(
      /keyFifths/,
    )
    expect(() =>
      makeScore({ id: 's', measures: [{}], notes: [], tempos: [{ tick: 480, bpm: 90 }] }),
    ).toThrow(/tempo mark at tick 0/)
    expect(() =>
      makeScore({
        id: 's',
        measures: [{}],
        notes: [],
        tempos: [
          { tick: 0, bpm: 90 },
          { tick: 0, bpm: 60 },
        ],
      }),
    ).toThrow(/two tempo marks/)
    expect(() =>
      makeScore({ id: 's', measures: [{}], notes: [], tempos: [{ tick: 0, bpm: 0 }] }),
    ).toThrow(/bpm must be positive/)
    expect(() =>
      makeScore({ id: 's', measures: [{}], notes: [], tempos: [{ tick: 1.5, bpm: 60 }] }),
    ).toThrow(/whole tick/)
  })

  it('rejects impossible notes', () => {
    const bad = (patch: Record<string, unknown>): (() => Score) => {
      const note = { midi: 60, startTick: 0, durationTicks: 480, hand: 'right', ...patch }
      return () => makeScore({ id: 's', measures: [{}], notes: [note as never] })
    }
    expect(bad({ midi: 128 })).toThrow(/midi out of range/)
    expect(bad({ midi: 60.5 })).toThrow(/midi out of range/)
    expect(bad({ startTick: -1 })).toThrow(/startTick/)
    expect(bad({ startTick: 0.5 })).toThrow(/startTick/)
    expect(bad({ durationTicks: -1 })).toThrow(/durationTicks/)
    expect(bad({ durationTicks: 1.5 })).toThrow(/durationTicks/)
    expect(bad({ velocity: 128 })).toThrow(/velocity/)
    expect(bad({ voice: 0 })).toThrow(/voice/)
    expect(bad({ staff: 0 })).toThrow(/staff/)
    expect(bad({ startTick: 1920 })).toThrow(/outside every measure/)
    expect(bad({ durationTicks: 1921 })).toThrow(/past the end of measure 0/)
  })

  it('rejects a note on a staff that was never declared', () => {
    expect(() =>
      makeScore({
        id: 's',
        measures: [{}],
        notes: [{ midi: 60, startTick: 0, durationTicks: 480, hand: 'right', staff: 3 }],
        staves: [{ staff: 1, clef: 'treble', hand: 'right' }],
      }),
    ).toThrow(/undeclared staff 3/)
  })

  it('rejects an empty staff list', () => {
    expect(() => makeScore({ id: 's', measures: [{}], notes: [], staves: [] })).toThrow(
      /staves must not be empty/,
    )
  })

  it('carries the longest note duration on the score itself', () => {
    const score = buildTestScore([
      { midi: 60, startTick: 0, durationTicks: 480 },
      { midi: 62, startTick: 480, durationTicks: 1440 },
      { midi: 64, startTick: 1920, durationTicks: 960 },
    ])
    expect(score.maxNoteDurationTicks).toBe(1440)
    expect(makeScore({ id: 's', measures: [{}], notes: [] }).maxNoteDurationTicks).toBe(0)
    expect(SINGLE_NOTE.maxNoteDurationTicks).toBe(480)
    expect(TWO_HAND_CHORDS.maxNoteDurationTicks).toBe(1920)
  })

  it('rejects a metre whose beat type is not a power of two', () => {
    const withBeatType =
      (beatType: number): (() => Score) =>
      () =>
        makeScore({ id: 's', measures: [{ timeSignature: { beats: 4, beatType } }], notes: [] })
    expect(withBeatType(3)).toThrow(/beat type 3, which is not a power of two/)
    expect(withBeatType(6)).toThrow(/not a power of two/)
    expect(withBeatType(12)).toThrow(/not a power of two/)
    for (const beatType of [1, 2, 4, 8, 16, 32, 64, 128]) {
      expect(withBeatType(beatType)().measures.length, `beatType ${beatType}`).toBe(1)
    }
  })

  it('allows a zero-length (grace) note', () => {
    const score = buildTestScore([{ midi: 60, startTick: 0, durationTicks: 0 }])
    expect(at(score.notes, 0).durationTicks).toBe(0)
  })
})

describe('validateScore', () => {
  it('accepts every shared fixture', () => {
    for (const fixture of ALL_FIXTURES) {
      expect(validateScore(fixture).ok, fixture.id).toBe(true)
    }
  })

  it('rejects notes that are not sorted by startTick', () => {
    const s = baseScore()
    const bad: Score = { ...s, notes: [at(s.notes, 1), at(s.notes, 0)] }
    expect(errorOf(validateScore(bad))).toMatch(/sorted by startTick then midi/)
  })

  it('rejects notes at the same tick that are not sorted by midi', () => {
    const s = buildTestScore([
      { midi: 60, startTick: 0 },
      { midi: 64, startTick: 0 },
    ])
    const bad: Score = { ...s, notes: [at(s.notes, 1), at(s.notes, 0)] }
    expect(errorOf(validateScore(bad))).toMatch(/sorted by startTick then midi/)
  })

  it('rejects a note that runs past the end of its measure', () => {
    const s = baseScore()
    const bad: Score = {
      ...s,
      notes: [{ ...at(s.notes, 0), durationTicks: T(BAR + 480) }, at(s.notes, 1)],
    }
    expect(errorOf(validateScore(bad))).toMatch(/past the end of measure 0/)
  })

  it('rejects a note that starts outside the measure it claims', () => {
    const s = baseScore()
    const bad: Score = { ...s, notes: [{ ...at(s.notes, 0), measureIndex: 1 }, at(s.notes, 1)] }
    expect(errorOf(validateScore(bad))).toMatch(/outside measure 1/)
  })

  it('rejects a note pointing at a measure that does not exist', () => {
    const s = baseScore()
    const bad: Score = { ...s, notes: [{ ...at(s.notes, 0), measureIndex: 9 }, at(s.notes, 1)] }
    expect(errorOf(validateScore(bad))).toMatch(/missing measure 9/)
  })

  it('rejects a gap between measures', () => {
    const s = baseScore()
    const bad: Score = {
      ...s,
      notes: [],
      measures: [at(s.measures, 0), { ...at(s.measures, 1), startTick: T(BAR + 240) }],
    }
    expect(errorOf(validateScore(bad))).toMatch(/must be contiguous from tick 0/)
  })

  it('rejects measures that do not start at tick 0', () => {
    const s = baseScore()
    const bad: Score = {
      ...s,
      notes: [],
      measures: [{ ...at(s.measures, 0), startTick: T(480) }, at(s.measures, 1)],
    }
    expect(errorOf(validateScore(bad))).toMatch(/expected 0/)
  })

  it('rejects a missing tick-0 tempo and an empty tempo map', () => {
    const s = baseScore()
    expect(errorOf(validateScore({ ...s, tempos: [{ tick: T(480), bpm: bpm(90) }] }))).toMatch(
      /no tempo mark at tick 0/,
    )
    expect(errorOf(validateScore({ ...s, tempos: [] }))).toMatch(/no tempo marks/)
  })

  it('rejects unsorted or nonsensical tempo marks', () => {
    const s = baseScore()
    const unsorted: Score = {
      ...s,
      tempos: [
        { tick: T(0), bpm: bpm(60) },
        { tick: T(960), bpm: bpm(90) },
        { tick: T(480), bpm: bpm(120) },
      ],
    }
    expect(errorOf(validateScore(unsorted))).toMatch(/ascending tick/)
    const zeroBpm: Score = {
      ...s,
      tempos: [
        { tick: T(0), bpm: bpm(120) },
        { tick: T(480), bpm: bpm(0) },
      ],
    }
    expect(errorOf(validateScore(zeroBpm))).toMatch(/bpm 0/)
  })

  it('rejects broken measure bookkeeping', () => {
    const s = baseScore()
    expect(errorOf(validateScore({ ...s, id: '' }))).toMatch(/id must not be empty/)
    expect(errorOf(validateScore({ ...s, measures: [], notes: [] }))).toMatch(/no measures/)
    expect(
      errorOf(
        validateScore({
          ...s,
          notes: [],
          measures: [{ ...at(s.measures, 0), index: 4 }, at(s.measures, 1)],
        }),
      ),
    ).toMatch(/carries index 4/)
    expect(
      errorOf(
        validateScore({
          ...s,
          notes: [],
          measures: [{ ...at(s.measures, 0), durationTicks: T(0) }],
        }),
      ),
    ).toMatch(/non-positive duration/)
    expect(
      errorOf(
        validateScore({
          ...s,
          notes: [],
          measures: [{ ...at(s.measures, 0), timeSignature: { beats: 0, beatType: 4 } }],
        }),
      ),
    ).toMatch(/invalid time signature/)
    expect(
      errorOf(
        validateScore({ ...s, notes: [], measures: [{ ...at(s.measures, 0), keyFifths: -9 }] }),
      ),
    ).toMatch(/outside -7\.\.7/)
  })

  it('rejects a metre whose beat type is not a power of two', () => {
    const s = baseScore()
    const withBeatType = (beatType: number): Score => ({
      ...s,
      notes: [],
      measures: [{ ...at(s.measures, 0), timeSignature: { beats: 4, beatType } }],
    })
    expect(errorOf(validateScore(withBeatType(3)))).toMatch(
      /measure 0 has beat type 3, which is not a power of two/,
    )
    expect(errorOf(validateScore(withBeatType(6)))).toMatch(/not a power of two/)
    expect(validateScore(withBeatType(8)).ok).toBe(true)
  })

  it('rejects a maxNoteDurationTicks that does not cover the notes', () => {
    const s = baseScore()
    expect(s.maxNoteDurationTicks).toBe(480)
    expect(errorOf(validateScore({ ...s, maxNoteDurationTicks: T(479) }))).toMatch(
      /past the declared maxNoteDurationTicks 479/,
    )
    expect(errorOf(validateScore({ ...s, maxNoteDurationTicks: T(-1) }))).toMatch(
      /maxNoteDurationTicks must be a whole tick/,
    )
    expect(errorOf(validateScore({ ...s, maxNoteDurationTicks: T(1.5) }))).toMatch(
      /maxNoteDurationTicks must be a whole tick/,
    )
    // Larger than needed is safe: the look-back just starts further back.
    expect(validateScore({ ...s, maxNoteDurationTicks: T(99_999) }).ok).toBe(true)
  })

  it('rejects broken staves', () => {
    const s = baseScore()
    expect(errorOf(validateScore({ ...s, staves: [] }))).toMatch(/no staves/)
    expect(
      errorOf(
        validateScore({
          ...s,
          staves: [
            { staff: 1, clef: 'treble', hand: 'right' },
            { staff: 1, clef: 'bass', hand: 'left' },
          ],
        }),
      ),
    ).toMatch(/unique staff numbers/)
    expect(
      errorOf(validateScore({ ...s, notes: [{ ...at(s.notes, 0), staff: 7 }, at(s.notes, 1)] })),
    ).toMatch(/undeclared staff 7/)
  })

  it('rejects broken notes', () => {
    const s = baseScore()
    const first = at(s.notes, 0)
    expect(errorOf(validateScore({ ...s, notes: [{ ...first, midi: forgedMidi(200) }] }))).toMatch(
      /outside 0\.\.127/,
    )
    expect(errorOf(validateScore({ ...s, notes: [{ ...first, velocity: -1 }] }))).toMatch(
      /velocity -1/,
    )
    expect(errorOf(validateScore({ ...s, notes: [{ ...first, durationTicks: T(-1) }] }))).toMatch(
      /negative duration/,
    )
    expect(errorOf(validateScore({ ...s, notes: [first, first] }))).toMatch(/duplicate note id/)
  })
})

describe('fixtures', () => {
  it('are the scores their names promise', () => {
    expect(SINGLE_NOTE.notes).toHaveLength(1)
    expect(C_MAJOR_SCALE_RH.notes.map((n) => n.fingering)).toEqual([1, 2, 3, 1, 2, 3, 4, 5])
    expect(TWO_HAND_CHORDS.measures).toHaveLength(4)
    expect(TIED_NOTES.notes.filter((n) => n.tiedTo)).toHaveLength(1)
    expect(TIED_NOTES.notes.filter((n) => n.tiedFrom)).toHaveLength(1)
    expect(at(PICKUP_MEASURE.measures, 0).durationTicks).toBe(480)
    expect(at(PICKUP_MEASURE.measures, 1).timeSignature).toEqual({ beats: 3, beatType: 4 })
    expect(at(SIX_EIGHT.measures, 0).timeSignature).toEqual({ beats: 6, beatType: 8 })
    expect(SIX_EIGHT.notes.filter((n) => n.measureIndex === 0)).toHaveLength(6)
    expect(TEMPO_CHANGE.tempos).toEqual([
      { tick: 0, bpm: 120 },
      { tick: 1920, bpm: 72 },
    ])
  })

  it('MID_PIECE_CLEF_CHANGE puts both hands on a staff declared right, next to a bass staff', () => {
    expect(MID_PIECE_CLEF_CHANGE.staves).toEqual([
      { staff: 1, clef: 'treble', hand: 'right' },
      { staff: 2, clef: 'bass', hand: 'left' },
    ])
    const upper = MID_PIECE_CLEF_CHANGE.notes.filter((n) => n.staff === 1)
    expect(upper.filter((n) => n.hand === 'left').map((n) => n.midi)).toEqual([48, 52, 55])
    expect(upper.filter((n) => n.hand === 'right')).toHaveLength(5)
    // The lower staff is a plain left-hand line: it is declared 'left', so it is
    // never what proves the filter looks at where the notes actually stand.
    const lower = MID_PIECE_CLEF_CHANGE.notes.filter((n) => n.staff === 2)
    expect(lower.map((n) => n.midi)).toEqual([36, 36, 36, 36])
    expect(lower.every((n) => n.hand === 'left')).toBe(true)
    expect(validateScore(MID_PIECE_CLEF_CHANGE).ok).toBe(true)
  })

  it('are frozen so one test cannot poison another', () => {
    expect(Object.isFrozen(SINGLE_NOTE)).toBe(true)
    expect(Object.isFrozen(SINGLE_NOTE.notes)).toBe(true)
    expect(Object.isFrozen(at(SINGLE_NOTE.notes, 0))).toBe(true)
  })

  it('buildTestScore honours its options', () => {
    const score = buildTestScore([{ midi: 60, startTick: 0 }], {
      id: 'custom',
      title: 'Custom',
      composer: 'Me',
      keyFifths: -2,
      measureCount: 3,
      bpm: 88,
    })
    expect(score.id).toBe('custom')
    expect(score.meta).toEqual({ title: 'Custom', composer: 'Me' })
    expect(score.measures).toHaveLength(3)
    expect(at(score.measures, 2).keyFifths).toBe(-2)
    expect(score.tempos).toEqual([{ tick: 0, bpm: 88 }])
  })

  it('buildTestScore makes a one-measure score when there are no notes', () => {
    expect(buildTestScore([]).measures).toHaveLength(1)
  })
})

// ---------------------------------------------------------------- property tests

describe('score properties', () => {
  it('every generated score is valid and sorted', () => {
    fc.assert(
      fc.property(scoreArb, (score) => {
        expect(validateScore(score).ok).toBe(true)
        for (let i = 1; i < score.notes.length; i++) {
          const a = at(score.notes, i - 1)
          const b = at(score.notes, i)
          expect(
            a.startTick < b.startTick || (a.startTick === b.startTick && a.midi <= b.midi),
          ).toBe(true)
        }
      }),
    )
  })
})

