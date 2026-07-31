import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  buildTestScore,
  C_MAJOR_SCALE_RH,
  TIED_NOTES,
  TWO_HAND_CHORDS,
  type TestNote,
} from '@core/notation/fixtures.ts'
import type { Hand, Score } from '@core/notation/score.ts'
import { InvariantError, at } from '@core/shared/invariant.ts'
import {
  EIGHTH,
  QUARTER,
  SIXTEENTH,
  WHOLE,
  midi as asMidi,
  millis as asMillis,
  type Midi,
  type Millis,
} from '@core/shared/units.ts'
import { makeTempoMap, tickToMs, type TempoMap } from '@core/timing/tempo.ts'
import {
  MATCHER_DEFAULTS,
  NoteMatcher,
  type MatchResult,
  type MatcherSettings,
  type NoteVerdict,
} from './matcher.ts'

// -------------------------------------------------------------------- helpers

const tempoFor = (score: Score, scale = 1): TempoMap => makeTempoMap(score.tempos, scale)

const matcherFor = (score: Score, settings?: MatcherSettings, scale = 1): NoteMatcher =>
  new NoteMatcher(score, tempoFor(score, scale), settings)

const press = (matcher: NoteMatcher, note: number, atMs: number): readonly MatchResult[] =>
  matcher.noteOn(asMidi(note), asMillis(atMs))

/** One press, one verdict — the common case, asserted as such. */
const verdictOf = (matcher: NoteMatcher, note: number, atMs: number): MatchResult => {
  const produced = press(matcher, note, atMs)
  expect(produced).toHaveLength(1)
  return at(produced, 0)
}

const verdicts = (results: readonly MatchResult[]): NoteVerdict[] => results.map((r) => r.verdict)

const timings = (results: readonly MatchResult[]): (string | undefined)[] =>
  results.map((r) => r.timing)

/** Play a score back exactly as written, then let every remaining window close. */
const replayExactly = (score: Score, tempo: TempoMap, matcher: NoteMatcher): void => {
  let last = 0
  for (const note of score.notes) {
    if (note.tiedFrom) continue
    const t = tickToMs(tempo, note.startTick)
    matcher.noteOn(note.midi, t)
    last = t
  }
  matcher.advanceTo(asMillis(last + 10_000))
}

/**
 * A one-bar test score. At the default 120 bpm a quarter note is 500 ms, so a
 * note on tick 480 is expected at 500 ms — every millisecond below is derived
 * that way.
 */
const scoreOf = (notes: readonly TestNote[], id = 'matcher-test'): Score =>
  buildTestScore(notes, { id })

/** C4 on beat 1, D4 on beat 2 → expected at 0 ms and 500 ms. */
const TWO_NOTES = scoreOf(
  [
    { midi: 60, startTick: 0 },
    { midi: 62, startTick: QUARTER },
  ],
  'two-notes',
)

/** A C major triad, all three notes on beat 1 → all expected at 0 ms. */
const C_TRIAD = scoreOf(
  [60, 64, 67].map((midi) => ({ midi, startTick: 0, durationTicks: WHOLE })),
  'c-triad',
)

/** The same pitch three times in quick succession: eighths at 0, 250 and 500 ms. */
const REPEATED_C = scoreOf(
  [0, 1, 2].map((i) => ({ midi: 60, startTick: i * EIGHTH, durationTicks: EIGHTH })),
  'repeated-c',
)

/** A single C4 on beat 3 → expected at 1000 ms, with room to play early. */
const LATE_C = scoreOf([{ midi: 60, startTick: 2 * QUARTER }], 'late-c')

/** One C4 on beat 1 — the smallest score a fumble can be judged against. */
const SINGLE_C = scoreOf([{ midi: 60, startTick: 0 }], 'single-c')

const THIRTY_SECOND = SIXTEENTH / 2

/**
 * Five even 32nd notes from beat 1. At 120 bpm they are 62.5 ms apart — closer
 * together than the 80 ms default chord window, and still five separate onsets.
 */
const RUN_32ND = scoreOf(
  [60, 62, 64, 65, 67].map((midi, i) => ({
    midi,
    startTick: i * THIRTY_SECOND,
    durationTicks: THIRTY_SECOND,
  })),
  'run-32nd',
)

/** Four 16th notes: 125 ms apart at practice speed 1, but 62.5 ms apart at speed 2. */
const RUN_16TH = scoreOf(
  [60, 62, 64, 65].map((midi, i) => ({ midi, startTick: i * SIXTEENTH, durationTicks: SIXTEENTH })),
  'run-16th',
)

/** A C major triad on beat 1, then a D5 a 32nd later: one chord and one melody note. */
const TRIAD_THEN_MELODY = scoreOf(
  [
    ...[60, 64, 67].map((midi) => ({ midi, startTick: 0, durationTicks: QUARTER })),
    { midi: 74, startTick: THIRTY_SECOND, durationTicks: THIRTY_SECOND },
  ],
  'triad-then-melody',
)

// ================================================================== happy path

