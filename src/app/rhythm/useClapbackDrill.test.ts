/**
 * Clap/tap-back drill wiring (roadmap 3.21/5.21, REQ-3.6.2): `start()` draws a
 * real pattern and begins an AUDIBLE listening run; when that ends, the same
 * transport replays silently-but-clicking so the learner can tap it back; a
 * tap — on-screen, spacebar, or real MIDI — is recorded relative to THAT
 * run's own anchor; the run ending grades the real taps against the real
 * pattern. `gradeClapback` has its own suite (`core/rhythm/clapback.test.ts`)
 * — this only asserts the wiring between it, the transport, and the two-phase
 * listen/tap sequencing.
 */
import { makeTempoMap, tickToMs } from '@core/timing/tempo.ts'
import { seededRng } from '@core/ports/rng.ts'
import { midi } from '@core/shared/units.ts'
import { emptyEarSession } from '@core/eartraining/session.ts'
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react'
import { FakeClock, FakeMidiInput, RecordingAudioOutput } from '@test/fakes.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useEarTrainingStore } from '@app/state/earTrainingStore.ts'
import { useClapbackDrill, type UseClapbackDrillOptions } from './useClapbackDrill.ts'

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

/** A 4/4 bar with no written tempo mark defaults to 120bpm, i.e. 2000ms/bar. */
const MS_PER_BAR = 2000

afterEach(cleanup)

function setup(overrides: Partial<UseClapbackDrillOptions> = {}) {
  const clock = new FakeClock()
  const midiInput = new FakeMidiInput()
  const manual = manualDriver()
  const options: UseClapbackDrillOptions = {
    level: 3,
    bars: 2,
    clock,
    midiInput,
    rng: seededRng(5),
    audioOutput: new RecordingAudioOutput(clock),
    frameDriver: manual.driver,
    ...overrides,
  }
  const { result, unmount } = renderHook((p: UseClapbackDrillOptions) => useClapbackDrill(p), {
    initialProps: options,
  })
  return { result, clock, midiInput, manual, unmount }
}

describe('useClapbackDrill — starting', () => {
  it('starts idle, with nothing generated', () => {
    const { result } = setup()
    expect(result.current.phase).toBe('idle')
    expect(result.current.pattern).toBeUndefined()
    expect(result.current.grade).toBeUndefined()
    expect(result.current.tapCount).toBe(0)
  })

  it('start() draws a real pattern and begins LISTENING, not tapping', () => {
    const { result } = setup({ bars: 2 })

    act(() => result.current.start())

    expect(result.current.phase).toBe('listening')
    expect(result.current.pattern?.bars).toBe(2)
    expect(result.current.pattern?.timeSignature).toEqual({ beats: 4, beatType: 4 })
    expect(result.current.pattern?.onsets.length).toBeGreaterThan(0)
  })

  it('is a no-op while listening or tapping', () => {
    const { result } = setup()
    act(() => result.current.start())
    const firstPattern = result.current.pattern

    act(() => result.current.start())

    expect(result.current.pattern).toBe(firstPattern)
    expect(result.current.phase).toBe('listening')
  })

  it('the return value has no notation to hand to a score viewer — no `score` field at all', () => {
    const { result } = setup()
    expect('score' in result.current).toBe(false)
  })

  // MINOR-4 review finding: `generateRhythm({ allowRests: true })` can draw a
  // pattern whose every onset is a rest — `gradeClapback`'s own
  // `accuracy: total === 0 ? 1 : ...` would then score a learner who tapped
  // NOTHING a perfect 100%. Seed 12 at level 2, bars 1 is the reviewer's own
  // measured repro (confirmed directly against `generateRhythm` before this
  // fix landed: seed 12/level 2/bars 1/allowRests true draws two rests and no
  // real onset at all) — `start()` must never hand this pattern to the
  // learner unregenerated.
  it('never starts an all-rest pattern, even from a seed that draws one on the first try', () => {
    const { result } = setup({ level: 2, bars: 1, rng: seededRng(12) })

    act(() => result.current.start())

    expect(result.current.pattern?.onsets.some((o) => !o.isRest)).toBe(true)
  })
})

