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
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react'
import { FakeClock, FakeMidiInput, RecordingAudioOutput } from '@test/fakes.ts'
import { afterEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
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
