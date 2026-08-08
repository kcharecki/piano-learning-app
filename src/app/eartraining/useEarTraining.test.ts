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
import { makeInterval, type Interval } from '@core/theory/intervals.ts'
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
    // Level 1, rng script all-zero: pool[0] = P5 (7 semitones), root at range.low
    // (48) — ascending melodic, so 48 sounds before 55. An ear drill that plays
    // nothing is exactly the defect class this suite exists to catch.
    expect(audioOutput.playedNotes).toEqual([48, 55])
  })

  it('replay() plays the same item again, doubling what was sent', () => {
    const { result, audioOutput } = setup()
    act(() => result.current.start())
    expect(audioOutput.playedNotes).toEqual([48, 55])

    act(() => result.current.replay())

    expect(audioOutput.playedNotes).toEqual([48, 55, 48, 55])
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

    act(() => result.current.answer({ kind: 'interval-melodic', interval: interval(3, 'minor'), direction: 1 }))
    expect(result.current.grade?.correct).toBe(false)

    date.advance(2 * 60 * 60 * 1000)
    audioOutput.reset()
    act(() => result.current.start())

    expect(result.current.item?.id).toBe(firstId)
    expect(audioOutput.playedNotes).toEqual([48, 55])
  })
})

describe('useEarTraining — grading', () => {
  it('a correct interval answer grades correct', () => {
    const { result } = setup()
    act(() => result.current.start())
    expect(result.current.item?.answerKey).toBe('P5')

    act(() => result.current.answer({ kind: 'interval-melodic', interval: P5, direction: 1 }))

    expect(result.current.grade).toEqual({ correct: true, expected: 'P5', given: 'P5' })
    expect(result.current.phase).toBe('graded')
  })

  it('a wrong interval answer grades incorrect', () => {
    const { result } = setup()
    act(() => result.current.start())

    act(() => result.current.answer({ kind: 'interval-melodic', interval: m3, direction: 1 }))

    expect(result.current.grade?.correct).toBe(false)
    expect(result.current.grade?.expected).toBe('P5')
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
    act(() => result.current.answer({ kind: 'interval-melodic', interval: P5, direction: 1 }))

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
      act(() => result.current.answer({ kind: 'interval-melodic', interval: P5, direction: 1 }))
    }

    expect(result.current.levels['interval-melodic']).toBe(2)
  })

  it('a mixed run holds the level', () => {
    const { result } = setup()

    for (let i = 0; i < 4; i++) {
      act(() => result.current.start())
      act(() => result.current.answer({ kind: 'interval-melodic', interval: P5, direction: 1 }))
    }
    act(() => result.current.start())
    act(() => result.current.answer({ kind: 'interval-melodic', interval: M3, direction: 1 }))

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
  // `correct: false` every time against the old anchor. Level 2 / seed 3 is
  // known (found by exhaustive search over seeds 0-500) to produce exactly
  // such a prompt — its first onset is at tick 480, not 0.
  it('a rhythmic prompt whose first onset is not tick 0, played back perfectly, still grades correct', () => {
    const { result, clock } = setup({ rng: seededRng(3) })
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

describe('useEarTraining — count-in and prompt tempo (roadmap 3.23, REQ-3.6.1)', () => {
  // Level 1 melodic dictation is 4/4 at the default 120 bpm — a quarter note is 500ms — so a
  // one-bar count-in is exactly 4 clicks, 500ms apart, the last one landing 500ms before the
  // first note. Asserted against the RECORDED AudioOutput calls with exact timestamps, not a
  // rendered label: this repo has already shipped a silent "hear it" feature (PLAY_VELOCITY = 0)
  // that stayed green under 16 label-only tests, so a count-in that never actually reaches the
  // AudioOutput must fail here.
  it('start() for a melodic dictation item schedules a one-bar count-in of clicks before the prompt notes', () => {
    const { result, audioOutput, clock } = setup()
    act(() => result.current.setKind('melodic-dictation'))
    const baseMs = clock.now()

    act(() => result.current.start())

    const clicks = audioOutput.calls.filter((c) => c.kind === 'click')
    expect(clicks).toEqual([
      { kind: 'click', accented: true, at: baseMs - 2000 },
      { kind: 'click', accented: false, at: baseMs - 1500 },
      { kind: 'click', accented: false, at: baseMs - 1000 },
      { kind: 'click', accented: false, at: baseMs - 500 },
    ])
    const firstNoteOn = audioOutput.calls.find((c) => c.kind === 'noteOn')
    expect(firstNoteOn?.at).toBe(baseMs)
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
