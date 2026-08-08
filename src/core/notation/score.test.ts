import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  chordGroups,
  filterHands,
  makeScore,
  measureAtTick,
  measureDurationTicks,
  measureRange,
  noteId,
  notesAtTick,
  notesInMeasure,
  notesInRange,
  pitchRange,
  scoreDurationTicks,
  soundingAtTick,
  validateScore,
  type Hand,
  type Score,
  type ScoreNote,
} from './score.ts'
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
    expect(soundingAtTick(score, T(0))).toEqual([])
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

describe('notesInRange', () => {
  it('is half-open: includes a note starting at `from`, excludes one starting at `to`', () => {
    // C major scale, quarter notes at 0, 480, 960, 1440, 1920, …
    expect(midis(notesInRange(C_MAJOR_SCALE_RH, T(480), T(1440)))).toEqual([62, 64])
    expect(midis(notesInRange(C_MAJOR_SCALE_RH, T(0), T(480)))).toEqual([60])
    expect(midis(notesInRange(C_MAJOR_SCALE_RH, T(481), T(960)))).toEqual([])
  })

  it('returns nothing for an empty or inverted range', () => {
    expect(notesInRange(C_MAJOR_SCALE_RH, T(480), T(480))).toEqual([])
    expect(notesInRange(C_MAJOR_SCALE_RH, T(960), T(480))).toEqual([])
  })

  it('clips at both ends of the score', () => {
    expect(midis(notesInRange(C_MAJOR_SCALE_RH, T(-1000), T(481)))).toEqual([60, 62])
    expect(midis(notesInRange(C_MAJOR_SCALE_RH, T(3360), T(99999)))).toEqual([72])
    expect(notesInRange(C_MAJOR_SCALE_RH, T(3361), T(99999))).toEqual([])
  })

  it('returns simultaneous notes low to high', () => {
    expect(midis(notesInRange(TWO_HAND_CHORDS, T(0), T(1)))).toEqual([48, 52, 55, 72])
  })
})

describe('notesInMeasure', () => {
  it('returns exactly the notes of that bar', () => {
    expect(midis(notesInMeasure(C_MAJOR_SCALE_RH, 0))).toEqual([60, 62, 64, 65])
    expect(midis(notesInMeasure(C_MAJOR_SCALE_RH, 1))).toEqual([67, 69, 71, 72])
    // The pickup bar holds only the upbeat G4.
    expect(midis(notesInMeasure(PICKUP_MEASURE, 0))).toEqual([67])
    expect(midis(notesInMeasure(PICKUP_MEASURE, 1))).toEqual([72, 74, 76])
  })

  it('returns nothing for an index outside the score', () => {
    expect(notesInMeasure(C_MAJOR_SCALE_RH, -1)).toEqual([])
    expect(notesInMeasure(C_MAJOR_SCALE_RH, 99)).toEqual([])
  })

  it('agrees with each note measureIndex', () => {
    for (let i = 0; i < TWO_HAND_CHORDS.measures.length; i++) {
      const inMeasure = notesInMeasure(TWO_HAND_CHORDS, i)
      expect(inMeasure.every((n) => n.measureIndex === i)).toBe(true)
      expect(inMeasure).toHaveLength(
        TWO_HAND_CHORDS.notes.filter((n) => n.measureIndex === i).length,
      )
    }
  })
})

describe('notesAtTick', () => {
  it('returns only notes whose onset is that tick', () => {
    expect(midis(notesAtTick(TWO_HAND_CHORDS, T(0)))).toEqual([48, 52, 55, 72])
    expect(midis(notesAtTick(TWO_HAND_CHORDS, T(480)))).toEqual([74])
    expect(notesAtTick(TWO_HAND_CHORDS, T(1))).toEqual([])
  })
})

