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
import { midi } from '@core/shared/units.ts'
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react'
import { FakeClock, FakeMidiInput, RecordingAudioOutput } from '@test/fakes.ts'
import { afterEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
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

afterEach(cleanup)

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
