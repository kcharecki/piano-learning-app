/**
 * useTechniqueDrill (roadmap 4.4a, REQ-3.7.1/3.7.2/3.7.3): a perfectly even
 * run — single-hand or hands-together/chord — scores evenness 1 and is
 * stored clean; a bursty one scores well below the clean threshold. The
 * REQ-3.7.1 fingering assertion lives in `TechniqueScreen.test.tsx`, where it
 * can actually fail if the screen stops surfacing fingerings — see that
 * file's own comment on why the equivalent assertion here was dead weight.
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { FakeClock, FakeMidiInput, RecordingAudioOutput } from '@test/fakes.ts'
import { millis } from '@core/shared/units.ts'
import { techniqueDrillById, techniqueLibrary, type TechniqueDrill } from '@core/technique/library.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { useTechniqueStore } from '@app/state/techniqueStore.ts'
import { useTechniqueDrill } from './useTechniqueDrill.ts'

// Unmount BEFORE resetting the store, in that order, inside one callback:
// `useTechniqueDrill` subscribes to `useTechniqueStore` reactively, so
// resetting it while a previous test's hook instance is still mounted (which
// an `afterEach(resetStore)` registered separately from `setup.ui.ts`'s own
// cleanup cannot guarantee the ordering of) fires a real state update outside
// any `act()` — the same fix `SightReadingScreen.test.tsx` uses for the same
// reason.
afterEach(() => {
  cleanup()
  useTechniqueStore.setState({ attempts: [] })
})

function firstDrillOf(level: number): TechniqueDrill {
  const drill = techniqueLibrary(level)[0]
  if (drill === undefined) throw new Error(`expected at least one drill at level ${level}`)
  return drill
}

/** Never fires on its own — nothing in these tests depends on a live frame pump. */
function manualDriver(): FrameDriver {
  return () => () => {}
}

/**
 * Every run in this suite advances the clock past 0 before `start()` and
 * emits notes at `runStartMs + i * msPerBeat` (never at raw `i * msPerBeat`)
 * — production onset timestamps are `performance.now()` values of order 1e5+
 * ms (`src/adapters/midi/webmidi.ts`), never 0-based. A prior version of this
 * suite started the clock at 0 and never advanced it, so the plausible
 * mutant "drop the anchor subtraction in `event.time - run.anchorMs`"
 * survived every test here; advancing first makes that mutant fail the
 * accuracy assertion, since un-anchored deltas would then land outside every
 * matcher window.
 */
const RUN_START_MS = 5_000
const COUNT_IN_BEATS = 4

function runStart(clock: FakeClock): void {
  clock.advance(RUN_START_MS)
}