describe('NoteMatcher — a run-through with no mistakes', () => {
  // C4 D4 E4 F4 | G4 A4 B4 C5 as quarter notes at 120 bpm: one note every 500 ms.
  const SCALE_PITCHES = [60, 62, 64, 65, 67, 69, 71, 72]

  it('scores a perfect C major scale as 100% correct', () => {
    const matcher = matcherFor(C_MAJOR_SCALE_RH)
    SCALE_PITCHES.forEach((pitch, i) => {
      const result = verdictOf(matcher, pitch, i * 500)
      expect(result.verdict).toBe('correct')
      expect(result.timing).toBe('onTime')
      expect(result.deviationMs).toBe(0)
      expect(result.expected?.midi).toBe(pitch)
      expect(result.playedMidi).toBe(pitch)
    })
    expect(matcher.advanceTo(asMillis(10_000))).toHaveLength(0)
    expect(matcher.summary()).toEqual({
      correct: 8,
      wrongPitch: 0,
      missed: 0,
      extra: 0,
      accuracy: 1,
      meanAbsDeviationMs: 0,
    })
    expect(matcher.pendingNotes()).toHaveLength(0)
    expect(matcher.results).toHaveLength(8)
  })

  it('scores a perfect two-hand run-through, chords included', () => {
    // 12 left-hand triad notes + 13 right-hand melody notes = 25.
    const tempo = tempoFor(TWO_HAND_CHORDS)
    const matcher = new NoteMatcher(TWO_HAND_CHORDS, tempo)
    replayExactly(TWO_HAND_CHORDS, tempo, matcher)
    expect(TWO_HAND_CHORDS.notes).toHaveLength(25)
    expect(matcher.summary().correct).toBe(25)
    expect(matcher.summary().accuracy).toBe(1)
    expect(verdicts(matcher.results).every((v) => v === 'correct')).toBe(true)
  })

  it('starts with every expected note pending and empties as they are played', () => {
    const matcher = matcherFor(C_MAJOR_SCALE_RH)
    expect(matcher.pendingNotes()).toHaveLength(8)
    press(matcher, 60, 0)
    expect(matcher.pendingNotes()).toHaveLength(7)
    expect(at(matcher.pendingNotes(), 0).midi).toBe(62)
  })

  it('reports an empty score as nothing to get wrong', () => {
    const matcher = matcherFor(scoreOf([], 'empty'))
    expect(matcher.pendingNotes()).toHaveLength(0)
    expect(matcher.summary()).toEqual({
      correct: 0,
      wrongPitch: 0,
      missed: 0,
      extra: 0,
      accuracy: 1,
      meanAbsDeviationMs: 0,
    })
    expect(verdictOf(matcher, 60, 0).verdict).toBe('extra')
  })
})

// ============================================================== failure modes

describe('NoteMatcher — dropped, doubled and wrong notes', () => {
  it('reports a dropped note as missed once its window closes', () => {
    const matcher = matcherFor(C_MAJOR_SCALE_RH)
    // Skip F4 (the 4th note, expected at 1500 ms).
    const played = [
      [60, 0],
      [62, 500],
      [64, 1000],
      [67, 2000],
      [69, 2500],
      [71, 3000],
      [72, 3500],
    ] as const
    const produced = played.flatMap(([pitch, t]) => [...press(matcher, pitch, t)])
    expect(verdicts(produced)).toEqual([
      'correct',
      'correct',
      'correct',
      // The G4 press at 2000 ms first closes F4's window (1500 + 150 = 1650).
      'missed',
      'correct',
      'correct',
      'correct',
      'correct',
    ])
    const missed = produced.filter((r) => r.verdict === 'missed')
    expect(at(missed, 0).expected?.midi).toBe(65)
    expect(at(missed, 0).atMs).toBe(1650)
    expect(at(missed, 0).playedMidi).toBeUndefined()
    expect(at(missed, 0).timing).toBeUndefined()
    expect(matcher.summary()).toMatchObject({ correct: 7, missed: 1, extra: 0, wrongPitch: 0 })
    expect(matcher.summary().accuracy).toBeCloseTo(7 / 8, 10)
  })

  it('reports every unplayed note as missed when nothing is played at all', () => {
    const matcher = matcherFor(C_MAJOR_SCALE_RH)
    const produced = matcher.advanceTo(asMillis(10_000))
    expect(produced).toHaveLength(8)
    expect(verdicts(produced).every((v) => v === 'missed')).toBe(true)
    expect(matcher.summary().accuracy).toBe(0)
    expect(matcher.pendingNotes()).toHaveLength(0)
  })

  it('reports a doubled note as one extra, not as a substitution for the next note', () => {
    const matcher = matcherFor(TWO_NOTES)
    expect(verdictOf(matcher, 60, 0).verdict).toBe('correct')
    const stutter = verdictOf(matcher, 60, 60)
    expect(stutter.verdict).toBe('extra')
    expect(stutter.expected).toBeUndefined()
    expect(stutter.timing).toBeUndefined()
    expect(stutter.deviationMs).toBeUndefined()
    expect(stutter.playedMidi).toBe(60)
    // The D4 that follows is still matched normally.
    expect(verdictOf(matcher, 62, 500).verdict).toBe('correct')
    expect(matcher.summary()).toMatchObject({ correct: 2, extra: 1, missed: 0, wrongPitch: 0 })
  })

  it('reports a wrong key as one wrongPitch, not an extra plus a missed', () => {
    const matcher = matcherFor(TWO_NOTES)
    // E4 played where C4 was written.
    const wrong = verdictOf(matcher, 64, 10)
    expect(wrong.verdict).toBe('wrongPitch')
    expect(wrong.expected?.midi).toBe(60)
    expect(wrong.playedMidi).toBe(64)
    expect(wrong.deviationMs).toBe(10)
    expect(wrong.timing).toBe('onTime')
    expect(verdictOf(matcher, 62, 500).verdict).toBe('correct')
    expect(matcher.advanceTo(asMillis(5000))).toHaveLength(0)
    expect(matcher.summary()).toMatchObject({ correct: 1, wrongPitch: 1, missed: 0, extra: 0 })
  })

  it('charges a wrong key to a note already due before one still upcoming', () => {
    // C4 at 0 ms, D4 at 500 ms; a wrong key at 400 ms is inside both windows.
    const matcher = matcherFor(TWO_NOTES, { toleranceMs: 500 })
    const wrong = verdictOf(matcher, 66, 400)
    expect(wrong.verdict).toBe('wrongPitch')
    expect(wrong.expected?.midi).toBe(60)
  })

  it('charges a wrong key played early to the note that is still upcoming', () => {
    const matcher = matcherFor(LATE_C)
    const wrong = verdictOf(matcher, 66, 900)
    expect(wrong.verdict).toBe('wrongPitch')
    expect(wrong.expected?.midi).toBe(60)
    expect(wrong.deviationMs).toBe(-100)
    expect(wrong.timing).toBe('early')
  })

  it('reports a key that matches nothing at all as extra', () => {
    const matcher = matcherFor(TWO_NOTES)
    // `replayExactly` pumps the clock to 10 500 ms, so the stray press is later.
    replayExactly(TWO_NOTES, tempoFor(TWO_NOTES), matcher)
    const stray = verdictOf(matcher, 61, 11_000)
    expect(stray.verdict).toBe('extra')
    expect(stray.atMs).toBe(11_000)
    expect(matcher.summary()).toMatchObject({ correct: 2, extra: 1 })
  })
})

