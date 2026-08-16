/**
 * `useEarTraining` (roadmap 3.10, REQ-3.6.1/3.6.2): generates the next item
 * (SRS-due, else fresh), plays every one of its notes through the injected
 * `AudioOutput`, grades an answer with the matching drill's own grader,
 * records the attempt (re-adapting that kind's level), and lets `replay()`
 * hear the same item again. Grading and level-adaptation math themselves
 * already have their own suites (`core/eartraining/*`) — this only asserts
 * the wiring between them and the audio output.
 */
import { useEarTrainingStore } from '@app/state/earTrainingStore.ts'
import type { DictationGrade } from '@core/eartraining/dictation.ts'
import { emptyEarSession } from '@core/eartraining/session.ts'
import { makeTempoMap, tickToMs } from '@core/timing/tempo.ts'
import { midi as asMidi, ticks as asTicks, type Ticks } from '@core/shared/units.ts'
import { buildChord, chordMidi } from '@core/theory/chords.ts'
import { makeInterval, type Interval } from '@core/theory/intervals.ts'
import { keyFromFifths, keyName, type Key } from '@core/theory/keys.ts'
import { seededRng } from '@core/ports/rng.ts'
import { act, cleanup, renderHook } from '@testing-library/react'
import { FakeClock, FakeMidiInput, RecordingAudioOutput, scriptedRng } from '@test/fakes.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useEarTraining, type UseEarTrainingOptions } from './useEarTraining.ts'

function resetStore(): void {
  useEarTrainingStore.setState({ session: emptyEarSession(), itemsById: {} })
}

beforeEach(resetStore)
afterEach(() => {
  cleanup()
  resetStore()
})

/** Only for pairs already known to be legal, exactly like `intervals.ts`'s own `iv`. */
function interval(number: number, quality: Parameters<typeof makeInterval>[1]): Interval {
  const result = makeInterval(number, quality)
  if (!result.ok) throw new Error(result.error)
  return result.value
}

const P5 = interval(5, 'perfect')
const M3 = interval(3, 'major')
const m3 = interval(3, 'minor')

function setup(overrides: Partial<UseEarTrainingOptions> = {}) {
  // Started at a non-zero epoch on purpose (review finding): a clock that
  // starts at 0 cannot distinguish "elapsed since the first press" from
  // "absolute score time" — every ms-since-first-press assertion below would
  // still pass against a hook that (bug) anchored to an absolute reading
  // instead of a relative one, purely because 0 + anything looks the same
  // either way. Starting away from 0 forces the distinction to matter.
  const clock = new FakeClock(9000)
  const audioOutput = new RecordingAudioOutput(clock)
  const date = new FakeClock(1_700_000_000_000)
  const options: UseEarTrainingOptions = {
    date,
    audioOutput,
    rng: scriptedRng([0]),
    midiInput: new FakeMidiInput(),
    // Off by default in this file's own setup() (NOT the hook's real default,
    // which is on — see the dedicated "tonal context" describe block below):
    // every test above that block asserts prompt/count-in calls exactly, and
    // was written before roadmap 5.28 existed, so leaving the hook's real
    // default here would inject an extra drone into every one of them for no
    // reason relevant to what each is actually testing.
    tonalContext: false,
    ...overrides,
  }
  const { result, rerender } = renderHook((p: UseEarTrainingOptions) => useEarTraining(p), {
    initialProps: options,
  })
  return { result, rerender, audioOutput, clock, date, options }
}

describe('useEarTraining — generating and playing', () => {
  it('defaults to interval-melodic, and start() plays the prompt through the audio output', () => {
    const { result, audioOutput } = setup()

    expect(result.current.kind).toBe('interval-melodic')
    act(() => result.current.start())

    expect(result.current.item).toBeDefined()
    expect(result.current.item?.kind).toBe('interval-melodic')
    // Level 1 (roadmap 5.30: RCM staging, M3/m3 only), rng script all-zero:
    // pool[0] = M3 (4 semitones), root at range.low (48) — ascending melodic,
    // so 48 sounds before 52. An ear drill that plays nothing is exactly the
    // defect class this suite exists to catch.
    expect(audioOutput.playedNotes).toEqual([48, 52])
  })

  it('replay() plays the same item again, doubling what was sent', () => {
    const { result, audioOutput } = setup()
    act(() => result.current.start())
    expect(audioOutput.playedNotes).toEqual([48, 52])

    act(() => result.current.replay())

    expect(audioOutput.playedNotes).toEqual([48, 52, 48, 52])
  })

  it('a chord-quality item is also actually sent to the audio output', () => {
    const { result, audioOutput } = setup({ kind: 'chord-quality' })

    act(() => result.current.start())

    expect(result.current.item?.kind).toBe('chord-quality')
    expect(audioOutput.playedNotes.length).toBeGreaterThan(0)
  })

  // A mutant that drops the tick->ms mapping (schedules every note at the
  // same `baseMs`) passes on note numbers alone — it turns every melodic
  // interval into a harmonic one, the exact distinction these two drills
  // teach. Assert timing, not just pitch.
  it('a melodic interval schedules its second note a quarter note after the first, not simultaneously', () => {
    const { result, audioOutput } = setup()

    act(() => result.current.start())

    const noteOns = audioOutput.calls.filter((c) => c.kind === 'noteOn')
    expect(noteOns).toHaveLength(2)
    // QUARTER at the default 120 bpm = 500ms.
    expect(noteOns[1]!.at - noteOns[0]!.at).toBe(500)
  })

  it('a harmonic interval schedules both notes at the same time', () => {
    const { result, audioOutput } = setup({ kind: 'interval-harmonic' })

    act(() => result.current.start())

    const noteOns = audioOutput.calls.filter((c) => c.kind === 'noteOn')
    expect(noteOns).toHaveLength(2)
    expect(noteOns[1]!.at).toBe(noteOns[0]!.at)
  })

  // Exercises the SRS-due branch (`nextDueItemId` + `itemsById` cache) that no
  // other test reaches: `setup()`'s `date` never otherwise advances, so
  // `nextDueItemId` always returns null and every test takes the
  // fresh-generate path. A mutant that deletes the whole cached-item branch
  // (`const cached = undefined`) survives without this.
  it('once a card is due again, start() replays the exact same cached item, not a fresh one', () => {
    const { result, audioOutput, date } = setup()
    act(() => result.current.start())
    const firstId = result.current.item?.id
    expect(firstId).toBeDefined()

    act(() => result.current.answer({ kind: 'interval-melodic', interval: P5, direction: 1 }))
    expect(result.current.grade?.correct).toBe(false)

    date.advance(2 * 60 * 60 * 1000)
    audioOutput.reset()
    act(() => result.current.start())

    expect(result.current.item?.id).toBe(firstId)
    expect(audioOutput.playedNotes).toEqual([48, 52])
  })
})

