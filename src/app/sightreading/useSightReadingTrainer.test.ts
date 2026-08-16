/**
 * The trainer's own state machine wiring (roadmap 2.12, REQ-3.4.1/3/4/6):
 * generating an exercise, the preview discipline (timeout AND early skip),
 * grading a played-through run with no shadowing audio, and adapting the
 * level from the store's history. Per-hook-dependency behaviour
 * (`usePracticeEngine`, `useAssessment`) already has its own suite — this
 * only asserts THIS hook wires them together correctly.
 */
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { MIN_LEVEL } from '@core/sightreading/adaptive.ts'
import { seededRng } from '@core/ports/rng.ts'
import { keyFromFifths } from '@core/theory/keys.ts'
import { midi, millis } from '@core/shared/units.ts'
import { act, cleanup, renderHook } from '@testing-library/react'
import { FakeClock, FakeMidiInput, RecordingAudioOutput } from '@test/fakes.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { MINOR_KEYS } from './customization.ts'
import {
  useSightReadingTrainer,
  type UseSightReadingTrainerOptions,
} from './useSightReadingTrainer.ts'

function manualDriver(): { driver: FrameDriver; pump: () => void } {
  let callback: (() => void) | undefined
  const driver: FrameDriver = (cb) => {
    callback = cb
    return () => {
      callback = undefined
    }
  }
  return { driver, pump: () => callback?.() }
}

function resetStore(): void {
  useSightReadingStore.setState({ level: MIN_LEVEL, history: [] })
}

beforeEach(resetStore)
afterEach(() => {
  cleanup()
  resetStore()
})

/**
 * `seededRng(42)` at level 1 deterministically draws the untransposed level-1
 * default params (verified against `nextExerciseParams`/`generateMelody`
 * directly) — a 4-bar, right-hand-only, 120bpm C major exercise ending at
 * tick 7680, i.e. 8000ms of play. Re-derived here as a constant instead of a
 * magic number so a change to the generator's own weighting shows up as a
 * loud, obvious test failure rather than a silently wrong wait time.
 *
 * The hook's own `score.id` is this generator id PLUS a `#`-delimited content
 * signature (see `contentPieceId` in the hook itself) — asserted with
 * `startsWith` below, never an exact match, since the signature depends on
 * the exact notes the generator happens to draw.
 */
const SEEDED_SCORE_ID = 'generated:C major:4b:4-4:whole-half:right:unison'
const SEEDED_SCORE_DURATION_MS = 8_000

function setup(overrides: Partial<UseSightReadingTrainerOptions> = {}) {
  const clock = new FakeClock()
  const audio = new RecordingAudioOutput(clock)
  const manual = manualDriver()
  const midiInput = new FakeMidiInput()
  const options: UseSightReadingTrainerOptions = {
    clock,
    date: clock,
    audioOutput: audio,
    midiInput,
    frameDriver: manual.driver,
    rng: seededRng(42),
    ...overrides,
  }
  const { result, unmount } = renderHook(() => useSightReadingTrainer(options))
  return { result, clock, audio, manual, options, midiInput, unmount }
}

describe('useSightReadingTrainer — generating an exercise', () => {
  it('starts idle, with nothing generated', () => {
    const { result } = setup()
    expect(result.current.phase).toBe('idle')
    expect(result.current.score).toBeUndefined()
    expect(result.current.level).toBe(MIN_LEVEL)
  })

  it('start() draws a fresh exercise at the current level and begins the preview', () => {
    const { result } = setup()

    act(() => result.current.start())

    expect(result.current.phase).toBe('preview')
    expect(result.current.score?.id.startsWith(`${SEEDED_SCORE_ID}#`)).toBe(true)
    expect(result.current.activeHands).toEqual(['right'])
    expect(result.current.previewRemainingMs).toBe(30_000)
    expect(result.current.error).toBeUndefined()
  })
})