// =========================================================== self-correction

describe('NoteMatcher — wrong note, then the right one', () => {
  it('credits the correction and charges the fumble once', () => {
    const matcher = matcherFor(SINGLE_C)
    const fumble = verdictOf(matcher, 64, 0)
    expect(fumble.verdict).toBe('wrongPitch')
    expect(fumble.expected?.midi).toBe(60)
    // The charge does not decide the note: it stays matchable for its window.
    const fixed = verdictOf(matcher, 60, 40)
    expect(fixed.verdict).toBe('correct')
    expect(fixed.expected?.id).toBe(fumble.expected?.id)
    expect(fixed.deviationMs).toBe(40)
    expect(matcher.advanceTo(asMillis(5000))).toHaveLength(0)
    expect(matcher.summary()).toMatchObject({ correct: 1, wrongPitch: 1, missed: 0, extra: 0 })
    expect(matcher.summary().accuracy).toBe(0.5)
  })

  it('leaves the note after the fumble to be played normally', () => {
    const matcher = matcherFor(TWO_NOTES)
    expect(verdictOf(matcher, 64, 0).verdict).toBe('wrongPitch')
    expect(verdictOf(matcher, 60, 40).verdict).toBe('correct')
    expect(verdictOf(matcher, 62, 500).verdict).toBe('correct')
    expect(matcher.summary()).toMatchObject({ correct: 2, wrongPitch: 1, missed: 0, extra: 0 })
  })

  it('charges one note at most once, so hammering wrong keys is not compound', () => {
    const matcher = matcherFor(SINGLE_C)
    expect(verdictOf(matcher, 64, 0).verdict).toBe('wrongPitch')
    expect(verdictOf(matcher, 66, 40).verdict).toBe('extra')
    matcher.advanceTo(asMillis(5000))
    expect(matcher.summary()).toMatchObject({ correct: 0, wrongPitch: 1, missed: 0, extra: 1 })
  })

  it('does not also report a missed note when the correction never comes', () => {
    const matcher = matcherFor(SINGLE_C)
    expect(verdictOf(matcher, 64, 0).verdict).toBe('wrongPitch')
    expect(matcher.advanceTo(asMillis(5000))).toHaveLength(0)
    expect(matcher.pendingNotes()).toHaveLength(0)
    expect(matcher.summary()).toMatchObject({ correct: 0, wrongPitch: 1, missed: 0, extra: 0 })
  })

  it('treats a correction that arrives after the window as an extra', () => {
    const matcher = matcherFor(SINGLE_C)
    expect(verdictOf(matcher, 64, 0).verdict).toBe('wrongPitch')
    // 200 ms is past the 150 ms window: the note closed (silently) at 150.
    expect(verdictOf(matcher, 60, 200).verdict).toBe('extra')
    expect(matcher.summary()).toMatchObject({ correct: 0, wrongPitch: 1, missed: 0, extra: 1 })
  })
})

// =================================================================== octaves

describe('NoteMatcher — octave errors', () => {
  it('calls a note played an octave low a wrongPitch by default', () => {
    const matcher = matcherFor(TWO_NOTES)
    const result = verdictOf(matcher, 48, 10)
    expect(result.verdict).toBe('wrongPitch')
    expect(result.expected?.midi).toBe(60)
    expect(result.playedMidi).toBe(48)
  })

  it('accepts a note played an octave low when ignoreOctaveErrors is on', () => {
    const matcher = matcherFor(TWO_NOTES, { ignoreOctaveErrors: true })
    const result = verdictOf(matcher, 48, 10)
    expect(result.verdict).toBe('correct')
    expect(result.expected?.midi).toBe(60)
    expect(result.playedMidi).toBe(48)
    expect(result.deviationMs).toBe(10)
  })

  it('still rejects a non-octave error when ignoreOctaveErrors is on', () => {
    const matcher = matcherFor(TWO_NOTES, { ignoreOctaveErrors: true })
    // 61 is a semitone above C4, not an octave — still wrong.
    expect(verdictOf(matcher, 61, 10).verdict).toBe('wrongPitch')
  })

  it('accepts two octaves up as well as one octave down', () => {
    const matcher = matcherFor(TWO_NOTES, { ignoreOctaveErrors: true })
    expect(verdictOf(matcher, 84, 10).verdict).toBe('correct')
  })
})

// ==================================================================== chords

