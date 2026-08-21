/**
 * Rhythm drill wiring (roadmap 2.13, REQ-3.9.1-adjacent): starting draws a
 * real pattern from `core/generator/rhythm.ts` and begins a silent-but-
 * clicking playback run; a tap — from the on-screen action, the spacebar, or
 * a real MIDI press — is recorded relative to the SAME anchor the transport
 * uses; the run ending grades the real taps against the real pattern.
 * `generateRhythm`/`rhythmToScore`/`gradeTapping` themselves already have
 * their own suite (`core/generator/rhythm.test.ts`) — this only asserts the
 * wiring between them and the transport.
 */
import { makeTempoMap, tickToMs } from '@core/timing/tempo.ts'
import { seededRng } from '@core/ports/rng.ts'
import { midi, ticks } from '@core/shared/units.ts'
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react'
import { FakeClock, FakeMidiInput, RecordingAudioOutput } from '@test/fakes.ts'
import { afterEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useProgressStore } from '@app/state/progressStore.ts'
import { useRhythmDrill, type UseRhythmDrillOptions } from './useRhythmDrill.ts'

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

/**
 * A 4/4 bar with no written tempo mark defaults to 120bpm (`rhythmToScore` ->
 * `makeScore` -> `makeTempoMap`'s own default), i.e. 2000ms/bar.
 */
const MS_PER_BAR = 2000

afterEach(() => {
  cleanup()
  useProgressStore.setState({ assessments: [], recordings: [], practiceEntries: [] })
})

function setup(overrides: Partial<UseRhythmDrillOptions> = {}) {
  const clock = new FakeClock()
  const midiInput = new FakeMidiInput()
  const manual = manualDriver()
  const options: UseRhythmDrillOptions = {
    complexity: 3,
    bars: 2,
    clock,
    midiInput,
    rng: seededRng(5),
    audioOutput: new RecordingAudioOutput(clock),
    frameDriver: manual.driver,
    ...overrides,
  }
  const { result, unmount } = renderHook((p: UseRhythmDrillOptions) => useRhythmDrill(p), {
    initialProps: options,
  })
  return { result, clock, midiInput, manual, unmount }
}

describe('useRhythmDrill — starting', () => {
  it('starts idle, with nothing generated', () => {
    const { result } = setup()
    expect(result.current.phase).toBe('idle')
    expect(result.current.pattern).toBeUndefined()
    expect(result.current.grade).toBeUndefined()
    expect(result.current.tapCount).toBe(0)
  })

  it('start() draws a real pattern of the requested length and begins tapping', () => {
    const { result } = setup({ bars: 2 })

    act(() => result.current.start())

    expect(result.current.phase).toBe('tapping')
    expect(result.current.pattern?.bars).toBe(2)
    expect(result.current.pattern?.timeSignature).toEqual({ beats: 4, beatType: 4 })
    expect(result.current.pattern?.onsets.length).toBeGreaterThan(0)
  })

  it('is a no-op while already tapping', () => {
    const { result } = setup()
    act(() => result.current.start())
    const firstPattern = result.current.pattern

    act(() => result.current.start())

    expect(result.current.pattern).toBe(firstPattern)
  })
})

describe('useRhythmDrill — tapping', () => {
  it('tap() before start() is a no-op', () => {
    const { result } = setup()

    act(() => result.current.tap())

    expect(result.current.tapCount).toBe(0)
  })

  it('the on-screen tap() registers a tap while tapping', () => {
    const { result } = setup()
    act(() => result.current.start())

    act(() => result.current.tap())
    act(() => result.current.tap())

    expect(result.current.tapCount).toBe(2)
  })

  it('the spacebar taps, ignoring auto-repeat, and only prevents default while tapping', () => {
    const { result, unmount } = setup()

    // Idle: Space must NOT be intercepted, or keyboard activation of Start
    // and the complexity steppers would break. `fireEvent` returns false only
    // when `preventDefault()` was called.
    let dispatched = true
    act(() => {
      dispatched = fireEvent.keyDown(window, { code: 'Space' })
    })
    expect(dispatched).toBe(true)
    expect(result.current.tapCount).toBe(0)

    act(() => result.current.start())

    act(() => {
      dispatched = fireEvent.keyDown(window, { code: 'Space' })
    })
    expect(dispatched).toBe(false)
    expect(result.current.tapCount).toBe(1)

    act(() => {
      dispatched = fireEvent.keyDown(window, { code: 'Space', repeat: true })
    })
    expect(dispatched).toBe(true)
    expect(result.current.tapCount).toBe(1)

    act(() => {
      dispatched = fireEvent.keyDown(window, { code: 'Space' })
    })
    expect(dispatched).toBe(false)
    expect(result.current.tapCount).toBe(2)

    unmount()
    act(() => {
      dispatched = fireEvent.keyDown(window, { code: 'Space' })
    })
    expect(dispatched).toBe(true)
  })

  it('a real MIDI note-on taps exactly like the on-screen button', () => {
    const { result, midiInput, clock } = setup()
    act(() => result.current.start())

    act(() => midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: clock.now() }))

    expect(result.current.tapCount).toBe(1)
  })
})