describe('useSightReadingTrainer — a bad draw retries before giving up (roadmap 5.53 review F-RETRY)', () => {
  it('recovers from a single unsatisfiable seed by redrawing off the same Rng, instead of dead-ending into an error', () => {
    useSightReadingStore.setState({ level: 3, history: [] })
    // Level 3, Ab minor, 'whole-half' rhythm, seed 283: verified directly
    // against `generateMelody` that the FIRST draw cannot cadence onto the
    // tonic within the level's leap bound, but the very next draw off the
    // same (stateful, auto-advancing) `Rng` succeeds — exactly the class of
    // single-unlucky-seed failure F-RETRY describes, without the parameter
    // combination itself being unsatisfiable.
    const abMinor = MINOR_KEYS.find((k) => k.tonic.letter === 'A' && k.tonic.alter === -1)
    if (abMinor === undefined) throw new Error('fixture key (Ab minor) not found in MINOR_KEYS')
    const { result } = setup({
      rng: seededRng(283),
      customization: { key: abMinor, rhythm: 'whole-half' },
    })

    act(() => result.current.start())

    expect(result.current.error).toBeUndefined()
    expect(result.current.phase).toBe('preview')
    expect(result.current.score).toBeDefined()
  })
})

describe('useSightReadingTrainer — the preview discipline (REQ-3.4.4)', () => {
  it('counts the preview down and moves to playing on its own once the timer runs out', () => {
    const { result, clock, manual } = setup()
    act(() => result.current.start())

    act(() => {
      clock.advance(12_000)
      manual.pump()
    })
    expect(result.current.phase).toBe('preview')
    expect(result.current.previewRemainingMs).toBe(18_000)

    act(() => {
      clock.advance(18_000)
      manual.pump()
    })
    expect(result.current.phase).toBe('playing')
    expect(result.current.previewRemainingMs).toBe(0)
  })

  it('skipPreview ends the preview immediately, without waiting for the timer', () => {
    const { result } = setup()
    act(() => result.current.start())

    act(() => result.current.skipPreview())

    expect(result.current.phase).toBe('playing')
    expect(result.current.previewRemainingMs).toBe(0)
  })

  it('skipPreview is a no-op once the run has already begun', () => {
    const { result } = setup()
    act(() => result.current.start())
    act(() => result.current.skipPreview())

    expect(() => act(() => result.current.skipPreview())).not.toThrow()
    expect(result.current.phase).toBe('playing')
  })
})