describe('NoteMatcher — chords', () => {
  it('accepts a chord played in any order', () => {
    const matcher = matcherFor(C_TRIAD)
    expect(
      verdicts([...press(matcher, 67, 0), ...press(matcher, 60, 5), ...press(matcher, 64, 10)]),
    ).toEqual(['correct', 'correct', 'correct'])
    expect(matcher.pendingNotes()).toHaveLength(0)
  })

  it('treats a chord rolled inside chordWindowMs as simultaneous', () => {
    const matcher = matcherFor(C_TRIAD)
    const produced = [
      ...press(matcher, 60, 0),
      ...press(matcher, 64, 40),
      ...press(matcher, 67, 75),
    ]
    expect(verdicts(produced)).toEqual(['correct', 'correct', 'correct'])
    // 75 ms is past the 50 ms onTime band but inside the 80 ms chord window.
    expect(timings(produced)).toEqual(['onTime', 'onTime', 'onTime'])
  })

  it('does not widen the onTime band for a note that is not in a chord', () => {
    // The 32nds are 62.5 ms apart, well inside the 80 ms chord window, but they
    // are five written onsets — so each is judged on the plain 50 ms band.
    const result = verdictOf(matcherFor(RUN_32ND), 60, 70)
    expect(result.verdict).toBe('correct')
    expect(result.deviationMs).toBe(70)
    expect(result.timing).toBe('late')
    // The same for a melody note whose neighbours are nowhere near.
    expect(verdictOf(matcherFor(TWO_NOTES), 60, 75).timing).toBe('late')
  })

  it('flags a chord rolled past chordWindowMs as late, but still correct', () => {
    const matcher = matcherFor(C_TRIAD)
    const produced = [
      ...press(matcher, 60, 0),
      ...press(matcher, 64, 100),
      ...press(matcher, 67, 140),
    ]
    expect(verdicts(produced)).toEqual(['correct', 'correct', 'correct'])
    expect(timings(produced)).toEqual(['onTime', 'late', 'late'])
  })

  it('drops a chord note rolled past toleranceMs', () => {
    const matcher = matcherFor(C_TRIAD)
    const produced = [
      ...press(matcher, 60, 0),
      ...press(matcher, 64, 100),
      ...press(matcher, 67, 300),
    ]
    expect(verdicts(produced)).toEqual(['correct', 'correct', 'missed', 'extra'])
    const missed = at(produced, 2)
    expect(missed.expected?.midi).toBe(67)
    expect(missed.atMs).toBe(150)
  })

  it('honours a chordWindowMs of 0 — every chord note is judged on its own', () => {
    const matcher = matcherFor(C_TRIAD, { chordWindowMs: 0 })
    expect(verdictOf(matcher, 60, 0).timing).toBe('onTime')
    expect(verdictOf(matcher, 64, 75).timing).toBe('late')
  })
})

// ============================================= what counts as a chord (onsets)

describe('NoteMatcher — a chord is a shared onset, not a short gap', () => {
  it('gives every note of an even run the same verdict for the same error', () => {
    const matcher = matcherFor(RUN_32ND)
    const LAG = 70
    const produced = [60, 62, 64, 65, 67].map((midi, i) => verdictOf(matcher, midi, i * 62.5 + LAG))
    expect(verdicts(produced)).toEqual(['correct', 'correct', 'correct', 'correct', 'correct'])
    expect(produced.map((r) => r.deviationMs)).toEqual([LAG, LAG, LAG, LAG, LAG])
    // One error, one verdict — not four onTimes and a late decided by where a
    // rolling millisecond window happened to break the run into groups.
    expect(timings(produced)).toEqual(['late', 'late', 'late', 'late', 'late'])
  })

  it('does not let a melody note inherit the band of the chord in front of it', () => {
    // The D5 is written a 32nd (62.5 ms) after the triad, so it is its own onset.
    const result = verdictOf(matcherFor(TRIAD_THEN_MELODY), 74, 140)
    expect(result.verdict).toBe('correct')
    expect(result.deviationMs).toBe(77.5)
    expect(result.timing).toBe('late')
    // …while the triad it follows still gets the wide band.
    const rolled = matcherFor(TRIAD_THEN_MELODY)
    expect(verdictOf(rolled, 60, 0).timing).toBe('onTime')
    expect(verdictOf(rolled, 64, 75).timing).toBe('onTime')
  })

  it('does not loosen the judgment as the practice tempo rises', () => {
    // At speed 2 the 16ths fall 62.5 ms apart. Practising faster must not buy a
    // wider onTime band: the same 70 ms error is late at either speed.
    for (const scale of [1, 2]) {
      const result = verdictOf(matcherFor(RUN_16TH, undefined, scale), 60, 70)
      expect(result.verdict).toBe('correct')
      expect(result.deviationMs).toBe(70)
      expect(result.timing).toBe('late')
    }
  })
})

// ================================================================== timing

