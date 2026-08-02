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
import { emptyEarSession } from '@core/eartraining/session.ts'
import { makeInterval, type Interval } from '@core/theory/intervals.ts'
import { act, cleanup, renderHook } from '@testing-library/react'
import { FakeClock, RecordingAudioOutput, scriptedRng } from '@test/fakes.ts'
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
  const clock = new FakeClock(0)
  const audioOutput = new RecordingAudioOutput(clock)
  const date = new FakeClock(1_700_000_000_000)
  const options: UseEarTrainingOptions = {
    date,
    audioOutput,
    rng: scriptedRng([0]),
    ...overrides,
  }
  const { result, rerender } = renderHook((p: UseEarTrainingOptions) => useEarTraining(p), {
    initialProps: options,
  })
  return { result, rerender, audioOutput, date, options }
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
