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
import type { Score } from '@core/notation/score.ts'

/** The branded MIDI type a score note carries, without a second import path for it. */
type ScoreMidi = Score['notes'][number]['midi']
import { techniqueDrillById, techniqueLibrary, type TechniqueDrill } from '@core/technique/library.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { useTechniqueStore } from '@app/state/techniqueStore.ts'
import {
  POSTURE_PROMPT_ATTEMPT_COUNT,
  POSTURE_PROMPT_RUNNING_MS,
} from './posturePromptSchedule.ts'
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
 * emits notes at `runStartMs + <the note's own startTick>` (never at raw
 * 0-based times, and never one-note-per-beat by array index — roadmap T.13
 * gave the five-finger drills a closing BLOCKED triad, three notes sharing
 * one startTick, and an index-driven run would arpeggiate it across three
 * beats and score a flawless run at 71%)
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

/**
 * The score's onsets, grouped by tick: `[{ tick, midis }]` in time order. A
 * drill is no longer one-note-per-beat — roadmap T.13's five-finger drills end
 * on a blocked triad, three notes sharing one startTick — so anything driving
 * a run by hand has to strike a group together or score a flawless run at 71%.
 */
function noteGroups(
  score: Score,
): readonly { readonly tick: number; readonly midis: readonly ScoreMidi[] }[] {
  const byTick = new Map<number, ScoreMidi[]>()
  for (const note of score.notes) {
    const list = byTick.get(note.startTick)
    if (list === undefined) byTick.set(note.startTick, [note.midi])
    else list.push(note.midi)
  }
  return [...byTick.entries()]
    .sort(([a], [b]) => a - b)
    .map(([tick, midis]) => ({ tick, midis }))
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

  it('names the wrong note when the run is played with a flat third (roadmap T.12)', () => {
    // The case T.12 was filed for, one note wide: everything on time, every
    // E played as E-flat. The accuracy figure alone would say "88%" and stop;
    // the diagnosis has to say WHICH note, spelled the way the learner played
    // it (E-flat, not the enharmonic D-sharp) and placed on its degree.
    const drill = techniqueDrillById('five-finger-c-major-hands-right')
    if (drill === undefined) throw new Error('expected the C major five-finger drill')
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
    const isThird = (m: number): boolean => m % 12 === 4
    expect(score.notes.some((n) => isThird(n.midi))).toBe(true)
    for (const note of score.notes) {
      act(() =>
        midiInput.emit({
          type: 'noteOn',
          note: (isThird(note.midi) ? note.midi - 1 : note.midi) as ScoreMidi,
          velocity: 80,
          time: millis(RUN_START_MS + countInMs + note.startTick * (msPerBeat / 480)),
        }),
      )
    }

    act(() => result.current.stop())

    const mistakes = result.current.lastDiagnosis?.mistakes ?? []
    expect(mistakes).toHaveLength(1)
    expect(mistakes[0]?.expectedName).toBe('E4')
    expect(mistakes[0]?.playedName).toBe('E♭4')
    expect(mistakes[0]?.degree).toBe(3)
    // Non-degeneracy: the run really was scored as wrong, not silently clean.
    expect(result.current.lastAttempt?.accuracy).toBeLessThan(1)
  })

  it('says nothing about wrong notes after a correct run', () => {
    const drill = techniqueDrillById('five-finger-c-major-hands-right')
    if (drill === undefined) throw new Error('expected the C major five-finger drill')
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

    expect(result.current.lastDiagnosis).toEqual({ mistakes: [], missed: 0, extra: 0 })
    // And the next run clears it, so a stale correction cannot outlive the
    // attempt it was about.
    act(() => result.current.start())
    expect(result.current.lastDiagnosis).toBeUndefined()
  })

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

  it('scores a run driven entirely through press()/release() — no MIDI device at all (roadmap 5.5a)', () => {
    const drill = firstDrillOf(1)
    const clock = new FakeClock()
    const audioOutput = new RecordingAudioOutput(clock)
    const neverResolves = (): Promise<never> => new Promise(() => {})

    const { result } = renderHook(() =>
      useTechniqueDrill({
        level: 1,
        initialDrillId: drill.id,
        clock,
        date: clock,
        connectMidi: neverResolves,
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
    clock.advance(countInMs)
    // Grouped by startTick, so roadmap T.13's closing blocked triad is struck
    // as one chord rather than arpeggiated over three beats, and the clock
    // advances by each group's real gap rather than a flat beat.
    for (const [i, group] of noteGroups(score).entries()) {
      for (const midi of group.midis) act(() => result.current.press(midi))
      for (const midi of group.midis) act(() => result.current.release(midi))
      const next = noteGroups(score)[i + 1]
      const gapTicks = next === undefined ? 480 : next.tick - group.tick
      clock.advance(gapTicks * (msPerBeat / 480))
    }

    act(() => result.current.stop())

    expect(result.current.lastAttempt?.evenness).toBe(1)
    expect(result.current.lastAttempt?.accuracy).toBe(1)
    expect(result.current.lastAttempt?.clean).toBe(true)
  })

  it('falls back to the first drill of a level when none is selected yet', () => {
    const neverResolves = (): Promise<never> => new Promise(() => {})
    const { result } = renderHook(() => useTechniqueDrill({ level: 2, connectMidi: neverResolves }))
    expect(result.current.drill?.level).toBe(2)
    expect(result.current.drill?.id).toBe(techniqueLibrary(2)[0]?.id)
  })

  describe('posturePromptDue (REQ-5.23)', () => {
    it('is not due at the start of a session', () => {
      const drill = firstDrillOf(1)
      const { result } = renderHook(() =>
        useTechniqueDrill({ level: 1, initialDrillId: drill.id, connectMidi: (): Promise<never> => new Promise(() => {}) }),
      )
      expect(result.current.posturePromptDue).toBe(false)
    })

    // Proves the schedule is driven by the injected Clock, not real time:
    // this test's wall-clock execution is milliseconds, yet it crosses the
    // ten-minute running-time threshold purely by advancing the FakeClock —
    // if the hook were reading `Date.now()` or a real timer instead, this
    // would never fire without the test itself blocking for ten minutes.
    it('becomes due once cumulative RUNNING time reaches the threshold, even with no notes played', () => {
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

      // First run: leaves the schedule just short of the threshold.
      act(() => result.current.start())
      clock.advance(POSTURE_PROMPT_RUNNING_MS - 1)
      act(() => result.current.stop())
      expect(result.current.posturePromptDue).toBe(false)

      // Second run: a couple more ms of running time tips it over.
      act(() => result.current.start())
      clock.advance(2)
      act(() => result.current.stop())
      expect(result.current.posturePromptDue).toBe(true)
    })

    it('becomes due after enough completed ATTEMPTS, well under the running-time threshold', () => {
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
      for (let run = 0; run < POSTURE_PROMPT_ATTEMPT_COUNT; run++) {
        act(() => result.current.start())
        const score = result.current.score
        if (score === undefined) throw new Error('expected a score once started')
        const msPerBeat = 60000 / result.current.bpm
        const countInMs = COUNT_IN_BEATS * msPerBeat
        const base = clock.now()
        for (const note of score.notes) {
          act(() =>
            midiInput.emit({
              type: 'noteOn',
              note: note.midi,
              velocity: 80,
              time: millis(base + countInMs + note.startTick * (msPerBeat / 480)),
            }),
          )
        }
        // A few ms of "real" elapsed time per run — nowhere near the
        // running-time threshold even after POSTURE_PROMPT_ATTEMPT_COUNT
        // repeats, isolating the attempt-count trigger from the time one.
        clock.advance(50)
        act(() => result.current.stop())

        if (run < POSTURE_PROMPT_ATTEMPT_COUNT - 1) {
          expect(result.current.posturePromptDue).toBe(false)
        }
      }

      expect(result.current.lastAttempt?.clean).toBe(true)
      expect(result.current.posturePromptDue).toBe(true)
    })

    it('acknowledging the prompt clears it, and the schedule restarts from zero', () => {
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

      act(() => result.current.start())
      clock.advance(POSTURE_PROMPT_RUNNING_MS)
      act(() => result.current.stop())
      expect(result.current.posturePromptDue).toBe(true)

      act(() => result.current.acknowledgePosturePrompt())
      expect(result.current.posturePromptDue).toBe(false)

      // A short run afterward should not immediately re-trigger it — the
      // counters really reset to zero, not to "one below threshold".
      act(() => result.current.start())
      clock.advance(1_000)
      act(() => result.current.stop())
      expect(result.current.posturePromptDue).toBe(false)
    })
  })
})