describe('useEarTraining — grading', () => {
  it('a correct interval answer grades correct', () => {
    const { result } = setup()
    act(() => result.current.start())
    expect(result.current.item?.answerKey).toBe('M3')

    act(() => result.current.answer({ kind: 'interval-melodic', interval: M3, direction: 1 }))

    expect(result.current.grade).toEqual({ correct: true, expected: 'M3', given: 'M3' })
    expect(result.current.phase).toBe('graded')
  })

  it('a wrong interval answer grades incorrect', () => {
    const { result } = setup()
    act(() => result.current.start())

    act(() => result.current.answer({ kind: 'interval-melodic', interval: m3, direction: 1 }))

    expect(result.current.grade?.correct).toBe(false)
    expect(result.current.grade?.expected).toBe('M3')
  })

  it('a correct chord-quality answer grades correct', () => {
    const { result } = setup({ kind: 'chord-quality' })
    act(() => result.current.start())
    expect(result.current.item?.answerKey).toBe('major')

    act(() => result.current.answer({ kind: 'chord-quality', quality: 'major' }))

    expect(result.current.grade?.correct).toBe(true)
  })

  it('a wrong chord-quality answer grades incorrect', () => {
    const { result } = setup({ kind: 'chord-quality' })
    act(() => result.current.start())

    act(() => result.current.answer({ kind: 'chord-quality', quality: 'minor' }))

    expect(result.current.grade?.correct).toBe(false)
  })

  it('a correct scale-mode answer grades correct', () => {
    const { result } = setup({ kind: 'scale-mode' })
    act(() => result.current.start())
    expect(result.current.item?.answerKey).toBe('major')

    act(() => result.current.answer({ kind: 'scale-mode', type: 'major' }))

    expect(result.current.grade?.correct).toBe(true)
  })

  it('an answer of the wrong kind for the current item is a no-op', () => {
    const { result } = setup()
    act(() => result.current.start())

    act(() => result.current.answer({ kind: 'chord-quality', quality: 'major' }))

    expect(result.current.grade).toBeUndefined()
    expect(result.current.phase).toBe('answering')
  })
})

describe('useEarTraining — recorded accuracy (roadmap 3.26)', () => {
  it('a correct multiple-choice answer records EarAttempt.accuracy exactly 1, a wrong one exactly 0', () => {
    const { result } = setup()
    act(() => result.current.start())
    act(() => result.current.answer({ kind: 'interval-melodic', interval: M3, direction: 1 }))

    expect(useEarTrainingStore.getState().session.attempts[0]?.accuracy).toBe(1)

    act(() => result.current.start())
    act(() => result.current.answer({ kind: 'interval-melodic', interval: m3, direction: 1 }))

    expect(useEarTrainingStore.getState().session.attempts[1]?.accuracy).toBe(0)
  })
})

describe('useEarTraining — level adaptation (REQ-3.6.3)', () => {
  it('a unanimous run of 5 correct answers promotes the level by one', () => {
    const { result } = setup()
    expect(result.current.levels['interval-melodic']).toBe(1)

    for (let i = 0; i < 5; i++) {
      act(() => result.current.start())
      act(() => result.current.answer({ kind: 'interval-melodic', interval: M3, direction: 1 }))
    }

    expect(result.current.levels['interval-melodic']).toBe(2)
  })

  it('a mixed run holds the level', () => {
    const { result } = setup()

    for (let i = 0; i < 4; i++) {
      act(() => result.current.start())
      act(() => result.current.answer({ kind: 'interval-melodic', interval: M3, direction: 1 }))
    }
    act(() => result.current.start())
    act(() => result.current.answer({ kind: 'interval-melodic', interval: m3, direction: 1 }))

    expect(result.current.levels['interval-melodic']).toBe(1)
  })
})

describe('useEarTraining — switching kind', () => {
  it('resets to idle with no stale item, and the next start() draws the new kind', () => {
    const { result } = setup()
    act(() => result.current.start())
    expect(result.current.item).toBeDefined()

    act(() => result.current.setKind('chord-quality'))

    expect(result.current.kind).toBe('chord-quality')
    expect(result.current.item).toBeUndefined()
    expect(result.current.phase).toBe('idle')

    act(() => result.current.start())
    expect(result.current.item?.kind).toBe('chord-quality')
  })
})