describe('useRhythmDrill — grading', () => {
  it('grades the real taps against the real pattern once the run ends', () => {
    const { result, clock, manual } = setup({ bars: 2, complexity: 3 })
    act(() => result.current.start())
    const pattern = result.current.pattern
    expect(pattern).toBeDefined()
    const onsetCount = pattern?.onsets.filter((o) => !o.isRest).length ?? 0

    // Three taps at arbitrary times during the run — not necessarily aligned
    // with the pattern's own onsets, so this proves the taps are actually fed
    // through to `gradeTapping`, not that they land perfectly.
    act(() => clock.advance(300))
    act(() => result.current.tap())
    act(() => clock.advance(500))
    act(() => result.current.tap())
    act(() => clock.advance(400))
    act(() => result.current.tap())
    expect(result.current.tapCount).toBe(3)

    if (pattern === undefined) throw new Error('start() produced no pattern')
    act(() => {
      clock.advance(pattern.bars * MS_PER_BAR)
      manual.pump()
    })

    expect(result.current.phase).toBe('graded')
    const grade = result.current.grade
    expect(grade).toBeDefined()
    // Every tap is accounted for as either matched or extra, and every real
    // onset as either matched or missed — the real invariant `gradeTapping`
    // keeps, so a stub returning a fixed 0/1 grade would fail this.
    expect((grade?.matched ?? 0) + (grade?.extra ?? 0)).toBe(3)
    expect((grade?.matched ?? 0) + (grade?.missed ?? 0)).toBe(onsetCount)
  })

  it('taps a real onset exactly and pins it as a zero-deviation match', () => {
    // A non-zero clock start proves the tap timeline is anchored to when
    // `play()` fired, not to absolute clock time: replacing the anchor
    // subtraction with the raw clock reading would fail this whenever the
    // clock does not start at 0.
    // `setup()`'s returned `clock` is the one actually wired into the hook
    // only when it was not overridden — build the clock (and the
    // clock-dependent audio fake) ourselves and pass both through, so the
    // clock we advance below is the SAME instance driving the transport.
    const clock = new FakeClock(50_000)
    const { result, manual } = setup({
      bars: 2,
      complexity: 3,
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

    act(() => clock.advance(onsetMs))
    act(() => result.current.tap())
    act(() => {
      // A little past the pattern's own end, not exactly on it — the
      // transport only auto-stops once playback has passed the final tick.
      clock.advance(pattern.bars * MS_PER_BAR - onsetMs + MS_PER_BAR)
      manual.pump()
    })

    expect(result.current.phase).toBe('graded')
    expect(result.current.grade?.matched).toBe(1)
    expect(result.current.grade?.meanAbsDeviationMs).toBe(0)
  })

  it('start() after grading draws a fresh pattern, resets the tap count, and grades the second run for real', () => {
    const { result, clock, manual } = setup({ bars: 1, complexity: 1 })
    act(() => result.current.start())
    act(() => result.current.tap())

    act(() => {
      clock.advance(1 * MS_PER_BAR)
      manual.pump()
    })
    expect(result.current.phase).toBe('graded')

    act(() => result.current.start())

    expect(result.current.phase).toBe('tapping')
    expect(result.current.tapCount).toBe(0)
    expect(result.current.grade).toBeUndefined()

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

describe('useRhythmDrill — metronome click (roadmap 2.28a, REQ-3.9.1)', () => {
  it('defaults the click on, and switches it off when metronomeEnabled is false', () => {
    const clockOn = new FakeClock()
    const audioOn = new RecordingAudioOutput(clockOn)
    const onRun = setup({ bars: 2, clock: clockOn, audioOutput: audioOn })
    act(() => onRun.result.current.start())
    const pattern = onRun.result.current.pattern
    if (pattern === undefined) throw new Error('start() produced no pattern')
    act(() => {
      clockOn.advance(pattern.bars * MS_PER_BAR)
      onRun.manual.pump()
    })
    expect(audioOn.clicks.length).toBeGreaterThan(0)

    const clockOff = new FakeClock()
    const audioOff = new RecordingAudioOutput(clockOff)
    const offRun = setup({
      bars: 2,
      clock: clockOff,
      audioOutput: audioOff,
      metronomeEnabled: false,
    })
    act(() => offRun.result.current.start())
    const offPattern = offRun.result.current.pattern
    if (offPattern === undefined) throw new Error('start() produced no pattern')
    act(() => {
      clockOff.advance(offPattern.bars * MS_PER_BAR)
      offRun.manual.pump()
    })
    expect(offRun.result.current.phase).toBe('graded')
    expect(audioOff.clicks.length).toBe(0)
  })
})

describe('useRhythmDrill — manual Stop (roadmap U.3 fix round)', () => {
  it('stop() before anything is decided aborts: no grade, no accuracy logged', () => {
    const { result } = setup({ bars: 2, complexity: 3 })
    act(() => result.current.start())

    // Stopped at tick 0 (no clock advance, no taps) — nothing could possibly
    // have been decided yet.
    act(() => result.current.stop())

    expect(result.current.phase).toBe('graded')
    expect(result.current.stopOutcome).toBe('aborted')
    expect(result.current.grade).toBeUndefined()
    expect(result.current.partial).toBeUndefined()
    // No accuracy reaches the practice log for an aborted run.
    const entries = useProgressStore.getState().practiceEntries
    expect(entries[0]?.accuracy).toBeUndefined()
  })

  it('stop() mid-run grades only the decided prefix, reports "N of M", and logs no accuracy', () => {
    // seed 7 / bars 4 / complexity 1 deterministically draws 12 real onsets at
    // 0,960,1920,2880,3360,3840,4320,4800,5280,5760,6720,7200 (measured via a
    // throwaway probe script against `generateRhythm` directly) — advancing
    // to tick 3840 (4000ms, at 120bpm/480 ticks-per-quarter) with the default
    // 150ms/144-tick tolerance closes exactly the first 5 onsets (their
    // windows end before tick 3840) and leaves the rest pending.
    const { result, clock } = setup({ bars: 4, complexity: 1, rng: seededRng(7) })
    act(() => result.current.start())
    const pattern = result.current.pattern
    if (pattern === undefined) throw new Error('start() produced no pattern')
    const onsetCount = pattern.onsets.filter((o) => !o.isRest).length
    expect(onsetCount).toBe(12)

    act(() => clock.advance(4000))
    act(() => result.current.stop())

    expect(result.current.phase).toBe('graded')
    expect(result.current.stopOutcome).toBe('partial')
    expect(result.current.partial).toEqual({ decided: 5, total: 12 })
    const grade = result.current.grade
    expect(grade).toBeDefined()
    // Every decided onset (matched or missed) is accounted for, and no
    // pending onset is dragged in as "missed".
    expect((grade?.matched ?? 0) + (grade?.missed ?? 0)).toBe(5)
    // Informational only: a partial Stop never logs an accuracy.
    const entries = useProgressStore.getState().practiceEntries
    expect(entries[0]?.accuracy).toBeUndefined()
  })

  it('a natural finish still grades with the batch grader and DOES log an accuracy', () => {
    const { result, clock, manual } = setup({ bars: 1, complexity: 1, rng: seededRng(7) })
    act(() => result.current.start())
    act(() => result.current.tap())

    act(() => {
      clock.advance(1 * MS_PER_BAR)
      manual.pump()
    })

    expect(result.current.phase).toBe('graded')
    expect(result.current.stopOutcome).toBe('natural')
    expect(result.current.partial).toBeUndefined()
    expect(result.current.grade).toBeDefined()
    const entries = useProgressStore.getState().practiceEntries
    expect(entries[0]?.accuracy).toBe(result.current.grade?.accuracy)
  })
})

describe('useRhythmDrill — live tap verdicts (roadmap U.3 fix round)', () => {
  it('classifies a scripted tap series as hit/early/late/extra, through the ms -> ticks conversion', () => {
    // Same seed-7/bars-4/complexity-1 fixture as the Stop describe above:
    // real onsets at 0,960,1920,2880,... — comfortably more than the 480-tick
    // minimum apart, so the default 144-tick tolerance never gets clamped
    // (F1) and every tap below lands unambiguously in one onset's window.
    const { result, clock } = setup({ bars: 4, complexity: 1, rng: seededRng(7) })
    act(() => result.current.start())
    const pattern = result.current.pattern
    if (pattern === undefined) throw new Error('start() produced no pattern')
    const onsets = pattern.onsets.filter((o) => !o.isRest)
    expect(onsets.length).toBeGreaterThanOrEqual(4)
    const [onset0, onset1, onset2, onset3] = onsets
    if (onset0 === undefined || onset1 === undefined || onset2 === undefined || onset3 === undefined) {
      throw new Error('expected at least 4 real onsets')
    }
    const tempo = makeTempoMap([])
    let elapsedMs = 0
    function advanceTo(tick: number): void {
      const targetMs = Number(tickToMs(tempo, ticks(tick)))
      act(() => clock.advance(targetMs - elapsedMs))
      elapsedMs = targetMs
    }

    // Tap 1: exactly on onset0 -> hit (delta 0, inside the 48-tick hit window).
    advanceTo(onset0.tick)
    act(() => result.current.tap())
    expect(result.current.lastTapVerdict).toBe('hit')

    // Tap 2: 100 ticks before onset1 -> inside the 144-tick tolerance but
    // outside the 48-tick hit window -> early.
    advanceTo(onset1.tick - 100)
    act(() => result.current.tap())
    expect(result.current.lastTapVerdict).toBe('early')

    // Tap 3: 100 ticks after onset2 -> same magnitude, opposite sign -> late.
    advanceTo(onset2.tick + 100)
    act(() => result.current.tap())
    expect(result.current.lastTapVerdict).toBe('late')

    // Tap 4: 300 ticks before onset3 -> outside the 144-tick tolerance on
    // either side (onset2 is already claimed and its cursor advanced past by
    // tap 3, so this cannot reach backward and claim it either) -> extra,
    // reported as an undefined verdict.
    advanceTo(onset3.tick - 300)
    act(() => result.current.tap())
    expect(result.current.lastTapVerdict).toBeUndefined()

    expect(result.current.tapCount).toBe(4)
  })

  it('clamps the live tolerance against a tight onset grid (F1 wiring), not just the config default', () => {
    // seed 1 / bars 2 / complexity 3 deterministically draws onsets at
    // 0,480,960,1440,1920,2400,2640,2880 (measured via a throwaway probe
    // against `generateRhythm` directly, with the SAME `allowRests`/
    // `allowTies: true` this hook's own `start()` always passes) — a
    // 240-tick gap between onset index 6 (2400) and 7 (2640), well under
    // `2 * 144` (the un-clamped default tolerance), which is exactly the
    // "ungoverned tolerance can exceed half the onset floor" case
    // `effectiveToleranceTicks`'s own doc (`tapClassifier.ts`) warns about.
    // `start()` must clamp THIS run's tolerance down to
    // `floor((240-1)/2) = 119` ticks before it ever reaches the live
    // classifier, or this test's single tap classifies against the wrong
    // onset entirely.
    const { result, clock } = setup({ bars: 2, complexity: 3, rng: seededRng(1) })
    act(() => result.current.start())
    const pattern = result.current.pattern
    if (pattern === undefined) throw new Error('start() produced no pattern')
    const onsets = pattern.onsets.filter((o) => !o.isRest).map((o) => o.tick)
    expect(onsets).toEqual([0, 480, 960, 1440, 1920, 2400, 2640, 2880])

    const tempo = makeTempoMap([])
    // Tap at tick 2530: 130 ticks after onset index 6 (2400), 110 ticks
    // before onset index 7 (2640).
    //  - Clamped tolerance (119): onset 6's window closed at 2400+119=2519,
    //    already elapsed by 2530, so the FIFO cursor has moved on; onset 7's
    //    window is [2521, 2759], so the tap claims onset 7 at delta -110 ->
    //    'early'.
    //  - Un-clamped config tolerance (144): onset 6's window is still open
    //    ([2256, 2544]), so the SAME tap would wrongly claim onset 6 at
    //    delta +130 -> 'late' instead — a real, observable divergence, not
    //    a theoretical one.
    act(() => clock.advance(Number(tickToMs(tempo, ticks(2530)))))
    act(() => result.current.tap())
    expect(result.current.lastTapVerdict).toBe('early')
  })
})