describe('NoteMatcher — timing verdicts', () => {
  it('calls a note played ahead of the beat early', () => {
    const matcher = matcherFor(LATE_C)
    const result = verdictOf(matcher, 60, 880)
    expect(result.verdict).toBe('correct')
    expect(result.timing).toBe('early')
    expect(result.deviationMs).toBe(-120)
  })

  it('calls a note played behind the beat late', () => {
    const matcher = matcherFor(LATE_C)
    const result = verdictOf(matcher, 60, 1120)
    expect(result.verdict).toBe('correct')
    expect(result.timing).toBe('late')
    expect(result.deviationMs).toBe(120)
  })

  it('drops a note played so far ahead that it misses the window', () => {
    const matcher = matcherFor(LATE_C)
    expect(verdictOf(matcher, 60, 800).verdict).toBe('extra')
    expect(verdicts(matcher.advanceTo(asMillis(2000)))).toEqual(['missed'])
    expect(matcher.summary()).toMatchObject({ correct: 0, extra: 1, missed: 1 })
  })

  it('drops a note played so far behind that the window has closed', () => {
    const matcher = matcherFor(LATE_C)
    expect(verdicts(press(matcher, 60, 1200))).toEqual(['missed', 'extra'])
    expect(matcher.summary()).toMatchObject({ correct: 0, extra: 1, missed: 1 })
  })

  it('treats the onTime band as inclusive', () => {
    expect(verdictOf(matcherFor(LATE_C), 60, 1050).timing).toBe('onTime')
    expect(verdictOf(matcherFor(LATE_C), 60, 1051).timing).toBe('late')
    expect(verdictOf(matcherFor(LATE_C), 60, 950).timing).toBe('onTime')
    expect(verdictOf(matcherFor(LATE_C), 60, 949).timing).toBe('early')
  })

  it('treats the tolerance window as inclusive', () => {
    expect(verdictOf(matcherFor(LATE_C), 60, 1150).verdict).toBe('correct')
    expect(verdicts(press(matcherFor(LATE_C), 60, 1151))).toEqual(['missed', 'extra'])
  })

  it('honours a toleranceMs of 0 — only an exact hit counts', () => {
    expect(verdictOf(matcherFor(LATE_C, { toleranceMs: 0 }), 60, 1000).verdict).toBe('correct')
    expect(verdicts(press(matcherFor(LATE_C, { toleranceMs: 0 }), 60, 1001))).toEqual([
      'missed',
      'extra',
    ])
  })

  it('scales expected times with the practice tempo', () => {
    // Half speed: the scale's second note moves from 500 ms to 1000 ms.
    const matcher = matcherFor(C_MAJOR_SCALE_RH, undefined, 0.5)
    expect(verdictOf(matcher, 60, 0).verdict).toBe('correct')
    expect(verdictOf(matcher, 62, 1000).deviationMs).toBe(0)
  })

  it('reports the mean absolute deviation across attributed presses', () => {
    const matcher = matcherFor(TWO_NOTES)
    press(matcher, 60, 100) // +100
    press(matcher, 62, 440) // -60
    expect(matcher.summary().meanAbsDeviationMs).toBeCloseTo(80, 10)
  })
})

// ============================================================ repeated pitches

describe('NoteMatcher — repeated identical pitches', () => {
  it('attributes repeated presses left to right, one per expected note', () => {
    const matcher = matcherFor(REPEATED_C)
    const ids = [10, 260, 490].map((t) => verdictOf(matcher, 60, t).expected?.id)
    expect(new Set(ids).size).toBe(3)
    expect(ids).toEqual(REPEATED_C.notes.map((n) => n.id))
    expect(matcher.summary()).toMatchObject({ correct: 3, missed: 0, extra: 0 })
  })

  it('never lets one press satisfy two expected notes of the same pitch', () => {
    const matcher = matcherFor(REPEATED_C)
    expect(verdictOf(matcher, 60, 0).verdict).toBe('correct')
    // The second and third C4 are simply never played.
    expect(verdicts(matcher.advanceTo(asMillis(2000)))).toEqual(['missed', 'missed'])
    expect(matcher.summary()).toMatchObject({ correct: 1, missed: 2, extra: 0 })
  })

  it('skips a dropped repeat rather than shifting every later press onto it', () => {
    const matcher = matcherFor(REPEATED_C)
    expect(verdicts(press(matcher, 60, 0))).toEqual(['correct'])
    // The middle C4 (250 ms) is dropped; the third is played on time.
    expect(verdicts(press(matcher, 60, 500))).toEqual(['missed', 'correct'])
    const played = matcher.results.filter((r) => r.verdict === 'correct')
    expect(played.map((r) => r.expected?.startTick)).toEqual([0, 2 * EIGHTH])
  })
})

// ======================================================================= ties

describe('NoteMatcher — tied notes', () => {
  // E4 half | C4 half ~ | ~ C4 half | G4 half, at 120 bpm: 0, 1000, (2000), 3000 ms.
  it('never expects a key press for a tied continuation', () => {
    const matcher = matcherFor(TIED_NOTES)
    const pending = matcher.pendingNotes()
    expect(pending).toHaveLength(3)
    expect(pending.every((n) => !n.tiedFrom)).toBe(true)
    expect(pending.map((n) => n.midi)).toEqual([64, 60, 67])
  })

  it('gives a clean run when the tied note is held rather than re-struck', () => {
    const matcher = matcherFor(TIED_NOTES)
    expect(verdictOf(matcher, 64, 0).verdict).toBe('correct')
    expect(verdictOf(matcher, 60, 1000).verdict).toBe('correct')
    expect(verdictOf(matcher, 67, 3000).verdict).toBe('correct')
    expect(matcher.advanceTo(asMillis(6000))).toHaveLength(0)
    expect(matcher.summary()).toEqual({
      correct: 3,
      wrongPitch: 0,
      missed: 0,
      extra: 0,
      accuracy: 1,
      meanAbsDeviationMs: 0,
    })
  })

  it('counts re-striking a tied note as an extra', () => {
    const matcher = matcherFor(TIED_NOTES)
    press(matcher, 64, 0)
    press(matcher, 60, 1000)
    expect(verdictOf(matcher, 60, 2000).verdict).toBe('extra')
    expect(verdictOf(matcher, 67, 3000).verdict).toBe('correct')
    expect(matcher.summary()).toMatchObject({ correct: 3, extra: 1, missed: 0 })
  })
})

// ================================================================ hand filter