describe('soundingAtTick', () => {
  it('returns notes being held, not just those starting', () => {
    // LH C major triad is a whole note; the RH is on its second quarter at 480.
    expect(midis(soundingAtTick(TWO_HAND_CHORDS, T(480)))).toEqual([48, 52, 55, 74])
    expect(midis(soundingAtTick(TWO_HAND_CHORDS, T(1919)))).toEqual([48, 52, 55, 77])
  })

  it('is half-open at the note end', () => {
    expect(midis(soundingAtTick(SINGLE_NOTE, T(479)))).toEqual([60])
    expect(soundingAtTick(SINGLE_NOTE, T(480))).toEqual([])
  })

  it('returns nothing before the first note or after the last', () => {
    expect(soundingAtTick(C_MAJOR_SCALE_RH, T(-1))).toEqual([])
    expect(soundingAtTick(C_MAJOR_SCALE_RH, T(3840))).toEqual([])
  })

  it('looks back by the maximum note duration the score carries', () => {
    expect(TIED_NOTES.maxNoteDurationTicks).toBe(960) // every note is a half note
    const first = soundingAtTick(TIED_NOTES, T(1920))
    const second = soundingAtTick(TIED_NOTES, T(1920))
    expect(ids(second)).toEqual(ids(first))
    expect(midis(second)).toEqual([60]) // the tied continuation of C4
  })

  it('finds a long note whose onset is far behind the tick', () => {
    // One 8-bar note: the look-back has to reach all the way to tick 0.
    const score = buildTestScore([{ midi: 60, startTick: 0, durationTicks: 8 * BAR }], {
      timeSignature: { beats: 32, beatType: 4 },
    })
    expect(score.maxNoteDurationTicks).toBe(8 * BAR)
    expect(midis(soundingAtTick(score, T(8 * BAR - 1)))).toEqual([60])
  })
})

describe('measureAtTick', () => {
  it('finds the measure containing the tick', () => {
    expect(measureAtTick(C_MAJOR_SCALE_RH, T(0))?.index).toBe(0)
    expect(measureAtTick(C_MAJOR_SCALE_RH, T(1919))?.index).toBe(0)
    expect(measureAtTick(C_MAJOR_SCALE_RH, T(1920))?.index).toBe(1)
    // 3/4 with a 480-tick pickup: bar 1 spans 480–1920.
    expect(measureAtTick(PICKUP_MEASURE, T(479))?.number).toBe('0')
    expect(measureAtTick(PICKUP_MEASURE, T(480))?.number).toBe('1')
    expect(measureAtTick(PICKUP_MEASURE, T(1920))?.number).toBe('2')
  })

  it('returns undefined outside the score', () => {
    expect(measureAtTick(C_MAJOR_SCALE_RH, T(-1))).toBeUndefined()
    expect(measureAtTick(C_MAJOR_SCALE_RH, T(3840))).toBeUndefined()
  })
})

describe('scoreDurationTicks', () => {
  it('runs to the end of the last measure', () => {
    expect(scoreDurationTicks(SINGLE_NOTE)).toBe(1920)
    expect(scoreDurationTicks(C_MAJOR_SCALE_RH)).toBe(3840)
    expect(scoreDurationTicks(PICKUP_MEASURE)).toBe(3360) // 480 + 1440 + 1440
    expect(scoreDurationTicks(SIX_EIGHT)).toBe(2880)
  })
})