describe('useEarTraining — dictation answers (roadmap 3.11, REQ-3.6.1/3.6.2)', () => {
  /**
   * Advance `clock` to the exact moment `note.startTick` sounds, then press
   * it. `base` is the clock reading `scheduleItem` used as its `audioOutput.now()`
   * anchor when `start()` played the prompt — callers capture it right after
   * `start()`, before the clock moves. Without adding `base` back in, this
   * would only reconstruct the right wall-clock moment when the clock happens
   * to start at 0, which is exactly what the review finding this fixes
   * flagged: `setup()`'s clock now starts away from 0 on purpose, so this
   * helper must do the addition for real rather than coincide with it.
   */
  function pressAtNoteTime(
    result: ReturnType<typeof setup>['result'],
    clock: FakeClock,
    base: number,
    tempoMap: ReturnType<typeof makeTempoMap>,
    note: { readonly midi: number; readonly startTick: Ticks },
  ): void {
    clock.setTime(base + Number(tickToMs(tempoMap, note.startTick)))
    act(() => result.current.pressDictationNote(asMidi(note.midi)))
  }

  // Both dictation kinds can already be generated and played before this task;
  // gradeDictation itself is fully tested (core/eartraining/dictation.test.ts).
  // What only the hook can prove is that pressing keys back through
  // pressDictationNote/submitDictation actually reaches that grader and
  // records the result — a stub submitDictation that never calls answer()
  // (or that always grades correct regardless of what was pressed) is what
  // both tests below kill.
  it('pressing back the exact prompt notes, in order, grades the dictation correct', () => {
    const { result, clock } = setup()
    act(() => result.current.setKind('melodic-dictation'))
    act(() => result.current.start())
    const item = result.current.item
    if (item === undefined) throw new Error('expected an item after start()')
    const base = clock.now()
    const tempoMap = makeTempoMap(item.prompt.tempos)

    for (const note of item.prompt.notes) pressAtNoteTime(result, clock, base, tempoMap, note)
    act(() => result.current.submitDictation())

    expect(result.current.grade?.correct).toBe(true)
    expect(result.current.phase).toBe('graded')
  })

  it('pressing one wrong pitch grades that note wrong-pitch and the whole answer incorrect', () => {
    const { result, clock } = setup()
    act(() => result.current.setKind('melodic-dictation'))
    act(() => result.current.start())
    const item = result.current.item
    if (item === undefined) throw new Error('expected an item after start()')
    expect(item.prompt.notes.length).toBeGreaterThan(0)
    const base = clock.now()
    const tempoMap = makeTempoMap(item.prompt.tempos)

    item.prompt.notes.forEach((note, i) => {
      const midi = i === 0 ? note.midi + 1 : note.midi
      pressAtNoteTime(result, clock, base, tempoMap, { midi, startTick: note.startTick })
    })
    act(() => result.current.submitDictation())

    const grade = result.current.grade as DictationGrade | undefined
    expect(grade?.correct).toBe(false)
    expect(grade?.notes[0]?.status).toBe('wrong-pitch')
  })

  // roadmap 3.26: the whole point is that a partially-right dictation answer
  // records a fractional EarAttempt.accuracy, not the collapsed 0 a boolean
  // `correct` used to force. A stub that still records `grade.correct ? 1 :
  // 0` passes every other test in this file (every other dictation answer
  // here is either note-perfect or has every note wrong) but fails this one,
  // since only the first of several notes is wrong here.
  it("records a fractional EarAttempt.accuracy equal to the grade's own pitchAccuracy for a melodic dictation with only its first pitch wrong — not 0", () => {
    const { result, clock } = setup()
    act(() => result.current.setKind('melodic-dictation'))
    act(() => result.current.start())
    const item = result.current.item
    if (item === undefined) throw new Error('expected an item after start()')
    expect(item.prompt.notes.length).toBeGreaterThan(1)
    const base = clock.now()
    const tempoMap = makeTempoMap(item.prompt.tempos)

    item.prompt.notes.forEach((note, i) => {
      const midi = i === 0 ? note.midi + 1 : note.midi
      pressAtNoteTime(result, clock, base, tempoMap, { midi, startTick: note.startTick })
    })
    act(() => result.current.submitDictation())

    const grade = result.current.grade as DictationGrade | undefined
    expect(grade?.pitchAccuracy).toBeGreaterThan(0)
    expect(grade?.pitchAccuracy).toBeLessThan(1)
    // A melodic item is the one kind where pitchAccuracy and rhythmAccuracy
    // can actually differ (every note here has a correct onset, only the
    // first pitch is wrong), so this is the one place a wrong-axis bug is
    // even detectable — see the review finding this pins.
    expect(grade?.rhythmAccuracy).not.toBe(grade?.pitchAccuracy)
    const recorded = useEarTrainingStore.getState().session.attempts[0]?.accuracy
    expect(recorded).toBe(grade?.pitchAccuracy)
  })

  it("records rhythmAccuracy (not pitchAccuracy) as a rhythmic-dictation attempt's EarAttempt.accuracy", () => {
    const { result, clock } = setup()
    act(() => result.current.setKind('rhythmic-dictation'))
    act(() => result.current.start())
    const item = result.current.item
    if (item === undefined) throw new Error('expected an item after start()')
    const base = clock.now()
    const tempoMap = makeTempoMap(item.prompt.tempos)

    for (const note of item.prompt.notes) pressAtNoteTime(result, clock, base, tempoMap, note)
    act(() => result.current.submitDictation())

    const grade = result.current.grade as DictationGrade | undefined
    const recorded = useEarTrainingStore.getState().session.attempts[0]?.accuracy
    expect(recorded).toBe(grade?.rhythmAccuracy)
  })

  // roadmap 3.26 review finding: pitchAccuracy's own denominator is the
  // prompt's note count, so a spurious extra press was not costing anything —
  // a note-perfect answer plus noise recorded accuracy 1, which is on the
  // PROMOTION side of the default band. accuracyForAttempt must scale by
  // expected/(expected+extra) so an extra press is never free.
  it('does not record a perfect accuracy when a note-perfect melodic dictation answer has an extra spurious press', () => {
    const { result, clock } = setup()
    act(() => result.current.setKind('melodic-dictation'))
    act(() => result.current.start())
    const item = result.current.item
    if (item === undefined) throw new Error('expected an item after start()')
    const base = clock.now()
    const tempoMap = makeTempoMap(item.prompt.tempos)

    for (const note of item.prompt.notes) pressAtNoteTime(result, clock, base, tempoMap, note)
    // One extra, spurious press well after the last expected note.
    const lastNote = item.prompt.notes[item.prompt.notes.length - 1]
    if (lastNote === undefined) throw new Error('expected at least one note')
    pressAtNoteTime(result, clock, base, tempoMap, {
      midi: lastNote.midi,
      startTick: asTicks(Number(lastNote.startTick) + 480),
    })
    act(() => result.current.submitDictation())

    const grade = result.current.grade as DictationGrade | undefined
    expect(grade?.pitchAccuracy).toBe(1)
    expect(grade?.notes.some((n) => n.status === 'extra')).toBe(true)
    const recorded = useEarTrainingStore.getState().session.attempts[0]?.accuracy
    expect(recorded).toBeLessThan(1)
  })

  // Reads the SRS session directly, not a spy on recordEarAttempt — a
  // submitDictation that grades correctly but forgets to call answer()
  // (so nothing ever reaches recordEarAttempt) would still pass a
  // grade-only assertion, but leaves the session exactly as empty as before.
  it('submitting a dictation answer moves the ear-training session state — a card and an attempt appear', () => {
    const { result, clock } = setup()
    act(() => result.current.setKind('melodic-dictation'))
    act(() => result.current.start())
    const item = result.current.item
    if (item === undefined) throw new Error('expected an item after start()')
    const base = clock.now()
    const tempoMap = makeTempoMap(item.prompt.tempos)
    expect(useEarTrainingStore.getState().session.attempts).toHaveLength(0)

    for (const note of item.prompt.notes) pressAtNoteTime(result, clock, base, tempoMap, note)
    act(() => result.current.submitDictation())

    const session = useEarTrainingStore.getState().session
    expect(session.attempts).toHaveLength(1)
    expect(session.attempts[0]?.kind).toBe('melodic-dictation')
    expect(session.cards.some((c) => c.id === item.id)).toBe(true)
  })

  // Rhythmic dictation's round trip was previously untested at this level —
  // only melodic was (the two tests above). That gap is exactly why the
  // tick-0 anchor bug shipped: every melodic prompt starts at tick 0, so no
  // test here could ever see a prompt starting elsewhere. This does not by
  // itself pin the bug (level 1 never allows rests, so this prompt still
  // starts at tick 0) — see the next test for that.
  it('pressing back a rhythmic prompt exactly, in order, grades the dictation correct', () => {
    const { result, clock } = setup()
    act(() => result.current.setKind('rhythmic-dictation'))
    act(() => result.current.start())
    const item = result.current.item
    if (item === undefined) throw new Error('expected an item after start()')
    const base = clock.now()
    const tempoMap = makeTempoMap(item.prompt.tempos)

    for (const note of item.prompt.notes) pressAtNoteTime(result, clock, base, tempoMap, note)
    act(() => result.current.submitDictation())

    expect(result.current.grade?.correct).toBe(true)
    expect(result.current.phase).toBe('graded')
  })

  // Regression test for the review finding: `pressDictationNote` used to
  // hard-anchor the first press to `ticks(0)`, but a rhythmic prompt's first
  // leaf can be a rest once rests are allowed (level >= 2) — measured over
  // 1500 generated items, 18.6% of rhythmic prompts started later than tick
  // 0. A note-perfect, rhythm-perfect playback of one of those graded
  // `correct: false` every time against the old anchor. Level 2 / seed 3 was
  // known (found by exhaustive search over seeds 0-500) to produce exactly
  // such a prompt — its first onset was at tick 480, not 0 — but roadmap
  // 5.58 raised level 2's own note-count window (3-4 notes -> 5-6), which
  // changes what seed 3 now draws; seed 1 was re-found (same search, new
  // bounds) to still produce a first onset that isn't tick 0.
  it('a rhythmic prompt whose first onset is not tick 0, played back perfectly, still grades correct', () => {
    const { result, clock } = setup({ rng: seededRng(1) })
    act(() =>
      useEarTrainingStore.setState((s) => ({
        session: { ...s.session, levels: { ...s.session.levels, 'rhythmic-dictation': 2 } },
      })),
    )
    act(() => result.current.setKind('rhythmic-dictation'))
    act(() => result.current.start())
    const item = result.current.item
    if (item === undefined) throw new Error('expected an item after start()')
    const firstOnset = item.prompt.notes[0]?.startTick
    expect(firstOnset).not.toBe(0) // confirms this seed still exercises the bug
    const base = clock.now()
    const tempoMap = makeTempoMap(item.prompt.tempos)

    for (const note of item.prompt.notes) pressAtNoteTime(result, clock, base, tempoMap, note)
    act(() => result.current.submitDictation())

    expect(result.current.grade?.correct).toBe(true)
  })

  // A stub that ignores elapsed time (always placing a press at tick 0, say)
  // would report both notes at the same startTick — this kills it.
  it('two presses separated by a known elapsed time land the expected number of ticks apart', () => {
    const { result, clock } = setup()
    act(() => result.current.setKind('melodic-dictation'))
    act(() => result.current.start())

    act(() => result.current.pressDictationNote(asMidi(60)))
    // 500ms at the default 120 bpm is exactly one quarter note — 480 ticks.
    clock.advance(500)
    act(() => result.current.pressDictationNote(asMidi(62)))

    expect(result.current.dictationNotes).toEqual([
      { midi: 60, startTick: 0 },
      { midi: 62, startTick: 480 },
    ])
  })

  it('clearDictation drops everything recorded so far', () => {
    const { result } = setup()
    act(() => result.current.setKind('melodic-dictation'))
    act(() => result.current.start())
    act(() => result.current.pressDictationNote(asMidi(60)))
    expect(result.current.dictationNotes).toHaveLength(1)

    act(() => result.current.clearDictation())

    expect(result.current.dictationNotes).toHaveLength(0)
  })

  it('pressDictationNote and submitDictation are no-ops for a non-dictation item', () => {
    const { result } = setup()
    act(() => result.current.start())

    act(() => result.current.pressDictationNote(asMidi(60)))
    expect(result.current.dictationNotes).toHaveLength(0)

    act(() => result.current.submitDictation())
    expect(result.current.grade).toBeUndefined()
    expect(result.current.phase).toBe('answering')
  })

  // A stub submitDictation that never checked for an empty answer would grade
  // every prompt note 'missing' and record a real (demoting) EarAttempt.
  it('submitDictation with nothing recorded is a no-op — no grade, no attempt recorded', () => {
    const { result } = setup()
    act(() => result.current.setKind('melodic-dictation'))
    act(() => result.current.start())

    act(() => result.current.submitDictation())

    expect(result.current.grade).toBeUndefined()
    expect(result.current.phase).toBe('answering')
    expect(useEarTrainingStore.getState().session.attempts).toHaveLength(0)
  })

  // Review finding: replay() used to leave a dictation in progress untouched,
  // so a press after a replay landed at its true elapsed offset from the
  // *original* first press — silently folding the whole replay's listening
  // time into that note's recorded startTick.
  it('replay mid-dictation drops the notes recorded so far', () => {
    const { result } = setup()
    act(() => result.current.setKind('melodic-dictation'))
    act(() => result.current.start())
    act(() => result.current.pressDictationNote(asMidi(60)))
    expect(result.current.dictationNotes).toHaveLength(1)

    act(() => result.current.replay())

    expect(result.current.dictationNotes).toHaveLength(0)
  })

  // Review finding: `AudioOutput.now()` can re-snap backwards (the webaudio
  // adapter re-snaps its epoch offset after a jump of more than 250ms, e.g. a
  // backgrounded tab), which without a clamp would write a negative startTick
  // into a domain object through `ticks()`'s unchecked cast.
  it('a backwards clock reading clamps the computed startTick to 0, never negative', () => {
    const { result, clock } = setup()
    act(() => result.current.setKind('melodic-dictation'))
    act(() => result.current.start())
    act(() => result.current.pressDictationNote(asMidi(60)))

    clock.advance(-5000) // simulates an AudioOutput epoch re-snap backwards

    act(() => result.current.pressDictationNote(asMidi(62)))

    expect(result.current.dictationNotes[1]).toEqual({ midi: 62, startTick: 0 })
  })

  // REQ-3.6.2: "using any key on the MIDI keyboard". Before this wiring
  // existed, a learner with a real MIDI keyboard had no way to answer a
  // dictation at all — the on-screen keyboard was the only input path.
  it('a real MIDI noteOn press records a dictation note exactly like an on-screen key press', () => {
    const midiInput = new FakeMidiInput()
    const { result, clock } = setup({ midiInput })
    act(() => result.current.setKind('melodic-dictation'))
    act(() => result.current.start())

    act(() =>
      midiInput.emit({ type: 'noteOn', note: asMidi(60), velocity: 80, time: clock.now() }),
    )

    expect(result.current.dictationNotes).toEqual([{ midi: 60, startTick: 0 }])
  })

  it('a MIDI press for a non-dictation item is a no-op, same as pressDictationNote itself', () => {
    const midiInput = new FakeMidiInput()
    const { result, clock } = setup({ midiInput })
    act(() => result.current.start()) // defaults to interval-melodic

    act(() =>
      midiInput.emit({ type: 'noteOn', note: asMidi(60), velocity: 80, time: clock.now() }),
    )

    expect(result.current.dictationNotes).toHaveLength(0)
  })
})