describe('NoteMatcher — hand filtering', () => {
  const rightOnly: MatcherSettings = { hands: ['right'] }

  it('expects only the chosen hand', () => {
    const matcher = matcherFor(TWO_HAND_CHORDS, rightOnly)
    expect(matcher.pendingNotes()).toHaveLength(13)
    expect(matcher.pendingNotes().every((n) => n.hand === 'right')).toBe(true)
  })

  it('scores a right-hand-only run as perfect and never misses the muted hand', () => {
    const matcher = matcherFor(TWO_HAND_CHORDS, rightOnly)
    const tempo = tempoFor(TWO_HAND_CHORDS)
    for (const note of TWO_HAND_CHORDS.notes) {
      if (note.hand !== 'right') continue
      matcher.noteOn(note.midi, tickToMs(tempo, note.startTick))
    }
    matcher.advanceTo(asMillis(20_000))
    expect(matcher.summary()).toMatchObject({ correct: 13, missed: 0, extra: 0, wrongPitch: 0 })
  })

  it('produces no verdict at all for a muted-hand note', () => {
    const matcher = matcherFor(TWO_HAND_CHORDS, rightOnly)
    // C3 (48) is part of the left-hand triad on beat 1 of bar 1.
    expect(press(matcher, 48, 0)).toHaveLength(0)
    expect(matcher.results).toHaveLength(0)
    expect(matcher.summary()).toMatchObject({ correct: 0, extra: 0, wrongPitch: 0, missed: 0 })
    // …and the right-hand note it sits under is still pending.
    expect(verdictOf(matcher, 72, 0).verdict).toBe('correct')
  })

  it('still calls a key that is in neither hand an extra', () => {
    const matcher = matcherFor(TWO_HAND_CHORDS, rightOnly)
    matcher.advanceTo(asMillis(20_000))
    // 43 (G2) is a left-hand note in bar 3, but 8 s away from its window.
    expect(verdictOf(matcher, 43, 8000).verdict).toBe('extra')
    expect(verdictOf(matcher, 61, 8000).verdict).toBe('extra')
  })

  it('ignores everything when no hand is selected', () => {
    const matcher = matcherFor(TWO_HAND_CHORDS, { hands: [] })
    expect(matcher.pendingNotes()).toHaveLength(0)
    expect(press(matcher, 72, 0)).toHaveLength(0)
    expect(press(matcher, 48, 0)).toHaveLength(0)
    expect(verdictOf(matcher, 61, 0).verdict).toBe('extra')
  })

  it('evaluates both hands when the setting names both', () => {
    const matcher = matcherFor(TWO_HAND_CHORDS, { hands: ['left', 'right'] })
    expect(matcher.pendingNotes()).toHaveLength(25)
  })
})

// ================================================================ bookkeeping

describe('NoteMatcher — state, reset and held keys', () => {
  it('tracks which keys are down', () => {
    const matcher = matcherFor(TWO_NOTES)
    press(matcher, 60, 0)
    press(matcher, 64, 10)
    expect([...matcher.heldNotes].sort((a, b) => a - b)).toEqual([60, 64])
    matcher.noteOff(asMidi(60), asMillis(100))
    expect(matcher.heldNotes).toEqual([64])
    // A release for a key that was never pressed is simply ignored.
    matcher.noteOff(asMidi(59), asMillis(120))
    expect(matcher.heldNotes).toEqual([64])
  })

  it('restores the opening position on reset', () => {
    const matcher = matcherFor(C_MAJOR_SCALE_RH)
    press(matcher, 61, 0)
    matcher.advanceTo(asMillis(10_000))
    expect(matcher.results.length).toBeGreaterThan(0)

    matcher.reset()
    expect(matcher.results).toHaveLength(0)
    expect(matcher.heldNotes).toHaveLength(0)
    expect(matcher.pendingNotes()).toHaveLength(8)
    expect(matcher.summary()).toEqual({
      correct: 0,
      wrongPitch: 0,
      missed: 0,
      extra: 0,
      accuracy: 1,
      meanAbsDeviationMs: 0,
    })

    // …and a clean replay after the reset scores full marks.
    const tempo = tempoFor(C_MAJOR_SCALE_RH)
    replayExactly(C_MAJOR_SCALE_RH, tempo, matcher)
    expect(matcher.summary()).toMatchObject({ correct: 8, missed: 0, extra: 0 })
  })

  it('lists a key held down once, however often the press repeats', () => {
    const matcher = matcherFor(REPEATED_C)
    press(matcher, 60, 0)
    press(matcher, 60, 250)
    expect(matcher.heldNotes).toEqual([60])
  })

  it('records an out-of-order press at the clock, never in the past', () => {
    const matcher = matcherFor(TWO_NOTES)
    // D4 arrives first; the C4 that follows it carries an earlier timestamp.
    expect(verdicts(press(matcher, 62, 500))).toEqual(['missed', 'correct'])
    const stray = verdictOf(matcher, 60, 480)
    expect(stray.verdict).toBe('extra')
    expect(stray.atMs).toBe(500)
    expect(matcher.results.map((r) => r.atMs)).toEqual([150, 500, 500])
  })

  it('keeps the clock monotonic — advancing backwards decides nothing', () => {
    const matcher = matcherFor(C_MAJOR_SCALE_RH)
    expect(matcher.advanceTo(asMillis(0))).toHaveLength(0)
    expect(matcher.advanceTo(asMillis(1000))).toHaveLength(2)
    expect(matcher.advanceTo(asMillis(0))).toHaveLength(0)
    expect(matcher.advanceTo(asMillis(1000))).toHaveLength(0)
  })

  it('accumulates every verdict in decision order', () => {
    const matcher = matcherFor(TWO_NOTES)
    press(matcher, 64, 0)
    press(matcher, 62, 500)
    press(matcher, 61, 2000)
    expect(verdicts(matcher.results)).toEqual(['wrongPitch', 'correct', 'extra'])
  })

  it('exposes the documented defaults', () => {
    expect(MATCHER_DEFAULTS).toEqual({ toleranceMs: 150, onTimeMs: 50, chordWindowMs: 80 })
  })
})

// ============================================================= pending cursor