describe('useTechniqueDrill', () => {
  it('scores a perfectly even run as evenness 1 and stores it clean (REQ-3.7.2)', () => {
    const drill = firstDrillOf(1)
    const clock = new FakeClock()
    const midiInput = new FakeMidiInput()
    const audioOutput = new RecordingAudioOutput(clock)

    const { result } = renderHook(() =>
      useTechniqueDrill({
        level: 1,
        initialDrillId: drill.id,
        clock,
        date: clock,
        midiInput,
        audioOutput,
        frameDriver: manualDriver(),
      }),
    )

    runStart(clock)
    act(() => result.current.start())
    const score = result.current.score
    if (score === undefined) throw new Error('expected a score once started')

    const msPerBeat = 60000 / result.current.bpm
    // Land on the downbeat after the hook's own one-bar count-in — the
    // clicked-out bar the learner needs before the first note is due.
    const countInMs = COUNT_IN_BEATS * msPerBeat
    for (const [i, note] of score.notes.entries()) {
      act(() =>
        midiInput.emit({
          type: 'noteOn',
          note: note.midi,
          velocity: 80,
          time: millis(RUN_START_MS + countInMs + i * msPerBeat),
        }),
      )
    }

    act(() => result.current.stop())

    expect(result.current.lastAttempt?.evenness).toBe(1)
    expect(result.current.lastAttempt?.accuracy).toBe(1)
    expect(result.current.lastAttempt?.clean).toBe(true)
    expect(result.current.history).toHaveLength(1)
    expect(result.current.history[0]?.bpm).toBe(drill.targetBpm)
    expect(result.current.bestBpm).toBe(drill.targetBpm)
    expect(useTechniqueStore.getState().attempts).toHaveLength(1)
  })

  it.each([
    'five-finger-c-major-hands-right',
    'scale-c-major-2oct-hands-together',
    'chord-inversions-c-major-hands-right',
  ])(
    'scores a perfectly even run of %s (hands-together/chord drills) as evenness 1 (REQ-3.7.2)',
    (drillId) => {
      const drill = techniqueDrillById(drillId)
      if (drill === undefined) throw new Error(`expected a drill with id ${drillId} in the library`)
      const clock = new FakeClock()
      const midiInput = new FakeMidiInput()
      const audioOutput = new RecordingAudioOutput(clock)

      const { result } = renderHook(() =>
        useTechniqueDrill({
          level: drill.level,
          initialDrillId: drill.id,
          clock,
          date: clock,
          midiInput,
          audioOutput,
          frameDriver: manualDriver(),
        }),
      )

      runStart(clock)
      act(() => result.current.start())
      const score = result.current.score
      if (score === undefined) throw new Error('expected a score once started')

      const msPerBeat = 60000 / result.current.bpm
      const countInMs = COUNT_IN_BEATS * msPerBeat
      for (const note of score.notes) {
        act(() =>
          midiInput.emit({
            type: 'noteOn',
            note: note.midi,
            velocity: 80,
            time: millis(RUN_START_MS + countInMs + note.startTick * (msPerBeat / 480)),
          }),
        )
      }

      act(() => result.current.stop())

      expect(result.current.lastAttempt?.evenness).toBeCloseTo(1, 9)
      expect(result.current.lastAttempt?.clean).toBe(true)
    },
  )

  it('scores a bursty, uneven run well below the clean threshold (REQ-3.7.2)', () => {
    const drill = firstDrillOf(1)
    const clock = new FakeClock()
    const midiInput = new FakeMidiInput()
    const audioOutput = new RecordingAudioOutput(clock)

    const { result } = renderHook(() =>
      useTechniqueDrill({
        level: 1,
        initialDrillId: drill.id,
        clock,
        date: clock,
        midiInput,
        audioOutput,
        frameDriver: manualDriver(),
      }),
    )

    runStart(clock)
    act(() => result.current.start())
    const score = result.current.score
    if (score === undefined) throw new Error('expected a score once started')

    // Bursty: pairs of closely-spaced (but not chord-window-simultaneous —
    // MATCHER_DEFAULTS.chordWindowMs is 80ms) presses separated by long gaps —
    // wildly uneven onset spacing, on purpose, regardless of pitch.
    score.notes.forEach((note, i) => {
      const pairIndex = Math.floor(i / 2)
      const withinPair = i % 2
      const t = pairIndex * 3000 + withinPair * 200
      act(() =>
        midiInput.emit({ type: 'noteOn', note: note.midi, velocity: 80, time: millis(RUN_START_MS + t) }),
      )
    })

    act(() => result.current.stop())

    expect(result.current.lastAttempt?.evenness).toBeLessThan(0.8)
    expect(result.current.lastAttempt?.clean).toBe(false)
    expect(result.current.history).toHaveLength(0)
  })

  it('records no attempt when a run is started and stopped with no input', () => {
    const drill = firstDrillOf(1)
    const clock = new FakeClock()
    const midiInput = new FakeMidiInput()
    const audioOutput = new RecordingAudioOutput(clock)

    const { result } = renderHook(() =>
      useTechniqueDrill({
        level: 1,
        initialDrillId: drill.id,
        clock,
        date: clock,
        midiInput,
        audioOutput,
        frameDriver: manualDriver(),
      }),
    )

    runStart(clock)
    act(() => result.current.start())
    act(() => result.current.stop())

    expect(result.current.lastAttempt).toBeUndefined()
    expect(useTechniqueStore.getState().attempts).toHaveLength(0)
  })

  it('falls back to the first drill of a level when none is selected yet', () => {
    const neverResolves = (): Promise<never> => new Promise(() => {})
    const { result } = renderHook(() => useTechniqueDrill({ level: 2, connectMidi: neverResolves }))
    expect(result.current.drill?.level).toBe(2)
    expect(result.current.drill?.id).toBe(techniqueLibrary(2)[0]?.id)
  })
})