describe('useEarTraining — playIntervalReference (roadmap 5.29)', () => {
  it('plays the item\'s own interval from a fixed reference root (middle C), regardless of the drawn register', () => {
    const { result, audioOutput, clock } = setup()
    act(() => result.current.start())
    // Level 1, rng script all-zero: pool[0] = M3 (4 semitones), drawn at
    // register 48-52 (see the "generating and playing" describe block) —
    // this asserts the reference plays from 60, NOT from that drawn register.
    expect(result.current.item?.answerKey).toBe('M3')
    audioOutput.reset()
    const base = clock.now()

    act(() => result.current.playIntervalReference())

    const noteOns = audioOutput.calls.filter((c) => c.kind === 'noteOn')
    expect(noteOns.map((c) => c.note)).toEqual([60, 64])
    expect(noteOns[0]?.at).toBe(base)
    expect(noteOns[1]!.at).toBeGreaterThan(noteOns[0]!.at)
  })

  it('is always ascending, even for a descending item', () => {
    // Level 2, rng script [0, 0.9, 0]: draw 1 (pool pick) -> pool[0] = M3;
    // draw 2 (direction) -> randomInt(rng,0,1) = floor(0.9*2) = 1 -> descending;
    // draw 3 (lowMidi) -> range.low (48). See `pickDirection` in intervals.ts.
    const { result, audioOutput, clock } = setup({ rng: scriptedRng([0, 0.9, 0]) })
    act(() =>
      useEarTrainingStore.setState((s) => ({
        session: { ...s.session, levels: { ...s.session.levels, 'interval-melodic': 2 } },
      })),
    )
    act(() => result.current.start())
    expect(result.current.item?.answerKey).toBe('-M3') // sanity: this draw is descending
    audioOutput.reset()
    const base = clock.now()

    act(() => result.current.playIntervalReference())

    const noteOns = audioOutput.calls.filter((c) => c.kind === 'noteOn')
    // Ascending regardless of the item's own (descending) direction: the
    // lower reference pitch (60) plays first, the higher one second.
    expect(noteOns[0]?.note).toBe(60)
    expect(noteOns[1]?.note).toBe(64)
    expect(noteOns[0]?.at).toBe(base)
    expect(noteOns[1]!.at).toBeGreaterThan(noteOns[0]!.at)
  })

  it('does nothing for a chord-quality item', () => {
    const { result, audioOutput } = setup({ kind: 'chord-quality' })
    act(() => result.current.start())
    audioOutput.reset()

    act(() => result.current.playIntervalReference())

    expect(audioOutput.calls).toHaveLength(0)
  })

  it('does nothing with no item loaded yet', () => {
    const { result, audioOutput } = setup()

    act(() => result.current.playIntervalReference())

    expect(audioOutput.calls).toHaveLength(0)
  })
})