describe('NoteMatcher — the pending cursor', () => {
  it('points nextPending at the first note pendingNotes lists', () => {
    const matcher = matcherFor(C_MAJOR_SCALE_RH)
    expect(matcher.nextPending()).toBe(at(matcher.pendingNotes(), 0))
    expect(matcher.nextPending()?.midi).toBe(60)
    press(matcher, 60, 0)
    expect(matcher.nextPending()).toBe(at(matcher.pendingNotes(), 0))
    expect(matcher.nextPending()?.midi).toBe(62)
  })

  it('reports no next note once everything is decided', () => {
    const matcher = matcherFor(C_MAJOR_SCALE_RH)
    matcher.advanceTo(asMillis(10_000))
    expect(matcher.nextPending()).toBeUndefined()
    expect(matcher.pendingNotes()).toHaveLength(0)
  })

  it('honours a limit without changing what it lists', () => {
    const matcher = matcherFor(C_MAJOR_SCALE_RH)
    expect(matcher.pendingNotes(3)).toEqual(matcher.pendingNotes().slice(0, 3))
    expect(matcher.pendingNotes(0)).toHaveLength(0)
    expect(matcher.pendingNotes(99)).toHaveLength(8)
    expect(() => matcher.pendingNotes(-1)).toThrow(InvariantError)
  })
})

// ============================================================= malformed input

describe('NoteMatcher — malformed input', () => {
  const tempo = tempoFor(TWO_NOTES)

  it.each([
    ['toleranceMs', { toleranceMs: -1 }],
    ['onTimeMs', { onTimeMs: Number.NaN }],
    ['chordWindowMs', { chordWindowMs: Number.POSITIVE_INFINITY }],
  ])('rejects a nonsensical %s', (_name, settings) => {
    expect(() => new NoteMatcher(TWO_NOTES, tempo, settings)).toThrow(InvariantError)
  })

  it('rejects a non-finite event time', () => {
    const matcher = matcherFor(TWO_NOTES)
    expect(() => matcher.noteOn(asMidi(60), Number.NaN as unknown as Millis)).toThrow(
      InvariantError,
    )
    expect(() => matcher.noteOff(asMidi(60), Number.NaN as unknown as Millis)).toThrow(
      InvariantError,
    )
    expect(() => matcher.advanceTo(Number.POSITIVE_INFINITY as unknown as Millis)).toThrow(
      InvariantError,
    )
  })

  it('rejects a pitch outside the MIDI range', () => {
    const matcher = matcherFor(TWO_NOTES)
    expect(() => matcher.noteOn(128 as unknown as Midi, asMillis(0))).toThrow(InvariantError)
    expect(() => matcher.noteOff(-1 as unknown as Midi, asMillis(0))).toThrow(InvariantError)
    expect(() => matcher.noteOn(60.5 as unknown as Midi, asMillis(0))).toThrow(InvariantError)
  })
})

// ============================================================ property tests

/** A note on an eighth-note grid inside two 4/4 bars — always inside its measure. */
const SLOTS = 16

const noteArb = (min: number, max: number) =>
  fc.record({
    slot: fc.integer({ min: 0, max: SLOTS - 1 }),
    midi: fc.integer({ min, max }),
    hand: fc.constantFrom('left' as Hand, 'right' as Hand),
  })

type GenNote = { readonly slot: number; readonly midi: number; readonly hand: Hand }

const scoreFrom = (gen: readonly GenNote[]): Score =>
  buildTestScore(
    gen.map((g) => ({
      midi: g.midi,
      startTick: g.slot * EIGHTH,
      durationTicks: EIGHTH,
      hand: g.hand,
    })),
    { id: 'property-score' },
  )

const scoreArb = fc.array(noteArb(36, 84), { minLength: 1, maxLength: 20 }).map(scoreFrom)
const scaleArb = fc.constantFrom(0.5, 0.75, 1, 1.5, 2)