describe('useClapbackDrill — the pattern is heard, not shown, then the learner taps it back', () => {
  it('listening plays the REAL notes (not silenced), with the metronome off', () => {
    const clock = new FakeClock()
    const audioOutput = new RecordingAudioOutput(clock)
    const { result, manual } = setup({ bars: 1, level: 1, clock, audioOutput })

    act(() => result.current.start())
    const pattern = result.current.pattern
    if (pattern === undefined) throw new Error('start() produced no pattern')
    const realOnsetCount = pattern.onsets.filter((o) => !o.isRest).length

    act(() => {
      clock.advance(1 * MS_PER_BAR)
      manual.pump()
    })

    // The listening run has ended and handed off to tapping — the real
    // pattern was actually sounded (a stub that never dispatches audio at
    // all would fail this), and no metronome click sounded during it.
    expect(audioOutput.calls.filter((c) => c.kind === 'noteOn')).toHaveLength(realOnsetCount)
    expect(audioOutput.calls.filter((c) => c.kind === 'click')).toHaveLength(0)
    expect(result.current.phase).toBe('tapping')
  })

  it('once listening ends, tapping starts automatically, with the click on by default', () => {
    const clock = new FakeClock()
    const audioOutput = new RecordingAudioOutput(clock)
    const { result, manual } = setup({ bars: 1, level: 2, clock, audioOutput })
    act(() => result.current.start())
    const pattern = result.current.pattern
    if (pattern === undefined) throw new Error('start() produced no pattern')

    act(() => {
      clock.advance(1 * MS_PER_BAR)
      manual.pump()
    })

    expect(result.current.phase).toBe('tapping')
    expect(result.current.tapCount).toBe(0)
    const noteOnsBeforeTapping = audioOutput.calls.filter((c) => c.kind === 'noteOn').length

    // Tapping is silent (no NEW notes sounded) but the click is audible.
    act(() => {
      clock.advance(1 * MS_PER_BAR)
      manual.pump()
    })
    expect(audioOutput.calls.filter((c) => c.kind === 'noteOn')).toHaveLength(noteOnsBeforeTapping)
    expect(audioOutput.calls.filter((c) => c.kind === 'click').length).toBeGreaterThan(0)
    expect(result.current.phase).toBe('graded')
  })

  it('taps recorded during tapping are graded against the real pattern once that run ends', () => {
    const { result, clock, manual } = setup({ bars: 2, level: 3 })
    act(() => result.current.start())
    const pattern = result.current.pattern
    if (pattern === undefined) throw new Error('start() produced no pattern')
    const onsetCount = pattern.onsets.filter((o) => !o.isRest).length

    // Finish the listening run.
    act(() => {
      clock.advance(pattern.bars * MS_PER_BAR)
      manual.pump()
    })
    expect(result.current.phase).toBe('tapping')

    // Three taps during tapping, not necessarily aligned to onsets — proves
    // the taps flow through to `gradeClapback`, not that they land perfectly.
    act(() => clock.advance(300))
    act(() => result.current.tap())
    act(() => clock.advance(500))
    act(() => result.current.tap())
    act(() => clock.advance(400))
    act(() => result.current.tap())
    expect(result.current.tapCount).toBe(3)

    act(() => {
      clock.advance(pattern.bars * MS_PER_BAR)
      manual.pump()
    })

    expect(result.current.phase).toBe('graded')
    const grade = result.current.grade
    expect(grade).toBeDefined()
    expect((grade?.matched ?? 0) + (grade?.extra ?? 0)).toBe(3)
    expect((grade?.matched ?? 0) + (grade?.missed ?? 0)).toBe(onsetCount)
  })

  it('a tap during listening (before tapping begins) is a no-op', () => {
    const { result, manual, clock } = setup({ bars: 1, level: 1 })
    act(() => result.current.start())
    expect(result.current.phase).toBe('listening')

    act(() => result.current.tap())
    expect(result.current.tapCount).toBe(0)

    act(() => {
      clock.advance(1 * MS_PER_BAR)
      manual.pump()
    })
    expect(result.current.phase).toBe('tapping')
    expect(result.current.tapCount).toBe(0)
  })

  it('taps a real onset exactly and pins it as a zero-deviation match', () => {
    const clock = new FakeClock(50_000)
    const { result, manual } = setup({
      bars: 2,
      level: 3,
      clock,
      audioOutput: new RecordingAudioOutput(clock),
    })
    act(() => result.current.start())
    const pattern = result.current.pattern
    if (pattern === undefined) throw new Error('start() produced no pattern')
    const onset = pattern.onsets.find((o) => !o.isRest)
    if (onset === undefined) throw new Error('generated pattern has no real onset to tap')
    const tempo = makeTempoMap([])
    const onsetMs = tickToMs(tempo, onset.tick)

    // Finish listening first.
    act(() => {
      clock.advance(pattern.bars * MS_PER_BAR)
      manual.pump()
    })
    expect(result.current.phase).toBe('tapping')

    act(() => clock.advance(onsetMs))
    act(() => result.current.tap())
    act(() => {
      clock.advance(pattern.bars * MS_PER_BAR - onsetMs + MS_PER_BAR)
      manual.pump()
    })

    expect(result.current.phase).toBe('graded')
    expect(result.current.grade?.matched).toBe(1)
    expect(result.current.grade?.meanAbsDeviationMs).toBe(0)
  })

  it('the spacebar taps only while tapping, ignoring auto-repeat', () => {
    const { result, manual, clock, unmount } = setup({ bars: 1, level: 1 })

    let dispatched = true
    act(() => {
      dispatched = fireEvent.keyDown(window, { code: 'Space' })
    })
    expect(dispatched).toBe(true)

    act(() => result.current.start())
    // Still listening — Space must not be intercepted yet.
    act(() => {
      dispatched = fireEvent.keyDown(window, { code: 'Space' })
    })
    expect(dispatched).toBe(true)
    expect(result.current.tapCount).toBe(0)

    act(() => {
      clock.advance(1 * MS_PER_BAR)
      manual.pump()
    })
    expect(result.current.phase).toBe('tapping')

    act(() => {
      dispatched = fireEvent.keyDown(window, { code: 'Space' })
    })
    expect(dispatched).toBe(false)
    expect(result.current.tapCount).toBe(1)

    act(() => {
      dispatched = fireEvent.keyDown(window, { code: 'Space', repeat: true })
    })
    expect(result.current.tapCount).toBe(1)

    unmount()
    act(() => {
      dispatched = fireEvent.keyDown(window, { code: 'Space' })
    })
    expect(dispatched).toBe(true)
  })

  it('a real MIDI note-on taps exactly like the on-screen button, only while tapping', () => {
    const { result, midiInput, clock, manual } = setup({ bars: 1, level: 1 })
    act(() => result.current.start())

    act(() => midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: clock.now() }))
    expect(result.current.tapCount).toBe(0)

    act(() => {
      clock.advance(1 * MS_PER_BAR)
      manual.pump()
    })
    expect(result.current.phase).toBe('tapping')

    act(() => midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: clock.now() }))
    expect(result.current.tapCount).toBe(1)
  })

  it('start() after grading draws a fresh pattern and runs the whole listen/tap cycle again', () => {
    const { result, clock, manual } = setup({ bars: 1, level: 1 })
    act(() => result.current.start())
    act(() => {
      clock.advance(1 * MS_PER_BAR)
      manual.pump()
    })
    expect(result.current.phase).toBe('tapping')
    act(() => result.current.tap())
    act(() => {
      clock.advance(1 * MS_PER_BAR)
      manual.pump()
    })
    expect(result.current.phase).toBe('graded')

    act(() => result.current.start())
    expect(result.current.phase).toBe('listening')
    expect(result.current.tapCount).toBe(0)
    expect(result.current.grade).toBeUndefined()

    act(() => {
      clock.advance(1 * MS_PER_BAR)
      manual.pump()
    })
    expect(result.current.phase).toBe('tapping')
    act(() => result.current.tap())
    act(() => result.current.tap())
    expect(result.current.tapCount).toBe(2)

    act(() => {
      clock.advance(1 * MS_PER_BAR)
      manual.pump()
    })
    expect(result.current.phase).toBe('graded')
    const grade = result.current.grade
    expect(grade).toBeDefined()
    expect((grade?.matched ?? 0) + (grade?.extra ?? 0)).toBe(2)
  })
})