describe('filterHands', () => {
  it('keeps one hand for hand-mute practice (REQ-3.2.3)', () => {
    const rh = filterHands(TWO_HAND_CHORDS, ['right'])
    expect(rh.notes.every((n) => n.hand === 'right')).toBe(true)
    expect(rh.notes).toHaveLength(13)
    expect(rh.staves).toEqual([{ staff: 1, clef: 'treble', hand: 'right' }])
    const lh = filterHands(TWO_HAND_CHORDS, ['left'])
    expect(lh.notes).toHaveLength(12)
    expect(lh.staves).toEqual([{ staff: 2, clef: 'bass', hand: 'left' }])
  })

  it('keeps measures, tempos and identity untouched', () => {
    const rh = filterHands(TWO_HAND_CHORDS, ['right'])
    expect(rh.id).toBe(TWO_HAND_CHORDS.id)
    expect(rh.measures).toBe(TWO_HAND_CHORDS.measures)
    expect(rh.tempos).toBe(TWO_HAND_CHORDS.tempos)
    expect(validateScore(rh).ok).toBe(true)
  })

  it('handles both hands and neither', () => {
    expect(filterHands(TWO_HAND_CHORDS, ['left', 'right']).notes).toHaveLength(
      TWO_HAND_CHORDS.notes.length,
    )
    expect(filterHands(TWO_HAND_CHORDS, []).notes).toEqual([])
  })

  it('keeps a staff a surviving note still stands on, after a mid-piece clef change', () => {
    // Staff 1 is declared treble/right, but bars 3–4 are written in bass clef,
    // so their notes carry hand 'left' on that same staff. Keeping only the
    // staves whose DECLARED hand survives answers [2] and leaves those notes
    // homeless. It takes a second staff to see that: on a one-staff score the
    // wrong answer is the empty list, which the "a score always has a staff"
    // fallback quietly restores to the very list that was wanted.
    const lh = filterHands(MID_PIECE_CLEF_CHANGE, ['left'])
    expect(lh.staves.map((s) => s.staff)).toEqual([1, 2])
    expect(lh.notes.filter((n) => n.staff === 1).map((n) => n.midi)).toEqual([48, 52, 55])
    expect(lh.notes.filter((n) => n.staff === 2)).toHaveLength(4)
    expect(errorOf(validateScore(lh))).not.toMatch(/undeclared staff 1/)
    expect(validateScore(lh).ok).toBe(true)
  })

  it('drops a staff no surviving note is written on', () => {
    // The mirror image: muting the left hand empties staff 2, and nothing is
    // left standing on it, so it goes.
    const rh = filterHands(MID_PIECE_CLEF_CHANGE, ['right'])
    expect(midis(rh.notes)).toEqual([72, 74, 76, 77, 79])
    expect(rh.staves).toEqual([{ staff: 1, clef: 'treble', hand: 'right' }])
    expect(validateScore(rh).ok).toBe(true)
  })

  it('keeps the staves when nothing survives — a score always has a staff', () => {
    const muted = filterHands(TWO_HAND_CHORDS, [])
    expect(muted.notes).toEqual([])
    expect(muted.staves).toEqual(TWO_HAND_CHORDS.staves)
    expect(validateScore(muted).ok).toBe(true)
    // Same for a hand this score never uses.
    const none = filterHands(C_MAJOR_SCALE_RH, ['left'])
    expect(none.notes).toEqual([])
    expect(validateScore(none).ok).toBe(true)
  })

  it('recomputes the longest surviving note', () => {
    const score = buildTestScore([
      { midi: 48, startTick: 0, durationTicks: 1920, hand: 'left' },
      { midi: 72, startTick: 0, durationTicks: 480, hand: 'right' },
    ])
    expect(score.maxNoteDurationTicks).toBe(1920)
    expect(filterHands(score, ['right']).maxNoteDurationTicks).toBe(480)
    expect(filterHands(score, []).maxNoteDurationTicks).toBe(0)
    // A stale maximum would make the LH whole note invisible mid-bar.
    expect(midis(soundingAtTick(filterHands(score, ['left']), T(1440)))).toEqual([48])
  })
})

describe('measureRange', () => {
  it('spans the given measures inclusively (REQ-3.2.3 looping)', () => {
    expect(measureRange(TWO_HAND_CHORDS, 1, 2)).toEqual({ startTick: 1920, endTick: 5760 })
    expect(measureRange(TWO_HAND_CHORDS, 0, 0)).toEqual({ startTick: 0, endTick: 1920 })
    expect(measureRange(PICKUP_MEASURE, 0, 2)).toEqual({ startTick: 0, endTick: 3360 })
  })

  it('swaps a backwards range and clamps out-of-range indices', () => {
    expect(measureRange(TWO_HAND_CHORDS, 2, 1)).toEqual({ startTick: 1920, endTick: 5760 })
    expect(measureRange(TWO_HAND_CHORDS, -5, 99)).toEqual({ startTick: 0, endTick: 7680 })
    expect(measureRange(TWO_HAND_CHORDS, 1.7, 1.2)).toEqual({ startTick: 1920, endTick: 3840 })
  })
})