describe('NoteMatcher — properties', () => {
  it('a perfect replay of any score at any tempo scores 100%', () => {
    fc.assert(
      fc.property(scoreArb, scaleArb, (score, scale) => {
        const tempo = makeTempoMap(score.tempos, scale)
        const matcher = new NoteMatcher(score, tempo)
        replayExactly(score, tempo, matcher)
        expect(matcher.summary()).toEqual({
          correct: score.notes.length,
          wrongPitch: 0,
          missed: 0,
          extra: 0,
          accuracy: 1,
          meanAbsDeviationMs: 0,
        })
        expect(matcher.results.every((r) => r.timing === 'onTime' && r.deviationMs === 0)).toBe(
          true,
        )
        expect(matcher.pendingNotes()).toHaveLength(0)
      }),
    )
  })

  it('a replay an octave down is perfect when octave errors are ignored', () => {
    fc.assert(
      fc.property(scoreArb, (score) => {
        const tempo = makeTempoMap(score.tempos)
        const matcher = new NoteMatcher(score, tempo, { ignoreOctaveErrors: true })
        for (const note of score.notes) {
          matcher.noteOn(asMidi(note.midi - 12), tickToMs(tempo, note.startTick))
        }
        matcher.advanceTo(asMillis(60_000))
        expect(matcher.summary()).toMatchObject({
          correct: score.notes.length,
          wrongPitch: 0,
          missed: 0,
          extra: 0,
        })
      }),
    )
  })

  it('the muted hand can be played freely without affecting the score', () => {
    // Disjoint ranges per hand, so a left-hand key can never be a right-hand note.
    const disjointArb = fc
      .array(
        fc.record({
          slot: fc.integer({ min: 0, max: SLOTS - 1 }),
          hand: fc.constantFrom('left' as Hand, 'right' as Hand),
          step: fc.integer({ min: 0, max: 23 }),
        }),
        { minLength: 1, maxLength: 20 },
      )
      .map((gen) =>
        scoreFrom(
          gen.map((g) => ({
            slot: g.slot,
            hand: g.hand,
            midi: (g.hand === 'left' ? 36 : 60) + g.step,
          })),
        ),
      )
    fc.assert(
      fc.property(disjointArb, (score) => {
        const tempo = makeTempoMap(score.tempos)
        const matcher = new NoteMatcher(score, tempo, { hands: ['right'] })
        replayExactly(score, tempo, matcher)
        const rightHandNotes = score.notes.filter((n) => n.hand === 'right').length
        expect(matcher.summary()).toMatchObject({
          correct: rightHandNotes,
          wrongPitch: 0,
          missed: 0,
          extra: 0,
        })
      }),
    )
  })

  it('keeps the verdict stream well-formed for arbitrary playing', () => {
    const pressArb = fc.array(
      fc.record({ at: fc.integer({ min: 0, max: 5000 }), midi: fc.integer({ min: 21, max: 108 }) }),
      { maxLength: 30 },
    )
    fc.assert(
      fc.property(scoreArb, pressArb, (score, presses) => {
        const tempo = makeTempoMap(score.tempos)
        const matcher = new NoteMatcher(score, tempo)
        // Deliberately NOT sorted: MIDI events can arrive a hair out of order,
        // and the stream has to stay well-formed when they do.
        for (const p of presses) matcher.noteOn(asMidi(p.midi), asMillis(p.at))
        matcher.advanceTo(asMillis(60_000))
        const results = matcher.results

        // 1. verdicts arrive in non-decreasing time order
        for (let i = 1; i < results.length; i++) {
          expect(at(results, i).atMs).toBeGreaterThanOrEqual(at(results, i - 1).atMs)
        }

        // 2. every verdict carries exactly the fields its kind allows
        for (const r of results) {
          if (r.verdict === 'extra') {
            expect(r.expected).toBeUndefined()
            expect(r.timing).toBeUndefined()
            expect(r.deviationMs).toBeUndefined()
            expect(r.playedMidi).toBeDefined()
          } else if (r.verdict === 'missed') {
            expect(r.playedMidi).toBeUndefined()
            expect(r.timing).toBeUndefined()
            expect(r.deviationMs).toBeUndefined()
            expect(r.expected).toBeDefined()
          } else {
            expect(r.expected).toBeDefined()
            expect(r.playedMidi).toBeDefined()
            expect(r.timing).toBeDefined()
            expect(Math.abs(r.deviationMs ?? Infinity)).toBeLessThanOrEqual(
              MATCHER_DEFAULTS.toleranceMs,
            )
          }
        }

        // 3. every expected note is decided, and only a corrected fumble ever
        //    yields two verdicts for one note
        const byNote = new Map<string, NoteVerdict[]>()
        for (const r of results) {
          const id = r.expected?.id
          if (id === undefined) continue
          const seen = byNote.get(id) ?? []
          seen.push(r.verdict)
          byNote.set(id, seen)
        }
        expect(byNote.size).toBe(score.notes.length)
        for (const seen of byNote.values()) {
          if (seen.length > 1) expect(seen).toEqual(['wrongPitch', 'correct'])
        }
        expect(matcher.pendingNotes()).toHaveLength(0)
        expect(matcher.nextPending()).toBeUndefined()

        // 4. every press yields exactly one verdict when no hand is muted
        const s = matcher.summary()
        expect(s.correct + s.wrongPitch + s.extra).toBe(presses.length)
        expect(s.correct + s.wrongPitch + s.missed + s.extra).toBe(results.length)
        expect(s.correct).toBe(results.filter((r) => r.verdict === 'correct').length)
        expect(s.accuracy).toBeCloseTo(s.correct / Math.max(1, results.length), 10)
      }),
    )
  })
})

// ================================================================== cost model

/**
 * The claim in the module docstring is that nothing rescans the score, and the
 * only honest way to test that is to count the work — a wall-clock budget passes
 * just as happily with a quadratic scan on a 5,000-note score, and would put a
 * real clock into a suite that is not allowed one.
 */
describe('NoteMatcher — cost model', () => {
  // Sixteenth notes at 120 bpm: one event every 125 ms, so the 150 ms window
  // always holds a neighbour — the case an incremental window has to survive.
  const PITCHES = [60, 62, 64, 65, 67, 69, 71, 72]

  const replayRun = (count: number): NoteMatcher => {
    const notes: TestNote[] = Array.from({ length: count }, (_, i) => ({
      midi: at(PITCHES, i % PITCHES.length),
      startTick: i * 120,
      durationTicks: 120,
    }))
    const score = buildTestScore(notes, { id: `cost-model-${count}` })
    const tempo = makeTempoMap(score.tempos)
    const matcher = new NoteMatcher(score, tempo)
    for (const note of score.notes) matcher.noteOn(note.midi, tickToMs(tempo, note.startTick))
    return matcher
  }

  it('spends a bounded number of scan steps per event, however long the score', () => {
    const COUNT = 5000
    const matcher = replayRun(COUNT)
    expect(matcher.summary()).toMatchObject({ correct: COUNT, missed: 0, extra: 0, wrongPitch: 0 })
    // Three steps per press in this shape: the note, its neighbour, the break.
    // A scan restarting at the head of the score costs ~n/2 steps per press.
    expect(matcher.scanSteps).toBeLessThan(8 * COUNT)
  })

  it('doubles the work for twice the events rather than quadrupling it', () => {
    const half = replayRun(2500).scanSteps
    const full = replayRun(5000).scanSteps
    expect(half).toBeGreaterThan(0)
    // Linear: a scan that restarted at the head of the score gives ~4 here.
    expect(full / half).toBeGreaterThan(1.8)
    expect(full / half).toBeLessThan(2.2)
  })
})