describe('useSightReadingTrainer — playing the exercise (REQ-3.4.4)', () => {
  it('sounds only the metronome, never the exercise itself, while it plays', () => {
    const { result, clock, manual, audio } = setup()
    act(() => result.current.start())
    act(() => result.current.skipPreview())

    act(() => {
      clock.advance(2_000)
      manual.pump()
    })

    expect(audio.playedNotes).toEqual([])
    expect(audio.clicks.length).toBeGreaterThan(0)
  })

  it('finishes the run at the end of the piece, grades it, and retires it', () => {
    const { result, clock, manual } = setup()
    act(() => result.current.start())
    const score = result.current.score
    expect(score).toBeDefined()
    act(() => result.current.skipPreview())

    act(() => {
      clock.advance(SEEDED_SCORE_DURATION_MS + 500)
      manual.pump()
    })

    expect(result.current.phase).toBe('finished')
    expect(result.current.result).toBeDefined()
    expect(result.current.lastRecord?.pieceId).toBe(score?.id)
    expect(result.current.lastRecord?.level).toBe(MIN_LEVEL)

    const history = useSightReadingStore.getState().history
    expect(history).toHaveLength(1)
    expect(history[0]?.pieceId).toBe(score?.id)
  })

  // UI-21 (states sweep): before this, `midi.input` fed the engine/assessment
  // directly, so a learner with no Web MIDI device at all (no `midiInput`
  // option here, matching Safari/Firefox/iPadOS with nothing connected — see
  // `docs/WORKTREES.md`'s B.7 note) had no way to answer a single note. This
  // proves `press`/`release` — the same seam `PracticeKeyboard` calls — reach
  // the exact same live matcher a MIDI keyboard would, with no `MidiInput`
  // device present anywhere in this test.
  it('an on-screen note is graded exactly like a MIDI one, with no MIDI device at all', () => {
    // Not `setup()`: that helper always injects a `FakeMidiInput` — this test
    // needs the `midiInput` option genuinely absent (`exactOptionalPropertyTypes`
    // forbids passing it as explicit `undefined`), the real no-device shape. A
    // fake, already-resolved `connectMidi` stands in for the browser's own
    // `createWebMidi` so this never touches real `navigator.requestMIDIAccess`.
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { result } = renderHook(() =>
      useSightReadingTrainer({
        clock,
        date: clock,
        audioOutput: audio,
        frameDriver: manual.driver,
        rng: seededRng(42),
        connectMidi: () => Promise.resolve({ ok: false, error: 'no MIDI device in this test' }),
      }),
    )
    act(() => result.current.start())
    act(() => result.current.skipPreview())
    expect(result.current.phase).toBe('playing')

    const firstNote = result.current.score?.notes[0]
    expect(firstNote?.startTick).toBe(0)
    act(() => result.current.press(midi(firstNote?.midi ?? 0)))
    act(() => result.current.release(midi(firstNote?.midi ?? 0)))

    act(() => {
      clock.advance(SEEDED_SCORE_DURATION_MS + 500)
      manual.pump()
    })

    expect(result.current.phase).toBe('finished')
    expect(result.current.result).toBeDefined()
    expect(result.current.result?.accuracy).toBeGreaterThan(0)
  })

  it('does not move the level after a single run — adaptLevel needs a run of agreeing reads', () => {
    const { result, clock, manual } = setup()
    act(() => result.current.start())
    act(() => result.current.skipPreview())

    act(() => {
      clock.advance(SEEDED_SCORE_DURATION_MS + 500)
      manual.pump()
    })

    expect(result.current.level).toBe(MIN_LEVEL)
    expect(result.current.previousLevel).toBe(MIN_LEVEL)
  })

  it('starting the next exercise never redraws a retired piece, even when the store already holds its exact id', () => {
    // Pre-seed the history with the id a fresh `seededRng(42)` run's very
    // first draw would produce (established by the "two exercises..." test
    // below: the same seed, from a fresh `Rng`, always draws the same
    // content-keyed id). `start()` must redraw past that collision rather
    // than handing back the retired id — this fails against the un-fixed
    // hook, which never consults `isRetired` at all.
    const probe = setup({ rng: seededRng(42) })
    act(() => probe.result.current.start())
    const collidingId = probe.result.current.score?.id
    expect(collidingId).toBeDefined()
    probe.unmount()
    resetStore()

    useSightReadingStore.setState({
      level: MIN_LEVEL,
      history: [{ pieceId: collidingId ?? '', readAt: 0, accuracy: 1, level: MIN_LEVEL }],
    })

    const { result } = setup({ rng: seededRng(42) })
    act(() => result.current.start())

    expect(result.current.phase).toBe('preview')
    expect(result.current.score?.id).not.toBe(collidingId)
  })
})