describe('useEarTraining — count-in and prompt tempo (roadmap 3.23, REQ-3.6.1)', () => {
  // Level 1 melodic dictation is 4/4 at the default 120 bpm — a quarter note is 500ms — so a
  // one-bar count-in is exactly 4 clicks, 500ms apart, the last one landing 500ms before the
  // first note. Asserted against the RECORDED AudioOutput calls with exact timestamps, not a
  // rendered label: this repo has already shipped a silent "hear it" feature (PLAY_VELOCITY = 0)
  // that stayed green under 16 label-only tests, so a count-in that never actually reaches the
  // AudioOutput must fail here.
  //
  // `baseMs` here is `clock.now()` AT SCHEDULE TIME, not the count-in's own first click — review
  // finding F1: `scheduleItem` anchors playback `earliestEventTick` earlier than a bare `now()`
  // reading so nothing lands in the past (see that function's own doc), so the count-in's first
  // (accented) click now lands exactly AT `baseMs`, not 2000ms before it.
  it('start() for a melodic dictation item schedules a one-bar count-in of clicks before the prompt notes', () => {
    const { result, audioOutput, clock } = setup()
    act(() => result.current.setKind('melodic-dictation'))
    const baseMs = clock.now()

    act(() => result.current.start())

    const clicks = audioOutput.calls.filter((c) => c.kind === 'click')
    expect(clicks).toEqual([
      { kind: 'click', accented: true, at: baseMs },
      { kind: 'click', accented: false, at: baseMs + 500 },
      { kind: 'click', accented: false, at: baseMs + 1000 },
      { kind: 'click', accented: false, at: baseMs + 1500 },
    ])
    const firstNoteOn = audioOutput.calls.find((c) => c.kind === 'noteOn')
    expect(firstNoteOn?.at).toBe(baseMs + 2000)
    // The count-in is audio, not silence: `click` itself carries no velocity, but the prompt
    // notes that follow it must still be audible and properly note-off'd — a count-in that
    // accidentally swallowed the prompt's own playback would still pass the calls-shape
    // assertion above without this.
    const noteOns = audioOutput.calls.filter((c) => c.kind === 'noteOn')
    const noteOffs = audioOutput.calls.filter((c) => c.kind === 'noteOff')
    expect(noteOns.length).toBeGreaterThan(0)
    expect(noteOns.every((c) => c.kind === 'noteOn' && c.velocity > 0)).toBe(true)
    expect(noteOffs).toHaveLength(noteOns.length)
  })

  it('start() for a rhythmic dictation item also schedules a count-in', () => {
    const { result, audioOutput } = setup()
    act(() => result.current.setKind('rhythmic-dictation'))

    act(() => result.current.start())

    expect(audioOutput.calls.filter((c) => c.kind === 'click')).toHaveLength(4)
  })

  it('replay() schedules a fresh count-in too, doubling the recorded clicks', () => {
    const { result, audioOutput } = setup()
    act(() => result.current.setKind('melodic-dictation'))
    act(() => result.current.start())
    expect(audioOutput.calls.filter((c) => c.kind === 'click')).toHaveLength(4)

    act(() => result.current.replay())

    expect(audioOutput.calls.filter((c) => c.kind === 'click')).toHaveLength(8)
  })

  // Deliberate scope limit, not an oversight — see the module doc's "A count-in and a displayed
  // tempo" section on why only dictation grading needs a pulse to be graded against.
  it('does not schedule a count-in for a non-dictation kind', () => {
    const { result, audioOutput } = setup() // defaults to interval-melodic

    act(() => result.current.start())

    expect(audioOutput.calls.some((c) => c.kind === 'click')).toBe(false)
  })

  it('promptTempoBpm is undefined before any item is loaded, and the written tempo (120) once one is', () => {
    const { result } = setup()
    expect(result.current.promptTempoBpm).toBeUndefined()

    act(() => result.current.start())

    expect(result.current.promptTempoBpm).toBe(120)
  })
})