describe('chordGroups', () => {
  it('groups notes sharing an onset', () => {
    const groups = chordGroups(TWO_HAND_CHORDS.notes)
    expect(groups.map((g) => midis(g))).toEqual([
      [48, 52, 55, 72], // bar 1 beat 1: C major triad under C5
      [74],
      [76],
      [77],
      [41, 45, 48, 77], // bar 2 beat 1: F major triad under F5
      [76],
      [74],
      [72],
      [43, 47, 50, 79], // bar 3 beat 1: G major triad under G5
      [77],
      [76],
      [74],
      [48, 52, 55, 72], // bar 4: C major triad under C5
    ])
  })

  it('gives each melody note its own group', () => {
    expect(chordGroups(C_MAJOR_SCALE_RH.notes)).toHaveLength(8)
  })

  it('skips tied continuations — no new key press is expected', () => {
    const groups = chordGroups(TIED_NOTES.notes)
    expect(groups.map((g) => midis(g))).toEqual([[64], [60], [67]])
    expect(groups.flat().every((n) => !n.tiedFrom)).toBe(true)
  })

  it('absorbs near-simultaneous onsets within the tolerance, measured from the anchor', () => {
    const score = buildTestScore([
      { midi: 60, startTick: 0 },
      { midi: 64, startTick: 8 },
      { midi: 67, startTick: 16 },
      { midi: 72, startTick: 480 },
    ])
    expect(chordGroups(score.notes, 10).map((g) => midis(g))).toEqual([[60, 64], [67], [72]])
    expect(chordGroups(score.notes, 20).map((g) => midis(g))).toEqual([[60, 64, 67], [72]])
    expect(chordGroups(score.notes, 0).map((g) => midis(g))).toEqual([[60], [64], [67], [72]])
  })

  it('rejects a negative tolerance', () => {
    expect(() => chordGroups(C_MAJOR_SCALE_RH.notes, -1)).toThrow(/negative tolerance/)
  })

  it('is empty for a score with no notes', () => {
    expect(chordGroups(makeScore({ id: 's', measures: [{}], notes: [] }).notes)).toEqual([])
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

type NoteSpec = { bar: number; beat: number; midi: number; hand: Hand; beats: number }

const noteSpecArb = fc.record<NoteSpec>({
  bar: fc.nat({ max: 5 }),
  beat: fc.nat({ max: 3 }),
  midi: fc.integer({ min: 40, max: 90 }),
  hand: fc.constantFrom<Hand>('left', 'right'),
  beats: fc.integer({ min: 1, max: 4 }),
})

/** Random but always-valid scores: 4/4, notes clipped so none crosses a barline. */
const scoreArb = fc.array(noteSpecArb, { maxLength: 25 }).map((specs) =>
  buildTestScore(
    specs.map((s) => ({
      midi: s.midi,
      startTick: s.bar * BAR + s.beat * 480,
      durationTicks: Math.min(s.beats, 4 - s.beat) * 480,
      hand: s.hand,
    })),
    { measureCount: Math.max(1, ...specs.map((s) => s.bar + 1)) },
  ),
)

/**
 * The other shape a real import produces: ONE staff, declared with the clef it
 * opened with, carrying notes of both hands because the clef changes mid-piece.
 */
const singleStaffScoreArb = fc.array(noteSpecArb, { maxLength: 15 }).map((specs) =>
  makeScore({
    id: 'single-staff-clef-change',
    measures: Array.from({ length: Math.max(1, ...specs.map((s) => s.bar + 1)) }, () => ({})),
    notes: specs.map((s) => ({
      midi: s.midi,
      startTick: s.bar * BAR + s.beat * 480,
      durationTicks: Math.min(s.beats, 4 - s.beat) * 480,
      hand: s.hand,
      staff: 1,
    })),
    staves: [{ staff: 1, clef: 'treble', hand: 'right' }],
  }),
)

/**
 * The shape that actually discriminates: a grand staff whose UPPER staff turned
 * bass clef part-way, so staff 1 is declared 'right' while always carrying at
 * least one left-hand note, and staff 2 is a plain bass staff. Filtering the
 * staves by declared hand alone answers [2] for hands=['left'], stranding the
 * staff-1 notes. On a one-staff score the same mistake answers [] and is hidden
 * by the fallback, which is why `singleStaffScoreArb` alone pinned nothing.
 */
const twoStaffScoreArb = fc.array(noteSpecArb, { maxLength: 15 }).map((specs) =>
  makeScore({
    id: 'two-staff-clef-change',
    measures: Array.from({ length: Math.max(1, ...specs.map((s) => s.bar + 1)) }, () => ({})),
    notes: [
      // A2 on the upper staff, in bass clef — always present, so every generated
      // case has a left-hand note standing on the staff declared 'right'.
      { midi: 45, startTick: 0, durationTicks: 480, hand: 'left' as const, staff: 1 },
      // E1 on the lower staff: an ordinary left-hand note on a staff declared 'left'.
      { midi: 28, startTick: 0, durationTicks: 480, hand: 'left' as const, staff: 2 },
      ...specs.map((s) => ({
        midi: s.midi,
        startTick: s.bar * BAR + s.beat * 480,
        durationTicks: Math.min(s.beats, 4 - s.beat) * 480,
        hand: s.hand,
        staff: 1,
      })),
    ],
    staves: [
      { staff: 1, clef: 'treble', hand: 'right' },
      { staff: 2, clef: 'bass', hand: 'left' },
    ],
  }),
)

const anyScoreArb = fc.oneof(scoreArb, singleStaffScoreArb, twoStaffScoreArb)
const HAND_SUBSETS: readonly (readonly Hand[])[] = [[], ['left'], ['right'], ['left', 'right']]

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

  it('notesInRange over the whole span returns every note exactly once', () => {
    fc.assert(
      fc.property(scoreArb, (score) => {
        const all = notesInRange(score, T(0), scoreDurationTicks(score))
        expect(ids(all)).toEqual(ids(score.notes))
      }),
    )
  })

  it('adjacent ranges concatenate to the union range', () => {
    fc.assert(
      fc.property(
        scoreArb,
        fc.integer({ min: -500, max: 12_000 }),
        fc.integer({ min: -500, max: 12_000 }),
        fc.integer({ min: -500, max: 12_000 }),
        (score, x, y, z) => {
          const [a, b, c] = [x, y, z].sort((p, q) => p - q) as [number, number, number]
          const left = notesInRange(score, T(a), T(b))
          const right = notesInRange(score, T(b), T(c))
          const whole = notesInRange(score, T(a), T(c))
          expect([...ids(left), ...ids(right)]).toEqual(ids(whole))
        },
      ),
    )
  })

  it('a range query and a filtering scan agree', () => {
    fc.assert(
      fc.property(
        scoreArb,
        fc.integer({ min: 0, max: 12_000 }),
        fc.integer({ min: 0, max: 12_000 }),
        (score, x, y) => {
          const from = Math.min(x, y)
          const to = Math.max(x, y)
          const scanned = score.notes.filter((n) => n.startTick >= from && n.startTick < to)
          expect(ids(notesInRange(score, T(from), T(to)))).toEqual(ids(scanned))
        },
      ),
    )
  })

  it('notesAtTick is the range of width one, and everything starting is also sounding', () => {
    fc.assert(
      fc.property(scoreArb, fc.integer({ min: 0, max: 12_000 }), (score, tick) => {
        expect(ids(notesAtTick(score, T(tick)))).toEqual(
          ids(notesInRange(score, T(tick), T(tick + 1))),
        )
        const sounding = new Set(ids(soundingAtTick(score, T(tick))))
        for (const n of notesAtTick(score, T(tick))) {
          expect(sounding.has(n.id)).toBe(n.durationTicks > 0)
        }
      }),
    )
  })

  it('soundingAtTick agrees with a full scan', () => {
    fc.assert(
      fc.property(scoreArb, fc.integer({ min: 0, max: 12_000 }), (score, tick) => {
        const scanned = score.notes.filter(
          (n) => n.startTick <= tick && tick < n.startTick + n.durationTicks,
        )
        expect(ids(soundingAtTick(score, T(tick)))).toEqual(ids(scanned))
      }),
    )
  })

  it('measureAtTick agrees with the measure each note claims', () => {
    fc.assert(
      fc.property(scoreArb, (score) => {
        for (const n of score.notes) {
          expect(measureAtTick(score, n.startTick)?.index).toBe(n.measureIndex)
        }
      }),
    )
  })

  it('splitting by hand partitions the notes', () => {
    fc.assert(
      fc.property(scoreArb, (score) => {
        const left = filterHands(score, ['left']).notes
        const right = filterHands(score, ['right']).notes
        expect(left.length + right.length).toBe(score.notes.length)
        expect(ids(filterHands(score, ['left', 'right']).notes)).toEqual(ids(score.notes))
      }),
    )
  })

  it('filterHands returns a structurally valid score for every hand subset', () => {
    fc.assert(
      fc.property(anyScoreArb, (score) => {
        for (const hands of HAND_SUBSETS) {
          const filtered = filterHands(score, hands)
          const checked = validateScore(filtered)
          expect(checked.ok, `hands=[${hands.join(',')}] ${errorOf(checked)}`).toBe(true)
          expect(ids(filtered.notes)).toEqual(
            ids(score.notes.filter((n) => hands.includes(n.hand))),
          )
          const declared = new Set(filtered.staves.map((s) => s.staff))
          for (const n of filtered.notes) expect(declared.has(n.staff)).toBe(true)
          // Never invents a staff, never returns none.
          const original = new Set(score.staves.map((s) => s.staff))
          expect(filtered.staves.length).toBeGreaterThan(0)
          for (const s of filtered.staves) expect(original.has(s.staff)).toBe(true)
        }
      }),
    )
  })

  it('keeps the staff a bass-clef passage on the upper staff is written on', () => {
    fc.assert(
      fc.property(twoStaffScoreArb, (score) => {
        // Staff 1 is declared 'right', but always carries a left-hand note, so
        // muting the right hand must keep BOTH staves. Muting the left hand
        // empties staff 2, which nothing then stands on, so it goes.
        expect(filterHands(score, ['left']).staves.map((s) => s.staff)).toEqual([1, 2])
        expect(filterHands(score, ['right']).staves.map((s) => s.staff)).toEqual([1])
      }),
    )
  })

  it('chordGroups partitions the notes that need a key press, in order', () => {
    fc.assert(
      fc.property(scoreArb, fc.nat({ max: 200 }), (score, tolerance) => {
        const groups = chordGroups(score.notes, tolerance)
        expect(groups.flatMap((g) => ids(g))).toEqual(ids(score.notes.filter((n) => !n.tiedFrom)))
        for (const group of groups) {
          const anchor = at(group, 0).startTick
          for (const n of group) expect(n.startTick - anchor).toBeLessThanOrEqual(tolerance)
        }
      }),
    )
  })

  it('with default tolerance, agrees with grouping by strict equality of startTick', () => {
    // `buildExpected` (core/practice/matcher.ts) used to re-derive its own grouping by
    // strict `startTick` equality before it was rewritten to call `chordGroups`. At
    // tolerance 0, `chordGroups`'s groups are exactly the maximal runs of equal
    // `startTick` — this pins that equivalence so an off-by-one in the tolerance
    // comparison (e.g. `>=` instead of `>`) breaks loudly instead of silently changing
    // matcher behaviour.
    fc.assert(
      fc.property(scoreArb, (score) => {
        const groups = chordGroups(score.notes)
        const strictGroups: ScoreNote[][] = []
        for (const n of score.notes) {
          if (n.tiedFrom) continue
          const last = strictGroups[strictGroups.length - 1]
          if (last !== undefined && at(last, 0).startTick === n.startTick) {
            last.push(n)
          } else {
            strictGroups.push([n])
          }
        }
        expect(groups.map((g) => ids(g))).toEqual(strictGroups.map((g) => ids(g)))
      }),
    )
  })

  it('measureRange covers exactly the notes of those measures', () => {
    fc.assert(
      fc.property(scoreArb, fc.nat({ max: 8 }), fc.nat({ max: 8 }), (score, from, to) => {
        const { startTick, endTick } = measureRange(score, from, to)
        const lo = Math.min(from, to, score.measures.length - 1)
        const hi = Math.min(Math.max(from, to), score.measures.length - 1)
        const expected = score.notes.filter((n) => n.measureIndex >= lo && n.measureIndex <= hi)
        expect(ids(notesInRange(score, startTick, endTick))).toEqual(ids(expected))
      }),
    )
  })
})

describe('query cost', () => {
  /** `count` quarter notes back to back, four to a bar. */
  const linearScore = (count: number): Score =>
    buildTestScore(
      Array.from({ length: count }, (_, i) => ({
        midi: 21 + (i % 88),
        startTick: i * 480,
        durationTicks: 480,
      })),
      { measureCount: Math.ceil(count / 4), id: `linear-${count}` },
    )

  const bigScore = linearScore(10_000)

  /**
   * Wraps `notes` so every indexed read is counted. That turns "is this a
   * binary search?" into an assertion about work done, with no wall clock in
   * it — a scan of n notes reads n entries, a binary search reads ~log2(n).
   */
  const counted = (score: Score): { readonly score: Score; reads: () => number } => {
    let reads = 0
    const notes = new Proxy(score.notes, {
      get(target, key, receiver): unknown {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1
        return Reflect.get(target, key, receiver)
      },
    })
    return { score: { ...score, notes }, reads: () => reads }
  }

  const readsForRangeQuery = (count: number): number => {
    const { score, reads } = counted(linearScore(count))
    // A window of two notes, in the middle of the score.
    const from = T(Math.floor(count / 2) * 480)
    expect(midis(notesInRange(score, from, T(from + 960)))).toHaveLength(2)
    return reads()
  }

  it('answers range queries by binary search: ten times the notes costs ~log2(10) more reads', () => {
    const small = readsForRangeQuery(1_000)
    const big = readsForRangeQuery(10_000)
    // A scan would read 9,000 more entries; a binary search reads log2(10) ≈ 3.3
    // more. Allow one probe of slack for where the boundaries fall.
    expect(big - small).toBeLessThanOrEqual(5)
    // And the absolute cost stays tiny — nowhere near the 10,000 notes present.
    expect(big).toBeLessThan(25)
  })

  it('costs the same wherever in the score the window falls', () => {
    const { score, reads } = counted(bigScore)
    const at0 = ((): number => {
      notesInRange(score, T(0), T(960))
      return reads()
    })()
    notesInRange(score, T(9_000 * 480), T(9_000 * 480 + 960))
    const atEnd = reads() - at0
    expect(Math.abs(atEnd - at0)).toBeLessThanOrEqual(3)
  })

  it('finds the last note and its measure without walking the score', () => {
    const last = at(bigScore.notes, 9_999)
    expect(ids(notesAtTick(bigScore, last.startTick))).toEqual([last.id])
    expect(measureAtTick(bigScore, last.startTick)?.index).toBe(2499)
    expect(soundingAtTick(bigScore, T(last.startTick + 100))).toHaveLength(1)
  })
})

describe('pitchRange', () => {
  it('reports the lowest and highest sounding pitch', () => {
    const score = buildTestScore(
      [
        { midi: 64, startTick: 0 },
        { midi: 55, startTick: 480 },
        { midi: 72, startTick: 960 },
        { midi: 60, startTick: 1440 },
      ],
      { measureCount: 1 },
    )
    expect(pitchRange(score)).toEqual({ low: 55, high: 72 })
  })

  it('is undefined for a score with no notes', () => {
    expect(pitchRange(buildTestScore([], { measureCount: 2 }))).toBeUndefined()
  })

  it('collapses to a single pitch for a one-note score', () => {
    expect(pitchRange(SINGLE_NOTE)).toEqual({
      low: at(SINGLE_NOTE.notes, 0).midi,
      high: at(SINGLE_NOTE.notes, 0).midi,
    })
  })

  it('includes tied continuations — a tie sounds a real pitch', () => {
    // TIED_NOTES' extremes must be found whether or not a note is a tie
    // continuation; filtering them (as the matcher does for onsets) would be
    // wrong here, and this fixture is the one that can tell the difference.
    const tiedMidis = TIED_NOTES.notes.map((n) => n.midi)
    expect(pitchRange(TIED_NOTES)).toEqual({
      low: Math.min(...tiedMidis),
      high: Math.max(...tiedMidis),
    })
    expect(TIED_NOTES.notes.some((n) => n.tiedFrom)).toBe(true)
  })

  it('brackets every note of every fixture', () => {
    for (const score of ALL_FIXTURES) {
      const range = pitchRange(score)
      if (score.notes.length === 0) {
        expect(range).toBeUndefined()
        continue
      }
      if (range === undefined) throw new Error(`${score.id}: expected a range`)
      for (const note of score.notes) {
        expect(note.midi).toBeGreaterThanOrEqual(range.low)
        expect(note.midi).toBeLessThanOrEqual(range.high)
      }
    }
  })

  it('property: low <= high, and both are pitches the score actually contains', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 21, max: 108 }), { minLength: 1, maxLength: 40 }),
        (pitches) => {
          const score = buildTestScore(
            pitches.map((midi, i) => ({ midi, startTick: i * 120 })),
            { measureCount: Math.ceil((pitches.length * 120) / BAR) + 1 },
          )
          const range = pitchRange(score)
          if (range === undefined) throw new Error('expected a range')
          expect(range.low).toBeLessThanOrEqual(range.high)
          expect(pitches).toContain(range.low)
          expect(pitches).toContain(range.high)
        },
      ),
    )
  })
})