describe('useSightReadingTrainer — abandoning a run (REQ-3.4.3/3.4.4)', () => {
  it('unmounting mid-preview (nothing played) still grades and retires the piece, at accuracy 0', () => {
    const { result, unmount } = setup()
    act(() => result.current.start())
    const pieceId = result.current.score?.id
    expect(pieceId).toBeDefined()
    expect(result.current.phase).toBe('preview')

    unmount()

    const history = useSightReadingStore.getState().history
    expect(history).toHaveLength(1)
    expect(history[0]?.pieceId).toBe(pieceId)
    expect(history[0]?.accuracy).toBe(0)
    expect(history[0]?.level).toBe(MIN_LEVEL)
  })

  it('unmounting mid-playing grades on what was actually played, not zero', () => {
    const { result, clock, manual, midiInput, unmount } = setup()
    act(() => result.current.start())
    // Advance the clock partway through the preview BEFORE starting, so the
    // shadow matcher's anchor (`clock.now()` read right after the run
    // starts) is non-zero — pinning it against a stale/zero anchor, which a
    // stubbed `matcherAnchorRef.current = 0` would otherwise pass unnoticed.
    act(() => {
      clock.advance(12_000)
      manual.pump()
    })
    act(() => result.current.skipPreview())
    expect(result.current.phase).toBe('playing')

    const firstNote = result.current.score?.notes[0]
    expect(firstNote?.startTick).toBe(0)
    // Played exactly on time relative to the (non-zero) anchor set the
    // instant the run started playing — see the hook's own module comment.
    act(() =>
      midiInput.emit({
        type: 'noteOn',
        note: midi(firstNote?.midi ?? 0),
        velocity: 80,
        time: millis(12_000),
      }),
    )

    unmount()

    const history = useSightReadingStore.getState().history
    expect(history).toHaveLength(1)
    // Not zero: the one note actually played correctly must count, even
    // though every other expected note is force-closed as `missed` on
    // abandonment (see the hook's module comment on why that force-close is
    // what stops quitting from ever outscoring a finished-but-botched run).
    expect(history[0]?.accuracy).toBeGreaterThan(0)
    expect(history[0]?.accuracy).toBeLessThan(1)
  })

  it('an abandoned run can never score better than the same run finished with nothing else right', () => {
    // Two runs at the SAME piece and the SAME single correct note: one
    // abandoned right after that note, one played out to the end getting
    // nothing else right. Their accuracies must be equal, not the abandoned
    // one higher — proving quitting bought nothing.
    const abandoned = setup()
    act(() => abandoned.result.current.start())
    // Non-zero anchor — see the "unmounting mid-playing" test above.
    act(() => {
      abandoned.clock.advance(12_000)
      abandoned.manual.pump()
    })
    act(() => abandoned.result.current.skipPreview())
    const note = abandoned.result.current.score?.notes[0]
    expect(note?.startTick).toBe(0)
    act(() =>
      abandoned.midiInput.emit({
        type: 'noteOn',
        note: midi(note?.midi ?? 0),
        velocity: 80,
        time: millis(12_000),
      }),
    )
    abandoned.unmount()
    const abandonedAccuracy = useSightReadingStore.getState().history[0]?.accuracy
    resetStore()

    const finished = setup()
    act(() => finished.result.current.start())
    act(() => {
      finished.clock.advance(12_000)
      finished.manual.pump()
    })
    act(() => finished.result.current.skipPreview())
    const note2 = finished.result.current.score?.notes[0]
    act(() =>
      finished.midiInput.emit({
        type: 'noteOn',
        note: midi(note2?.midi ?? 0),
        velocity: 80,
        time: millis(12_000),
      }),
    )
    act(() => {
      finished.clock.advance(SEEDED_SCORE_DURATION_MS + 500)
      finished.manual.pump()
    })
    expect(finished.result.current.phase).toBe('finished')
    const finishedAccuracy = useSightReadingStore.getState().history[0]?.accuracy

    expect(abandonedAccuracy).toBeDefined()
    expect(abandonedAccuracy).toBe(finishedAccuracy)
  })

  it('unmounting mid-run adapts the level from the abandoned record, same as a finished run', () => {
    // Two prior sub-band (0% accuracy) records at level 2 — one more
    // agreeing low read should drop the level to MIN_LEVEL (window 3,
    // REQ-3.4.6). Only holds if the abandon-path cleanup calls `adaptLevel`
    // over the history WITH this run's own record folded in via `retire`,
    // not the pre-run history.
    useSightReadingStore.setState({
      level: 2,
      history: [
        { pieceId: 'p1', readAt: 0, accuracy: 0, level: 2 },
        { pieceId: 'p2', readAt: 0, accuracy: 0, level: 2 },
      ],
    })
    const { result, unmount } = setup()
    act(() => result.current.start())
    expect(result.current.phase).toBe('preview')

    unmount()

    expect(useSightReadingStore.getState().level).toBe(MIN_LEVEL)
  })

  it('unmounting after the run already finished does not append a second record', () => {
    const { result, clock, manual, unmount } = setup()
    act(() => result.current.start())
    act(() => result.current.skipPreview())
    act(() => {
      clock.advance(SEEDED_SCORE_DURATION_MS + 500)
      manual.pump()
    })
    expect(result.current.phase).toBe('finished')

    unmount()

    expect(useSightReadingStore.getState().history).toHaveLength(1)
  })
})