/**
 * The three sounding pitches of `key`'s own tonic triad, root position, at
 * `key.tonic`'s OWN written octave (KEY_OCTAVE, not wherever the item's
 * prompt actually sits — see `triadBelow`/`transposeTriadBelow` below for
 * that). Review finding F5d: this IS a reimplementation, not a call into
 * `useEarTraining.ts`'s own `contextTriadMidi` — that function is
 * module-private (not exported), so this file cannot call it directly. It
 * calls the same underlying theory functions (`buildChord`/`chordMidi`)
 * `contextTriadMidi` does, which is what makes it a faithful duplicate
 * rather than an independent guess — the pinned C-major expectation right
 * below is what actually exercises those real theory functions end to end,
 * so a regression in either implementation's use of them would still be
 * caught there even though this helper itself could not catch one.
 */
function expectedTriadMidi(key: Key): readonly number[] {
  return chordMidi(buildChord(key.tonic, key.mode, 0))
}

it('expectedTriadMidi: C major\'s own tonic triad is C4-E4-G4 (60-64-67) — pins the helper against real theory functions, not just its own logic', () => {
  expect(expectedTriadMidi(keyFromFifths(0, 'major'))).toEqual([60, 64, 67])
})

/** Mirrors `useEarTraining.ts`'s own private `triadBelow` (module-private,
 *  so this file cannot call it directly — same reasoning as
 *  `expectedTriadMidi` above): octave-transposes `triad` (root position,
 *  ascending) so its root sits at the highest MIDI value <= `belowMidi`
 *  that is a whole number of octaves from where `triad` already is. */
function transposeTriadBelow(triad: readonly number[], belowMidi: number): readonly number[] {
  const root = triad[0]
  if (root === undefined) return triad
  const shift = Math.floor((belowMidi - root) / 12) * 12
  return triad.map((p) => p + shift)
}