/**
 * MAJOR-1 review fix: `level` used to be plain caller-supplied state,
 * discarded on every unmount and never adapted. These tests exercise the
 * hook WITHOUT `options.level` — the production path — so it sources and
 * persists `level` through the real `useEarTrainingStore`, exactly like
 * `RhythmClapback.tsx` does. The store is reset before each test so these
 * never see another test's leftover level.
 */
describe('useClapbackDrill — level (MAJOR-1 review fix): sourced from and persisted to the ear-training session store', () => {
  beforeEach(() => {
    useEarTrainingStore.setState({ session: emptyEarSession(), itemsById: {} })
  })

  function setupAdaptive(overrides: Partial<UseClapbackDrillOptions> = {}) {
    const clock = new FakeClock()
    const manual = manualDriver()
    const options: UseClapbackDrillOptions = {
      bars: 1,
      clock,
      midiInput: new FakeMidiInput(),
      rng: seededRng(11),
      audioOutput: new RecordingAudioOutput(clock),
      frameDriver: manual.driver,
      ...overrides,
    }
    const { result, unmount } = renderHook((p: UseClapbackDrillOptions) => useClapbackDrill(p), {
      initialProps: options,
    })
    return { result, clock, manual, unmount }
  }

  /** One full listen -> tap -> graded cycle, tapping every real onset exactly
   *  on time — a perfect (accuracy 1) run, deterministically, regardless of
   *  which pattern the rng happened to draw. */
  function runPerfectGradedCycle(
    result: ReturnType<typeof setupAdaptive>['result'],
    clock: FakeClock,
    manual: ReturnType<typeof manualDriver>,
  ): void {
    act(() => result.current.start())
    act(() => {
      clock.advance(1 * MS_PER_BAR)
      manual.pump()
    })
    const pattern = result.current.pattern
    if (pattern === undefined) throw new Error('start() produced no pattern')
    const tempo = makeTempoMap([])
    const onsets = pattern.onsets
      .filter((o) => !o.isRest)
      .map((o) => Number(tickToMs(tempo, o.tick)))
      .sort((a, b) => a - b)

    let last = 0
    for (const ms of onsets) {
      act(() => clock.advance(ms - last))
      act(() => result.current.tap())
      last = ms
    }
    // Generous overshoot past the tapping run's own duration — mirrors the
    // existing "taps a real onset exactly" test's identical `+ MS_PER_BAR`
    // buffer, so a small rounding difference never leaves the run short of
    // 'stopped'. Taps already recorded above are unaffected by advancing
    // further past them.
    act(() => {
      clock.advance(1 * MS_PER_BAR - last + MS_PER_BAR)
      manual.pump()
    })
  }

  it('sources level 1 from an empty store on mount, and a manual setLevel persists across a remount', () => {
    const { result, unmount } = setupAdaptive()
    expect(result.current.level).toBe(1)

    act(() => result.current.setLevel(4))
    expect(result.current.level).toBe(4)
    expect(useEarTrainingStore.getState().session.levels['rhythmic-dictation']).toBe(4)

    unmount()
    const { result: remounted } = setupAdaptive()
    // A FRESH hook instance, with no memory of the one above, reads back the
    // SAME level the first instance persisted — proof the level lives in the
    // store, not in this component's own local state.
    expect(remounted.current.level).toBe(4)
  })

  it('five consecutive perfect graded runs at the same level promote it, and the promotion persists across a remount', () => {
    const { result, clock, manual, unmount } = setupAdaptive()
    expect(result.current.level).toBe(1)

    // `adaptEarLevel`'s default window is 5 and its band's high edge is 0.9 —
    // every one of 5 straight accuracy-1 runs must clear it before the level
    // moves at all (see `core/eartraining/session.ts`), so the level must
    // still read 1 after the first four.
    for (let run = 0; run < 4; run++) {
      runPerfectGradedCycle(result, clock, manual)
      expect(result.current.phase).toBe('graded')
      expect(result.current.grade?.accuracy).toBe(1)
      expect(result.current.level).toBe(1)
    }

    runPerfectGradedCycle(result, clock, manual)
    expect(result.current.phase).toBe('graded')
    expect(result.current.grade?.accuracy).toBe(1)
    expect(result.current.level).toBe(2)
    expect(useEarTrainingStore.getState().session.levels['rhythmic-dictation']).toBe(2)

    unmount()
    const { result: remounted } = setupAdaptive()
    expect(remounted.current.level).toBe(2)
  })

  it('options.level, when passed, pins the level and never touches the store', () => {
    const { result } = setupAdaptive({ level: 5 })
    expect(result.current.level).toBe(5)
    expect(useEarTrainingStore.getState().session).toEqual(emptyEarSession())
  })
})