describe('useSightReadingTrainer — retirement keys on content, not just parameters (REQ-3.4.3)', () => {
  it('two exercises drawn from identical params but different Rng draws get different retirement keys', () => {
    const a = setup({ rng: seededRng(42) })
    act(() => a.result.current.start())
    const idA = a.result.current.score?.id
    a.unmount()

    resetStore()

    const b = setup({ rng: seededRng(7) })
    act(() => b.result.current.start())
    const idB = b.result.current.score?.id

    expect(idA).toBeDefined()
    expect(idB).toBeDefined()
    expect(idA).not.toBe(idB)
    // Same generator/param prefix (both seeds draw level 1's canonical,
    // untransposed params) — only the content signature after `#` differs.
    // Without this, the test would pass just as happily if the two seeds
    // had instead drawn different GeneratorParams, which is not the claim.
    expect(idA?.split('#')[0]).toBe(idB?.split('#')[0])
  })

  it('two runs from fresh, identically-seeded Rngs produce the SAME retirement key', () => {
    // The converse of the above, and what retirement actually depends on:
    // identical content must yield an identical key, or a piece a learner
    // has already read could reappear under a different id and never be
    // recognised as retired.
    const a = setup({ rng: seededRng(42) })
    act(() => a.result.current.start())
    const idA = a.result.current.score?.id
    a.unmount()

    resetStore()

    const b = setup({ rng: seededRng(42) })
    act(() => b.result.current.start())
    const idB = b.result.current.score?.id

    expect(idA).toBeDefined()
    expect(idA).toBe(idB)
  })
})

describe('useSightReadingTrainer — metronome click (roadmap 2.28a, REQ-3.9.1)', () => {
  it('defaults the click on, and switches it off when metronomeEnabled is false', () => {
    const on = setup()
    act(() => on.result.current.start())
    act(() => on.result.current.skipPreview())
    act(() => {
      on.clock.advance(2_000)
      on.manual.pump()
    })
    expect(on.audio.clicks.length).toBeGreaterThan(0)

    const off = setup({ metronomeEnabled: false })
    act(() => off.result.current.start())
    act(() => off.result.current.skipPreview())
    act(() => {
      off.clock.advance(SEEDED_SCORE_DURATION_MS + 500)
      off.manual.pump()
    })
    expect(off.result.current.phase).toBe('finished')
    expect(off.audio.clicks.length).toBe(0)
  })
})

describe('useSightReadingTrainer — customization (roadmap 5.12, REQ-3.4.2)', () => {
  it('start() draws from the level default when no customization is set', () => {
    const { result } = setup()
    act(() => result.current.start())
    expect(result.current.score?.measures[0]?.keyFifths).toBe(0) // level 1's own key: C major
    expect(result.current.activeHands).toEqual(['right'])
  })

  it('an overridden key changes the generated score`s own key signature', () => {
    const { result } = setup({ customization: { key: keyFromFifths(1, 'major') } })
    act(() => result.current.start())
    expect(result.current.score?.measures[0]?.keyFifths).toBe(1)
  })

  it('an overridden hands choice changes which hands the exercise actually uses', () => {
    const { result } = setup({ customization: { hands: 'left' } })
    act(() => result.current.start())
    expect(result.current.activeHands).toEqual(['left'])
    expect(result.current.score?.notes.every((n) => n.hand === 'left')).toBe(true)
  })

  it('noAccidentals produces a score with no note outside the diatonic scale', () => {
    const { result } = setup({
      customization: { key: keyFromFifths(1, 'major'), hands: 'left', noAccidentals: true },
    })
    act(() => result.current.start())
    const score = result.current.score
    expect(score).toBeDefined()
    // G major's scale pitch classes: G A B C D E F#.
    const scalePcs = new Set([7, 9, 11, 0, 2, 4, 6])
    expect(score?.notes.every((n) => scalePcs.has(((n.midi % 12) + 12) % 12))).toBe(true)
  })

  it('resetting customization (an empty object) returns to auto-drawn, retirement-aware exercises', () => {
    const { result } = setup({ customization: { hands: 'left' } })
    act(() => result.current.start())
    expect(result.current.activeHands).toEqual(['left'])

    const { result: reset } = setup({ customization: {} })
    act(() => reset.current.start())
    expect(reset.current.activeHands).toEqual(['right'])
  })
})