describe('useEarTraining — tonal context (roadmap 5.28, triad since roadmap 5.55)', () => {
  // Asserted against the RECORDED AudioOutput calls with exact timestamps —
  // the same "assert the calls, not the projection" pattern the count-in
  // tests above use (roadmap 3.13/3.23).
  // `baseMs` is `clock.now()` at SCHEDULE time, not the triad's own onset —
  // review finding F1: `scheduleItem` anchors `earliestEventTick` earlier
  // than a bare `now()` reading, so the triad (the earliest event here) now
  // starts exactly AT `baseMs`, not 1000ms before it.
  it('schedules a real tonic TRIAD (three distinct pitch classes) ending exactly at tick 0, before a non-dictation item', () => {
    const { result, audioOutput, clock } = setup({ tonalContext: true })
    const baseMs = clock.now()

    act(() => result.current.start())

    const item = result.current.item
    expect(item).toBeDefined()
    const key = item?.contextKey
    expect(key).toBeDefined()
    if (key === undefined || item === undefined) return
    // roadmap 5.55 review (F5c): the triad actually played is octave-placed
    // just below the item's own lowest note, not fixed at KEY_OCTAVE.
    const lowestPromptMidi = Math.min(...item.prompt.notes.map((n) => n.midi))
    const triad = [...transposeTriadBelow(expectedTriadMidi(key), lowestPromptMidi)].sort(
      (a, b) => a - b,
    )
    // roadmap 5.55's whole point: a bare fifth (two notes) cannot establish
    // major or minor — a real triad is three notes, three distinct pitch
    // classes.
    expect(triad).toHaveLength(3)
    expect(new Set(triad.map((n) => n % 12)).size).toBe(3)

    const noteOns = audioOutput.calls.filter((c) => c.kind === 'noteOn')
    const noteOffs = audioOutput.calls.filter((c) => c.kind === 'noteOff')
    // Two beats at the default 120bpm = 1000ms — starts at baseMs, ends
    // where the prompt's own first note begins, 1000ms later.
    const contextOns = noteOns.filter((c) => c.at === baseMs)
    expect(contextOns.map((c) => c.note).sort((a, b) => a - b)).toEqual(triad)
    expect(contextOns.every((c) => c.velocity === 55)).toBe(true)
    const contextOffs = noteOffs.filter((c) => c.at === baseMs + 1000)
    expect(contextOffs.map((c) => c.note).sort((a, b) => a - b)).toEqual(triad)

    // The prompt's own first note starts exactly where the triad ends —
    // adjacent, never overlapping.
    const promptOnset = noteOns.find((c) => c.at === baseMs + 1000)
    expect(promptOnset).toBeDefined()
    // Nothing lands before the triad's own start — review finding F1's core
    // guarantee: every scheduled timestamp is >= `audioOutput.now()`.
    expect(noteOns.every((c) => c.at >= baseMs)).toBe(true)
  })

  it('for a dictation item, the triad ends exactly where the count-in begins, before it, not overlapping it', () => {
    const { result, audioOutput, clock } = setup({ tonalContext: true })
    act(() => result.current.setKind('melodic-dictation'))
    const baseMs = clock.now()

    act(() => result.current.start())

    const item = result.current.item
    expect(item).toBeDefined()
    const key = item?.contextKey
    expect(key).toBeDefined()
    if (key === undefined || item === undefined) return
    const lowestPromptMidi = Math.min(...item.prompt.notes.map((n) => n.midi))
    const triad = [...transposeTriadBelow(expectedTriadMidi(key), lowestPromptMidi)].sort(
      (a, b) => a - b,
    )

    // The triad (its own 2 beats = 1000ms) now starts exactly at `baseMs`
    // (the earliest event `scheduleItem` schedules) and ends 1000ms later,
    // exactly where the one-bar (4-beat = 2000ms) count-in begins.
    const noteOns = audioOutput.calls.filter((c) => c.kind === 'noteOn')
    const noteOffs = audioOutput.calls.filter((c) => c.kind === 'noteOff')
    const contextOns = noteOns.filter((c) => c.at === baseMs)
    expect(contextOns.map((c) => c.note).sort((a, b) => a - b)).toEqual(triad)
    const contextOffs = noteOffs.filter((c) => c.at === baseMs + 1000)
    expect(contextOffs.map((c) => c.note).sort((a, b) => a - b)).toEqual(triad)

    const firstClick = audioOutput.calls.find((c) => c.kind === 'click')
    expect(firstClick?.at).toBe(baseMs + 1000)
    // Nothing lands before the triad's own start — it never reaches back
    // further than its own 2 beats, and F1's guarantee holds even with both
    // a context triad AND a count-in stacked ahead of the prompt.
    expect(noteOns.some((c) => c.at < baseMs)).toBe(false)
  })

  // review finding F1's own general guarantee, checked directly rather than
  // only implied by the specific-offset assertions above: EVERY event
  // `scheduleItem` hands to the `AudioOutput` — triad, count-in, and prompt
  // notes alike — lands at or after `audioOutput.now()` AT SCHEDULE TIME,
  // for both a dictation item (triad + count-in + prompt all stacked ahead
  // of each other) and a non-dictation item (triad alone). Before the fix,
  // the adapter's own past-timestamp clamp (`webaudio.ts`'s `toCtxSeconds`)
  // was the only thing standing between a negative-offset bug here and
  // audible corruption — this test would not have caught the bug through
  // the fake, since `RecordingAudioOutput` (unlike the real adapter) records
  // whatever `at` it is given, clamped or not; it exists to pin the
  // invariant the real adapter's clamp was silently papering over.
  it('every scheduled event — triad, count-in, and prompt — lands at or after "now", for both a dictation and a non-dictation item (F1)', () => {
    const nonDictation = setup({ tonalContext: true })
    const nowNonDictation = nonDictation.clock.now()
    act(() => nonDictation.result.current.start())
    expect(nonDictation.audioOutput.calls.length).toBeGreaterThan(0)
    expect(nonDictation.audioOutput.calls.every((c) => c.at >= nowNonDictation)).toBe(true)

    const dictation = setup({ tonalContext: true, kind: 'melodic-dictation' })
    const nowDictation = dictation.clock.now()
    act(() => dictation.result.current.start())
    expect(dictation.audioOutput.calls.length).toBeGreaterThan(0)
    expect(dictation.audioOutput.calls.every((c) => c.at >= nowDictation)).toBe(true)
  })

  // roadmap 5.55's headline claim: a MINOR-key item sounds a MINOR triad —
  // level 5 melodic dictation is generated in a fixed minor key
  // (`levelDefaults.ts` row 5), so this is deterministic, not a lucky draw.
  it('a minor-key melodic-dictation item sounds a genuinely minor triad — root, MINOR third, fifth', () => {
    const { result, audioOutput } = setup({ tonalContext: true, kind: 'melodic-dictation' })
    // Seed the session directly so `start()` draws at level 5 without a long
    // adaptive climb — the level-1 default setup() ships wouldn't reach it.
    act(() => {
      useEarTrainingStore.getState().setSession({
        ...useEarTrainingStore.getState().session,
        levels: { ...useEarTrainingStore.getState().session.levels, 'melodic-dictation': 5 },
      })
    })

    act(() => result.current.start())

    const key = result.current.item?.contextKey
    expect(key).toBeDefined()
    if (key === undefined) return
    expect(key.mode).toBe('minor')
    expect(result.current.contextKeyName).toBe(keyName(key))

    const triad = expectedTriadMidi(key)
    expect(triad).toHaveLength(3)
    const [root, third, fifth] = [...triad].sort((a, b) => a - b)
    expect(third).toBeDefined()
    expect(root).toBeDefined()
    // A minor third above the root (3 semitones) — a MAJOR triad would be 4.
    expect((third ?? 0) - (root ?? 0)).toBe(3)
    expect((fifth ?? 0) - (root ?? 0)).toBe(7)

    const item = result.current.item
    expect(item).toBeDefined()
    if (item === undefined) return
    // roadmap 5.55 review (F5c): the triad actually played is octave-placed
    // just below the item's own lowest note, not fixed at KEY_OCTAVE.
    const lowestPromptMidi = Math.min(...item.prompt.notes.map((n) => n.midi))
    const soundedTriad = transposeTriadBelow(triad, lowestPromptMidi)
    const noteOns = audioOutput.calls.filter((c) => c.kind === 'noteOn')
    const contextNoteOns = noteOns.filter((c) => soundedTriad.includes(c.note))
    expect(contextNoteOns).toHaveLength(3)
  })

  it('tonalContext: false schedules no triad at all', () => {
    const { result, audioOutput } = setup({ tonalContext: false })

    act(() => result.current.start())

    // Level 1 melodic interval item is exactly 2 notes (see the "generating
    // and playing" describe block above) — no triad means no more than that.
    expect(audioOutput.calls.filter((c) => c.kind === 'noteOn')).toHaveLength(2)
  })

  it('replay() schedules a fresh triad too, respecting tonalContext exactly like start() does', () => {
    const { result, audioOutput } = setup({ tonalContext: true })
    act(() => result.current.start())
    const afterStart = audioOutput.calls.filter((c) => c.kind === 'noteOn').length

    act(() => result.current.replay())

    expect(audioOutput.calls.filter((c) => c.kind === 'noteOn')).toHaveLength(afterStart * 2)
  })

  // `rhythmic-dictation` never carries a `contextKey` (rhythm has no scale —
  // core/eartraining/dictation.ts's own doc) — a triad there would be noise,
  // not context, so none is scheduled even with the option on. The count-in
  // is unrelated to tonal context and must still play.
  it('a rhythmic-dictation item gets no triad (no key to establish) but keeps its count-in', () => {
    const { result, audioOutput } = setup({ tonalContext: true })
    act(() => result.current.setKind('rhythmic-dictation'))

    act(() => result.current.start())

    expect(result.current.item?.contextKey).toBeUndefined()
    expect(result.current.contextKeyName).toBeUndefined()
    expect(audioOutput.calls.filter((c) => c.kind === 'click')).toHaveLength(4)
    expect(audioOutput.calls.filter((c) => c.kind === 'noteOn')).toHaveLength(
      result.current.item?.prompt.notes.length ?? -1,
    )
  })

  // roadmap 5.55: context-free practice must be genuinely context-free — the
  // key name disappears from the screen data, not just the sound.
  it('contextKeyName is undefined when tonalContext is off, even though the item still carries a contextKey', () => {
    const { result } = setup({ tonalContext: false })

    act(() => result.current.start())

    expect(result.current.item?.contextKey).toBeDefined()
    expect(result.current.contextKeyName).toBeUndefined()
  })

  // Review finding F5b: `contextKeyName` used to read `options.tonalContext`
  // LIVE, so toggling it after `start()` had already scheduled audio one way
  // changed the on-screen label for audio that was never actually
  // rescheduled. It must instead reflect whatever the LAST `scheduleItem`
  // call (`start()`/`replay()`) actually used — checked in both directions.
  it('contextKeyName does not change on an ON -> OFF toggle until the NEXT start()/replay() actually reschedules audio (F5b)', () => {
    const { result, rerender, options } = setup({ tonalContext: true })
    act(() => result.current.start())
    expect(result.current.contextKeyName).toBeDefined()

    // Toggling the option alone must not move the label — nothing has been
    // rescheduled yet.
    rerender({ ...options, tonalContext: false })
    expect(result.current.contextKeyName).toBeDefined()

    // Only once replay() actually schedules audio the new way does the label follow.
    act(() => result.current.replay())
    expect(result.current.contextKeyName).toBeUndefined()
  })

  it('contextKeyName does not change on an OFF -> ON toggle until the NEXT start()/replay() actually reschedules audio (F5b)', () => {
    const { result, rerender, options } = setup({ tonalContext: false })
    act(() => result.current.start())
    expect(result.current.item?.contextKey).toBeDefined()
    expect(result.current.contextKeyName).toBeUndefined()

    rerender({ ...options, tonalContext: true })
    expect(result.current.contextKeyName).toBeUndefined()

    act(() => result.current.replay())
    expect(result.current.contextKeyName).toBeDefined()
  })

  // The literal proof text (roadmap 5.28): "the drill still grades the same
  // answers" — the drone changes what is HEARD before an item, never what the
  // item itself is or how an answer against it is scored.
  it('grading is identical whether tonal context is on or off, for the same answer', () => {
    const on = setup({ tonalContext: true })
    act(() => on.result.current.start())
    act(() => on.result.current.answer({ kind: 'interval-melodic', interval: P5 }))

    const off = setup({ tonalContext: false })
    act(() => off.result.current.start())
    act(() => off.result.current.answer({ kind: 'interval-melodic', interval: P5 }))

    expect(on.result.current.grade).toEqual(off.result.current.grade)
    expect(on.result.current.item?.answerKey).toBe(off.result.current.item?.answerKey)
  })
})
