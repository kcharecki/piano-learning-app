/**
 * `useGrooveRun` — the run, not the grader. What is pinned here is the timing
 * contract the whole feature rests on: one origin read once, a click track
 * scheduled against it and never re-derived per frame, and acceptance of a
 * stroke decided by the clock rather than by which phase the screen is in.
 */
import { act, renderHook } from '@testing-library/react'
import fc from 'fast-check'
import { FakeClock } from '@test/fakes.ts'
import { describe, expect, it, vi } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { moneyBeat, moneyBeatOpenHat } from '@core/drums/model/referenceGrooves.ts'
import { planGrooveRun, type GrooveRunPlan } from '@core/drums/practice/plan.ts'
import type { GrooveRunResult } from '@core/drums/practice/grade.ts'
import type { Clock, DrumAudioOutput } from '@core/ports/index.ts'
import type { Millis } from '@core/shared/units.ts'
import { VOICED_VELOCITY } from './mutedVoices.ts'
import { useGrooveRun, type UseGrooveRunOptions } from './useGrooveRun.ts'

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
 * Records every call made through `DrumAudioOutput`, so a test can read back
 * what would have been heard without a DOM or a real audio device — the same
 * discipline `RecordingAudioOutput` gives the piano side, ported to the pad
 * vocabulary the drum port speaks (roadmap DR-06).
 */
type StrikeCall = { readonly pad: MappedDrumPad; readonly velocity: number; readonly atMs: number }
type ClickCall = { readonly accented: boolean; readonly atMs: number }

class RecordingDrumAudio implements DrumAudioOutput {
  readonly strikes: StrikeCall[] = []
  readonly clickCalls: ClickCall[] = []
  allNotesOffCalls = 0
  private readonly clock: Clock

  constructor(clock: Clock) {
    this.clock = clock
  }

  private at(explicit?: Millis): number {
    return explicit ?? this.clock.now()
  }

  strike(pad: MappedDrumPad, velocity: number, atMs?: Millis): void {
    this.strikes.push({ pad, velocity, atMs: this.at(atMs) })
  }

  click(accented: boolean, atMs?: Millis): void {
    this.clickCalls.push({ accented, atMs: this.at(atMs) })
  }

  allNotesOff(): void {
    this.allNotesOffCalls += 1
  }

  setVolume(): void {
    // Not exercised here — nothing under test reads the level back.
  }

  now(): Millis {
    return this.clock.now()
  }
}

function moneyBeatPlan(): GrooveRunPlan {
  return planGrooveRun(moneyBeat(), 80)
}

/** One `onPassGraded` call, as recorded by the harness. */
type PassGraded = { readonly result: GrooveRunResult; readonly pass: number }

type Harness = {
  readonly plan: GrooveRunPlan
  readonly clock: FakeClock
  readonly audio: RecordingDrumAudio
  readonly pump: () => void
  readonly result: { current: ReturnType<typeof useGrooveRun> }
  /** Every `onFinished` call — once per non-loop run, or once per loop run at `stop()` (MAJOR 2). */
  readonly finished: GrooveRunResult[]
  /** Every `onPassGraded` call, loop mode only, in order — see MAJOR 2. */
  readonly passesGraded: PassGraded[]
  /** Re-render with a different plan — what picking another groove or tempo does. */
  readonly swapPlan: (plan: GrooveRunPlan) => void
  /** Re-render with a different `muted` option — what flipping a limb switch does. */
  readonly setMuted: (muted: ReadonlySet<MappedDrumPad> | undefined) => void
}

function harness(
  initialPlan: GrooveRunPlan = moneyBeatPlan(),
  loop = false,
  initialMuted?: ReadonlySet<MappedDrumPad>,
  inputOffsetMs?: number,
): Harness {
  const clock = new FakeClock()
  const audio = new RecordingDrumAudio(clock)
  const manual = manualDriver()
  const finished: GrooveRunResult[] = []
  const passesGraded: PassGraded[] = []
  let currentMuted = initialMuted
  let currentPlan = initialPlan
  const optionsFor = (plan: GrooveRunPlan): UseGrooveRunOptions => ({
    plan,
    clock,
    audio: () => audio,
    driver: manual.driver,
    onFinished: (graded) => finished.push(graded),
    onPassGraded: (graded, pass) => passesGraded.push({ result: graded, pass }),
    ...(loop ? { loop: true } : {}),
    ...(currentMuted === undefined ? {} : { muted: currentMuted }),
    ...(inputOffsetMs === undefined ? {} : { inputOffsetMs }),
  })
  const view = renderHook((plan: GrooveRunPlan) => useGrooveRun(optionsFor(plan)), {
    initialProps: initialPlan,
  })
  return {
    plan: initialPlan,
    clock,
    audio,
    pump: manual.pump,
    result: view.result,
    finished,
    passesGraded,
    swapPlan: (plan) => {
      currentPlan = plan
      act(() => view.rerender(plan))
    },
    setMuted: (muted) => {
      currentMuted = muted
      act(() => view.rerender(currentPlan))
    },
  }
}

/** Move the clock to `ms` and run one frame there. */
function frameAt(h: Harness, ms: number): void {
  act(() => {
    h.clock.setTime(ms)
    h.pump()
  })
}

describe('useGrooveRun', () => {
  it('starts idle, with nothing scheduled and nothing graded', () => {
    const h = harness()
    expect(h.result.current.phase).toBe('idle')
    expect(h.result.current.result).toBeUndefined()
    expect(h.audio.clickCalls).toEqual([])
  })

  /**
   * The whole click track at once, against absolute instants on the clock's
   * own epoch. Re-deriving it per frame is how a stalled frame moves the pulse
   * the learner is playing to — and the grid the grader compares against would
   * then no longer be the grid they heard.
   */
  it('schedules the entire click track from one origin when the run starts', () => {
    const h = harness()
    act(() => h.result.current.start())

    const beatsPerBar = Math.round(h.plan.barMs / h.plan.beatMs)
    const expected = beatsPerBar * (h.plan.countInBars + h.plan.gradedBars)
    expect(h.audio.clickCalls).toHaveLength(expected)
    expect(h.audio.clickCalls.map((c) => c.atMs)).toEqual(
      Array.from({ length: expected }, (_, beat) => beat * h.plan.beatMs),
    )
    expect(h.audio.clickCalls.filter((c) => c.accented).map((c) => c.atMs)).toEqual([0, 3000, 6000])
  })

  it('counts in for a bar, then opens the graded window, then grades at the end', () => {
    const h = harness()
    act(() => h.result.current.start())
    expect(h.result.current.phase).toBe('count-in')

    frameAt(h, h.plan.barMs - 1)
    expect(h.result.current.phase).toBe('count-in')
    // The last count-in beat sounding right before the bar opens is beat 4,
    // counted forwards — not "1 beat left", counted down.
    expect(h.result.current.countInBeat).toBe(4)

    frameAt(h, h.plan.barMs)
    expect(h.result.current.phase).toBe('playing')
    expect(h.result.current.bar).toBe(1)

    frameAt(h, h.plan.barMs + h.plan.barMs)
    expect(h.result.current.bar).toBe(2)

    frameAt(h, h.plan.barMs + h.plan.gradedMs)
    expect(h.result.current.phase).toBe('graded')
    expect(h.finished).toHaveLength(1)
  })

  /**
   * A MAJOR finding from the Teacher seat: this used to count DOWN (4, 3, 2,
   * 1), so the digit "1" landed on the last beat BEFORE the downbeat — one
   * beat before the 1 a learner had just read off the staff's own count row.
   * A teacher counts a bar in forwards, in the chart's own vocabulary, so
   * this walks a whole count-in bar and pins the exact ascending sequence.
   */
  it('counts the count-in bar forwards, matching the chart the learner just read', () => {
    const h = harness()
    act(() => h.result.current.start())
    const seen: number[] = []
    for (let beat = 0; beat < 4; beat++) {
      frameAt(h, beat * h.plan.beatMs)
      seen.push(h.result.current.countInBeat)
    }
    expect(seen).toEqual([1, 2, 3, 4])
  })

  /**
   * MINOR e (roadmap DR-09 "loop" review): `pass` is new surface loop mode
   * added, but a non-loop run must read it as a constant 1 throughout, and
   * `bar` must still follow exactly the formula it used before loop mode
   * existed — a non-loop run is not supposed to notice loop mode exists.
   */
  it('reads pass as 1 throughout a non-loop run, with bar unchanged from the pre-loop formula', () => {
    const h = harness(moneyBeatPlan(), false)
    act(() => h.result.current.start())

    frameAt(h, h.plan.barMs)
    expect(h.result.current.phase).toBe('playing')
    expect(h.result.current.pass).toBe(1)
    expect(h.result.current.bar).toBe(1)

    frameAt(h, h.plan.barMs + h.plan.barMs)
    expect(h.result.current.pass).toBe(1)
    expect(h.result.current.bar).toBe(2)

    frameAt(h, h.plan.barMs + h.plan.gradedMs - 1)
    expect(h.result.current.pass).toBe(1)
  })

  /**
   * Phase decides what the screen says; the clock decides what counted. A
   * stroke half a window before the graded window opens is early, not absent
   * — the window around the first notated instant opens before the bar does.
   */
  it('accepts a stroke that lands inside the first instant’s window but before the bar', () => {
    const h = harness()
    act(() => h.result.current.start())
    frameAt(h, h.plan.barMs - 200)

    act(() => {
      h.clock.setTime(h.plan.barMs - 150)
      h.result.current.hit('kick')
    })
    act(() => {
      h.clock.setTime(h.plan.barMs - 50)
      h.result.current.hit('kick')
    })
    frameAt(h, h.plan.barMs + h.plan.gradedMs)

    const kick = h.finished[0]?.pads.find((row) => row.pad === 'kick')
    // The -150 ms stroke is outside the window and was dropped; the -50 ms one
    // was kept and is the pad's only hit.
    expect(kick?.hits).toBe(1)
    expect(kick?.matched).toBe(1)
  })

  /**
   * Per-hit live feedback (roadmap DR-09 "per-hit live feedback"): every
   * ACCEPTED hit gets an instant, provisional verdict from `judgeLiveHit`,
   * published as `lastHit`. The grading itself is `liveHit.test.ts`'s job;
   * what belongs here is the wiring — when it updates, when it does not, and
   * that its own claimed-instant bookkeeping does not leak.
   */
  describe('live hit feedback', () => {
    it('has no lastHit before anything is struck', () => {
      const h = harness()
      expect(h.result.current.lastHit).toBeUndefined()
    })

    it('judges an accepted hit live, with a fresh seq each time, and reads a second hit far from every remaining instant as extra rather than falsely claiming one', () => {
      const h = harness()
      act(() => h.result.current.start())

      act(() => {
        h.clock.setTime(h.plan.barMs)
        h.result.current.hit('kick')
      })
      expect(h.result.current.lastHit).toMatchObject({
        pad: 'kick',
        kind: 'on-time',
        offsetMs: 0,
        instantIndex: 0,
        seq: 1,
      })

      // Instant #0 is now claimed. Kick's next instant is 1500ms into the
      // pass, so a kick only 40ms after the first is 1460ms from it — well
      // outside the 100ms window — and must read extra, not fall back to
      // instant #0 (claimed) or reach instant #1.
      act(() => {
        h.clock.setTime(h.plan.barMs + 40)
        h.result.current.hit('kick')
      })
      expect(h.result.current.lastHit?.kind).toBe('extra')
      expect(h.result.current.lastHit?.instantIndex).toBeUndefined()
      expect(h.result.current.lastHit?.seq).toBe(2)
    })

    /**
     * DR-08 latency calibration: `inputOffsetMs` is subtracted from every
     * hit's clock reading inside `hit()`, so a rig that reads 40ms late is
     * graded as if it read on time once its offset is supplied. Mirrors the
     * on-time case above, shifted 40ms later on the clock with a matching
     * `inputOffsetMs`.
     */
    it('subtracts inputOffsetMs from the clock reading, so a constant-late rig grades on time', () => {
      const h = harness(moneyBeatPlan(), false, undefined, 40)
      act(() => h.result.current.start())

      act(() => {
        h.clock.setTime(h.plan.barMs + 40)
        h.result.current.hit('kick')
      })
      expect(h.result.current.lastHit).toMatchObject({
        pad: 'kick',
        kind: 'on-time',
        offsetMs: 0,
        instantIndex: 0,
        seq: 1,
      })
    })

    it('claims the next instant, not extra, when the second kick actually lands inside its window', () => {
      const h = harness()
      act(() => h.result.current.start())

      act(() => {
        h.clock.setTime(h.plan.barMs)
        h.result.current.hit('kick')
      })
      expect(h.result.current.lastHit?.instantIndex).toBe(0)

      // Kick's instant #1 is at 1500ms into the pass; landing 40ms past it
      // is inside the 100ms window but past the 25ms on-time threshold, so
      // this reads late against instant #1 rather than extra.
      act(() => {
        h.clock.setTime(h.plan.barMs + 1540)
        h.result.current.hit('kick')
      })
      expect(h.result.current.lastHit).toMatchObject({
        kind: 'late',
        instantIndex: 1,
        offsetMs: 40,
      })
    })

    /**
     * MAJOR finding 1: `lastHit` is a single slot, so a unison instant — hat
     * and kick struck together, which is EVERY instant of the default
     * Quarter-Note Rock — has the second accepted hit overwrite the first
     * within the same frame, and the first pad's own verdict vanishes.
     * `hitByPad` keeps one entry per pad so both survive.
     */
    it('keeps a separate verdict per pad, so a unison hit does not erase the other pad’s', () => {
      const h = harness()
      act(() => h.result.current.start())

      // Money Beat's kick and hi-hat both have an instant at ms=0 of the pass.
      act(() => {
        h.clock.setTime(h.plan.barMs)
        h.result.current.hit('kick')
        h.result.current.hit('hhClosed')
      })

      expect(h.result.current.hitByPad.get('kick')).toMatchObject({
        pad: 'kick',
        kind: 'on-time',
        instantIndex: 0,
      })
      expect(h.result.current.hitByPad.get('hhClosed')).toMatchObject({
        pad: 'hhClosed',
        kind: 'on-time',
        instantIndex: 0,
      })
      // `lastHit` still names whichever of the two landed last — the sentence
      // is unaffected by hitByPad's addition.
      expect(h.result.current.lastHit?.pad).toBe('hhClosed')
    })

    it('starts with an empty hitByPad, and clears it on start()/preview() but not stop()', () => {
      const h = harness()
      expect(h.result.current.hitByPad.size).toBe(0)

      act(() => h.result.current.start())
      act(() => {
        h.clock.setTime(h.plan.barMs)
        h.result.current.hit('kick')
      })
      expect(h.result.current.hitByPad.get('kick')).toBeDefined()

      act(() => h.result.current.stop())
      expect(h.result.current.hitByPad.get('kick')).toBeDefined()

      act(() => h.result.current.start())
      expect(h.result.current.hitByPad.size).toBe(0)

      act(() => {
        h.clock.setTime(h.plan.barMs)
        h.result.current.hit('kick')
      })
      act(() => h.result.current.stop())
      act(() => h.result.current.preview())
      expect(h.result.current.hitByPad.size).toBe(0)
    })

    it('does not touch lastHit for a hit the run rejects', () => {
      const h = harness()
      act(() => h.result.current.start())
      act(() => {
        h.clock.setTime(h.plan.barMs)
        h.result.current.hit('kick')
      })
      const afterAccepted = h.result.current.lastHit

      // Well past the run's own acceptance window — rejected outright, so
      // this must not touch what the learner is currently reading.
      act(() => {
        h.clock.setTime(h.plan.barMs + h.plan.gradedMs + h.plan.windowMs + 1000)
        h.result.current.hit('snare')
      })
      expect(h.result.current.lastHit).toBe(afterAccepted)
    })

    it('resets on start(), but survives stop() and the run finishing', () => {
      const h = harness()
      act(() => h.result.current.start())
      act(() => {
        h.clock.setTime(h.plan.barMs)
        h.result.current.hit('kick')
      })
      expect(h.result.current.lastHit).toBeDefined()

      // A finished run does not clear it — the learner reads it after the
      // stick has already landed.
      frameAt(h, h.plan.barMs + h.plan.gradedMs)
      expect(h.result.current.phase).toBe('graded')
      expect(h.result.current.lastHit).toBeDefined()

      // Nor does stop().
      act(() => h.result.current.stop())
      expect(h.result.current.lastHit).toBeDefined()

      // A fresh start clears it, the same way `result` is cleared.
      act(() => h.result.current.start())
      expect(h.result.current.lastHit).toBeUndefined()
    })

    it('preview() clears lastHit too', () => {
      const h = harness()
      act(() => h.result.current.start())
      act(() => {
        h.clock.setTime(h.plan.barMs)
        h.result.current.hit('kick')
      })
      act(() => h.result.current.stop())
      expect(h.result.current.lastHit).toBeDefined()

      act(() => h.result.current.preview())
      expect(h.result.current.lastHit).toBeUndefined()
    })

    /**
     * MAJOR finding 2 (claim coverage): this `describe` block otherwise only
     * ever drives the non-loop harness, so it never exercises
     * `claimedByPassRef` — the per-pass claimed-instant set loop mode keeps
     * instead of non-loop's one shared `claimedRef` (see `useGrooveRun`'s
     * module comment). If claims were ever shared across passes instead,
     * kick's instant #0 would stay claimed after pass 0 and this would fail
     * the moment pass 1's own downbeat kick is judged.
     */
    it('per-pass claims: pass 1 re-opens instant 0', () => {
      const h = harness(moneyBeatPlan(), true)
      act(() => h.result.current.start())

      frameAt(h, h.plan.barMs)
      expect(h.result.current.phase).toBe('playing')

      // Pass 0's own downbeat kick.
      act(() => {
        h.clock.setTime(h.plan.barMs)
        h.result.current.hit('kick')
      })
      expect(h.result.current.lastHit).toMatchObject({ kind: 'on-time', instantIndex: 0 })

      // Pass 1's own downbeat kick, struck the instant pass 1 opens — BEFORE
      // pass 0 is graded (the windows overlap by windowMs, same as the
      // "boundary hit" loop-mode test above) — must answer instant #0 in a
      // FRESH claim set, not read as already claimed by pass 0's hit above.
      // The FakeClock this harness uses cannot go backwards, so this has to
      // happen before the frame below advances past it.
      act(() => {
        h.clock.setTime(h.plan.barMs + h.plan.gradedMs)
        h.result.current.hit('kick')
      })
      expect(h.result.current.lastHit).toMatchObject({ kind: 'on-time', instantIndex: 0 })

      // Grade pass 0 — its own claim set is discarded alongside it.
      frameAt(h, h.plan.barMs + h.plan.gradedMs + h.plan.windowMs)
      expect(h.result.current.passesGraded).toBe(1)

      // Pass 2's own downbeat kick, same story, once pass 0 has graded.
      act(() => {
        h.clock.setTime(h.plan.barMs + 2 * h.plan.gradedMs)
        h.result.current.hit('kick')
      })
      expect(h.result.current.lastHit).toMatchObject({ kind: 'on-time', instantIndex: 0 })

      // Grade pass 1, then repeat once more for pass 3 — the same claim must
      // re-open every pass, not just the first repeat.
      frameAt(h, h.plan.barMs + 2 * h.plan.gradedMs + h.plan.windowMs)
      expect(h.result.current.passesGraded).toBe(2)

      act(() => {
        h.clock.setTime(h.plan.barMs + 3 * h.plan.gradedMs)
        h.result.current.hit('kick')
      })
      expect(h.result.current.lastHit).toMatchObject({ kind: 'on-time', instantIndex: 0 })
    })
  })

  it('strikes the pressed pad once, at the trainer’s own hit velocity', () => {
    const h = harness()
    act(() => h.result.current.hit('snare'))
    expect(h.audio.strikes).toHaveLength(1)
    expect(h.audio.strikes[0]?.pad).toBe('snare')
    expect(h.audio.strikes[0]?.velocity).toBe(96)
  })

  it('flashes and sounds every press, including presses made before the run starts', () => {
    const h = harness()
    act(() => h.result.current.hit('snare'))
    expect(h.result.current.flash?.pad).toBe('snare')
    expect(h.audio.strikes).toHaveLength(1)

    act(() => h.result.current.hit('snare'))
    // A fresh sequence number, so two strokes on one pad still re-trigger the
    // screen's flash instead of collapsing into one unchanged object.
    expect(h.result.current.flash?.seq).toBe(2)
    expect(h.audio.strikes).toHaveLength(2)
  })

  it('calls allNotesOff on stop, whether or not a run was on', () => {
    const h = harness()
    act(() => h.result.current.start())
    act(() => h.result.current.stop())
    expect(h.audio.allNotesOffCalls).toBe(1)

    act(() => h.result.current.stop())
    expect(h.audio.allNotesOffCalls).toBe(2)
  })

  it('stop abandons the run without grading it', () => {
    const h = harness()
    act(() => h.result.current.start())
    frameAt(h, h.plan.barMs + 100)
    act(() => h.result.current.stop())

    expect(h.result.current.phase).toBe('idle')
    expect(h.finished).toEqual([])

    // And the abandoned timeline is really gone: a frame past the old end
    // instant grades nothing.
    frameAt(h, h.plan.barMs + h.plan.gradedMs + 1000)
    expect(h.finished).toEqual([])
  })

  /**
   * A suspended audio device — which is exactly what a run started by a
   * script rather than a real gesture produces — must cost the learner
   * silence, never the drill.
   */
  it('survives an audio output that throws on every call', () => {
    const plan = moneyBeatPlan()
    const clock = new FakeClock()
    const manual = manualDriver()
    const finished: GrooveRunResult[] = []
    const options: UseGrooveRunOptions = {
      plan,
      clock,
      audio: () => {
        throw new Error('audio device unavailable')
      },
      driver: manual.driver,
      onFinished: (graded) => finished.push(graded),
    }
    const { result } = renderHook(() => useGrooveRun(options))

    expect(() => act(() => result.current.start())).not.toThrow()
    expect(() => act(() => result.current.hit('kick'))).not.toThrow()
    act(() => {
      clock.setTime(plan.barMs + plan.gradedMs)
      manual.pump()
    })
    expect(finished).toHaveLength(1)
  })

  it('does not grade a run the screen unmounted out from under', () => {
    const plan = moneyBeatPlan()
    const clock = new FakeClock()
    const manual = manualDriver()
    const onFinished = vi.fn()
    const { result, unmount } = renderHook(() =>
      useGrooveRun({ plan, clock, driver: manual.driver, onFinished }),
    )
    act(() => result.current.start())
    unmount()
    act(() => {
      clock.setTime(plan.barMs + plan.gradedMs)
      manual.pump()
    })
    expect(onFinished).not.toHaveBeenCalled()
  })

  /**
   * The Rival-seat MAJOR: every shipping rival lets a learner hear a groove
   * before playing it, and this trainer's persona does not already know it.
   * `preview()` is that control — exactly the music the run is about to
   * grade, scheduled once against absolute clock instants the same way
   * `start()` schedules its click track, so it is provable the same way:
   * read off a recording fake, not by listening.
   */
  describe('preview', () => {
    it('strikes every expected instant of every pad, at the right absolute time, plus a click on every beat — and grades nothing', () => {
      const h = harness()
      const startedAt = h.clock.now()
      act(() => h.result.current.preview())
      expect(h.result.current.phase).toBe('preview')

      // `pad.expectedMs` is the grader's OWN array — the instants
      // `gradeGrooveRun` marks against. Asserting the preview against it,
      // rather than against a second derivation of the tick grid, is the
      // point: the demonstration and the marking cannot state different
      // music, because there is only one statement of it.
      const expectedStrikes = h.plan.pads
        .flatMap((pad) => pad.expectedMs.map((ms) => ({ pad: pad.pad, atMs: startedAt + ms })))
        .sort((a, b) => a.atMs - b.atMs || a.pad.localeCompare(b.pad))
      const actualStrikes = h.audio.strikes
        .map((s) => ({ pad: s.pad, atMs: s.atMs }))
        .sort((a, b) => a.atMs - b.atMs || a.pad.localeCompare(b.pad))
      expect(actualStrikes).toEqual(expectedStrikes)
      expect(h.audio.strikes.every((s) => s.velocity === 100)).toBe(true)

      // The Teacher-seat MAJOR: the staff draws `×2` from `gradedBars`, and
      // the run grades `gradedBars`, so a preview of one bar made the card
      // state the length of the task two different ways. Guard the number,
      // not the formula — a one-bar preview would fail here.
      const beatsPerBar = Math.round(h.plan.barMs / h.plan.beatMs)
      expect(h.plan.gradedBars).toBeGreaterThan(1)
      expect(h.audio.clickCalls).toHaveLength(beatsPerBar * h.plan.gradedBars)

      // And it runs for the graded span, not for one pass of the figure.
      frameAt(h, h.plan.gradedMs - 1)
      expect(h.result.current.phase).toBe('preview')

      // The span elapses on its own; nothing was graded and nothing produced.
      frameAt(h, h.plan.gradedMs)
      expect(h.result.current.phase).toBe('idle')
      expect(h.result.current.result).toBeUndefined()
      expect(h.finished).toEqual([])
    })

    /**
     * `Money Beat (Open Hat)` differs from `Money Beat` by exactly one
     * glyph — an open hi-hat instead of a closed one. That is now a
     * different PAD (`hhOpen` vs `hhClosed`), not a different tone on the
     * same pad, so a preview of the two grooves has to strike different
     * pads at the instant that differs. Which pad rings longer, and by how
     * much, is the adapter's job (see `DrumAudioOutput`'s module comment);
     * this hook only has to hand the right pad across.
     */
    it('strikes a different pad for the open hi-hat than for the closed one', () => {
      const closedPads = (() => {
        const h = harness(planGrooveRun(moneyBeat(), 80))
        act(() => h.result.current.preview())
        return new Set(h.audio.strikes.map((s) => s.pad))
      })()
      const openPads = (() => {
        const h = harness(planGrooveRun(moneyBeatOpenHat(), 80))
        act(() => h.result.current.preview())
        return new Set(h.audio.strikes.map((s) => s.pad))
      })()

      expect(closedPads.has('hhClosed')).toBe(true)
      expect(closedPads.has('hhOpen')).toBe(false)
      expect(openPads.has('hhOpen')).toBe(true)
    })

    /**
     * A synth voice that chokes by CALL ORDER (a hi-hat's own behaviour: a
     * new closed-hat strike cuts off a still-ringing open one) needs the
     * calls themselves in time order, not just their recorded instants —
     * scheduling pad by pad would call every `hhClosed` strike before any
     * `hhOpen` strike regardless of when each falls, so the open hat's own
     * strike would never arrive after a later closed-hat neighbour and would
     * ring out its full decay instead of being choked where the score says.
     */
    it('schedules every strike in non-decreasing time order, even across pads (Money Beat Open Hat)', () => {
      const h = harness(planGrooveRun(moneyBeatOpenHat(), 80))
      act(() => h.result.current.preview())

      expect(h.audio.strikes.length).toBeGreaterThan(1)
      for (let i = 1; i < h.audio.strikes.length; i++) {
        const prev = h.audio.strikes[i - 1]
        const curr = h.audio.strikes[i]
        if (prev === undefined || curr === undefined) continue
        expect(curr.atMs).toBeGreaterThanOrEqual(prev.atMs)
      }
    })

    it('returns to idle when stopped mid-preview', () => {
      const h = harness()
      act(() => h.result.current.preview())
      expect(h.result.current.phase).toBe('preview')

      act(() => h.result.current.stop())
      expect(h.result.current.phase).toBe('idle')

      // And it really is cancelled: running the clock past where the preview
      // would have ended does not resurrect it.
      frameAt(h, h.plan.barMs * 4)
      expect(h.result.current.phase).toBe('idle')
    })

    /** A learner tapping along with a preview is not an error — it is the point. */
    it('still flashes and sounds a pad struck during a preview, without grading it', () => {
      const h = harness()
      act(() => h.result.current.preview())
      const struckBefore = h.audio.strikes.length

      act(() => h.result.current.hit('kick'))

      expect(h.result.current.flash?.pad).toBe('kick')
      expect(h.audio.strikes.length).toBeGreaterThan(struckBefore)
      expect(h.result.current.result).toBeUndefined()
      expect(h.finished).toEqual([])
    })
  })

  /**
   * A `GrooveRunResult` outlives the run that made it, on purpose — it stays
   * on screen so the learner can read it. That is exactly why it needs an
   * owner (roadmap T.31): a groove change is a different chart, and the
   * marking must not survive it, or be resurrected by cycling back. A tempo
   * change is different — it does not un-grade a run that already happened,
   * so the result survives it, carrying the bpm it was actually graded at
   * (`GradedRun.bpm`) so the screen can still say so once the tempo control
   * has moved on.
   */
  describe('result ownership', () => {
    /** Drive a whole run to its verdict, from wherever the clock already is. */
    function gradeARun(h: Harness, plan: GrooveRunPlan = h.plan): void {
      const from = h.clock.now()
      act(() => h.result.current.start())
      frameAt(h, from + plan.barMs + plan.gradedMs)
    }

    it('keeps the marking across a tempo change, naming the tempo it was graded at — not the new one', () => {
      const h = harness()
      gradeARun(h)
      expect(h.result.current.result?.bpm).toBe(h.plan.bpm)

      const retuned = planGrooveRun(moneyBeat(), 120)
      h.swapPlan(retuned)
      expect(h.result.current.result).toBeDefined()
      // Still the ORIGINAL run's tempo, not the plan's new one — the whole
      // point of splitting `GradedRun.bpm` out from `plan.bpm`.
      expect(h.result.current.result?.bpm).toBe(h.plan.bpm)
      expect(h.result.current.result?.bpm).not.toBe(retuned.bpm)
    })

    it('retires the marking — actually clears it, not merely hides it — when the groove changes', () => {
      const h = harness()
      gradeARun(h)
      expect(h.result.current.result).toBeDefined()

      // A different groove at the same tempo. Money Beat (Open Hat) has a pad
      // Money Beat does not, so a frozen panel would score 3 pads beside a
      // staff whose whole point is the 4th.
      h.swapPlan(planGrooveRun(moneyBeatOpenHat(), 80))
      expect(h.result.current.result).toBeUndefined()

      // Not merely hidden by a mismatched identity check: cycling back to the
      // exact groove and tempo the run was graded under does not resurrect
      // it, because the state was actually cleared.
      h.swapPlan(h.plan)
      expect(h.result.current.result).toBeUndefined()
    })

    it('marks the new plan once a run is graded under it', () => {
      const h = harness()
      gradeARun(h)
      const openHat = planGrooveRun(moneyBeatOpenHat(), 80)
      h.swapPlan(openHat)
      expect(h.result.current.result).toBeUndefined()

      gradeARun(h, openHat)
      const graded = h.result.current.result
      expect(graded).toBeDefined()
      // The second run is the open-hat groove's own, not the first one
      // resurfacing: it carries the pad the first plan never had.
      expect(graded?.result.pads.map((pad) => pad.pad)).toContain('hhOpen')
    })
  })

  /**
   * Loop mode (roadmap DR-09 "loop"): one count-in, then the graded window
   * repeats back-to-back with no gap and no further count-in, each pass
   * graded on its own the moment it can be — see the module comment.
   */
  describe('loop mode', () => {
    /** This plan's `kick` expected instants, within ONE pass, sorted. */
    function kickExpectedMs(plan: GrooveRunPlan): readonly number[] {
      const kick = plan.pads.find((pad) => pad.pad === 'kick')
      return kick?.expectedMs ?? []
    }

    it('grades two passes back-to-back off a single count-in, with no further count-in between them', () => {
      const h = harness(moneyBeatPlan(), true)
      act(() => h.result.current.start())

      const kickMs = kickExpectedMs(h.plan)
      for (const ms of kickMs) {
        act(() => {
          h.clock.setTime(h.plan.barMs + ms)
          h.result.current.hit('kick')
        })
      }
      // Pass 0 becomes gradeable at gradedMs + windowMs past the graded
      // origin; nothing before that grades it, and phase stays 'playing'
      // rather than jumping to 'graded' the way a non-loop run would. Check
      // this BEFORE pass 1's own downbeat, which — the windows overlap by
      // windowMs, by design — lands chronologically before pass 0 is graded.
      frameAt(h, h.plan.barMs + h.plan.gradedMs - 1)
      expect(h.passesGraded).toHaveLength(0)
      expect(h.result.current.phase).toBe('playing')

      // Pass 1's downbeat kick, struck the instant pass 1 opens — already
      // inside the overlap window, before pass 0 is graded.
      act(() => {
        h.clock.setTime(h.plan.barMs + h.plan.gradedMs)
        h.result.current.hit('kick')
      })

      frameAt(h, h.plan.barMs + h.plan.gradedMs + h.plan.windowMs)
      // `onPassGraded`, not `onFinished`, fires per pass in loop mode
      // (MAJOR 2) — `onFinished` is reserved for `stop()`, checked below.
      expect(h.passesGraded).toHaveLength(1)
      expect(h.passesGraded[0]?.pass).toBe(1)
      expect(h.result.current.phase).toBe('playing')
      expect(h.result.current.passesGraded).toBe(1)
      const firstKick = h.passesGraded[0]?.result.pads.find((row) => row.pad === 'kick')
      expect(firstKick?.matched).toBe(kickMs.length)

      // The rest of pass 1's kicks, played at their own pass's origin — no
      // second count-in, so the origin is exactly one gradedMs after the
      // first.
      for (const ms of kickMs.slice(1)) {
        act(() => {
          h.clock.setTime(h.plan.barMs + h.plan.gradedMs + ms)
          h.result.current.hit('kick')
        })
      }
      frameAt(h, h.plan.barMs + 2 * h.plan.gradedMs + h.plan.windowMs)
      expect(h.passesGraded).toHaveLength(2)
      expect(h.passesGraded[1]?.pass).toBe(2)
      expect(h.result.current.passesGraded).toBe(2)
      expect(h.result.current.phase).toBe('playing')
      const secondKick = h.passesGraded[1]?.result.pads.find((row) => row.pad === 'kick')
      expect(secondKick?.matched).toBe(kickMs.length)
      // Only the kick pad was played — hi-hat and snare were missed both
      // passes — so neither pass is steady, but both still graded.
      expect(h.result.current.steadyPasses).toBe(0)
      // `pass` reads 1-based, off the clock, not the beat count.
      expect(h.result.current.pass).toBe(3)

      // `onFinished` has not fired at all yet — only `stop()` calls it in
      // loop mode, with the LAST pass that graded (MAJOR 2).
      expect(h.finished).toHaveLength(0)
      act(() => h.result.current.stop())
      expect(h.finished).toHaveLength(1)
      expect(h.finished[0]).toBe(h.passesGraded[1]?.result)
    })

    it('counts a pass toward steadyPasses only when it actually graded steady', () => {
      const h = harness(moneyBeatPlan(), true)
      act(() => h.result.current.start())
      const origin = h.plan.barMs

      // Every notated instant of every pad, in chronological order — the
      // FakeClock this harness uses cannot go backwards.
      const allHits = h.plan.pads
        .flatMap((pad) => pad.expectedMs.map((ms) => ({ pad: pad.pad, ms })))
        .sort((a, b) => a.ms - b.ms)
      for (const { pad, ms } of allHits) {
        act(() => {
          h.clock.setTime(origin + ms)
          h.result.current.hit(pad)
        })
      }

      frameAt(h, origin + h.plan.gradedMs + h.plan.windowMs)
      expect(h.result.current.passesGraded).toBe(1)
      expect(h.result.current.steadyPasses).toBe(1)
      expect(h.passesGraded[0]?.result.steady).toBe(true)
    })

    it('sends a boundary hit answering the next pass’s first instant to the next pass, not the one ending', () => {
      const h = harness(moneyBeatPlan(), true)
      act(() => h.result.current.start())
      const gradedOrigin = h.plan.barMs

      // Kick's first instant of every pass is at offset 0 — a hit just past
      // the pass-0/pass-1 boundary, well within the window, answers pass 1's
      // downbeat rather than a late stroke of pass 0 (pass 0 has nothing
      // near its own end on the kick pad — see `moneyBeat`'s pattern).
      act(() => {
        h.clock.setTime(gradedOrigin + h.plan.gradedMs + h.plan.windowMs / 2)
        h.result.current.hit('kick')
      })

      frameAt(h, gradedOrigin + h.plan.gradedMs + h.plan.windowMs)
      const firstPassKick = h.passesGraded[0]?.result.pads.find((row) => row.pad === 'kick')
      expect(firstPassKick?.hits).toBe(0)

      frameAt(h, gradedOrigin + 2 * h.plan.gradedMs + h.plan.windowMs)
      const secondPassKick = h.passesGraded[1]?.result.pads.find((row) => row.pad === 'kick')
      expect(secondPassKick?.hits).toBe(1)
      expect(secondPassKick?.matched).toBe(1)
    })

    // The genuine near-boundary tie-break (a pass with an instant right at
    // its own end vs. the next pass having none near its own start, and the
    // reverse) is proved exhaustively, with hand-crafted plans built for the
    // purpose, in `loop.test.ts` — this is a hook-level filing check: a
    // stroke shortly after a pad's own last instant, but nowhere near the
    // pass boundary itself, stays filed under the pass it answered.
    it('files a stroke shortly after a pad’s own last instant in the pass that instant belongs to', () => {
      const h = harness(moneyBeatPlan(), true)
      act(() => h.result.current.start())
      const gradedOrigin = h.plan.barMs
      const kickMs = kickExpectedMs(h.plan)
      const lastKick = kickMs[kickMs.length - 1]
      if (lastKick === undefined) throw new Error('fixture has no kick instants')
      act(() => {
        h.clock.setTime(gradedOrigin + lastKick + h.plan.windowMs / 4)
        h.result.current.hit('kick')
      })

      frameAt(h, gradedOrigin + h.plan.gradedMs + h.plan.windowMs)
      const firstPassKick = h.passesGraded[0]?.result.pads.find((row) => row.pad === 'kick')
      expect(firstPassKick?.hits).toBe(1)
      expect(firstPassKick?.matched).toBe(1)
    })

    it('schedules the next pass’s clicks exactly once, at the right absolute instants, the moment the pass before it opens', () => {
      const h = harness(moneyBeatPlan(), true)
      act(() => h.result.current.start())
      const beatsPerBar = Math.round(h.plan.barMs / h.plan.beatMs)
      const startClicks = beatsPerBar * (h.plan.countInBars + h.plan.gradedBars)
      const perPassClicks = beatsPerBar * h.plan.gradedBars
      expect(h.audio.clickCalls).toHaveLength(startClicks)

      // The instant pass 0 opens (count-in ends), pass 1's clicks are
      // scheduled too — one pass ahead, never re-derived, so there is no
      // audible gap waiting on a frame that happens to land near the
      // boundary.
      frameAt(h, h.plan.barMs)
      expect(h.audio.clickCalls).toHaveLength(startClicks + perPassClicks)
      const pass1Origin = h.plan.barMs + h.plan.gradedMs
      const pass1Clicks = h.audio.clickCalls.slice(startClicks)
      expect(pass1Clicks.map((c) => c.atMs)).toEqual(
        Array.from({ length: perPassClicks }, (_, beat) => pass1Origin + beat * h.plan.beatMs),
      )

      // Still inside pass 0: pumping more frames does not re-schedule pass 1,
      // nor reach ahead to pass 2 yet.
      frameAt(h, h.plan.barMs + 1)
      expect(h.audio.clickCalls).toHaveLength(startClicks + perPassClicks)

      // The instant pass 1 opens, pass 2's clicks are scheduled.
      frameAt(h, h.plan.barMs + h.plan.gradedMs)
      expect(h.audio.clickCalls).toHaveLength(startClicks + 2 * perPassClicks)
      const pass2Origin = h.plan.barMs + 2 * h.plan.gradedMs
      const pass2Clicks = h.audio.clickCalls.slice(startClicks + perPassClicks)
      expect(pass2Clicks.map((c) => c.atMs)).toEqual(
        Array.from({ length: perPassClicks }, (_, beat) => pass2Origin + beat * h.plan.beatMs),
      )

      // Pumping more frames within the same pass does not re-schedule it.
      frameAt(h, h.plan.barMs + h.plan.gradedMs + 10)
      expect(h.audio.clickCalls).toHaveLength(startClicks + 2 * perPassClicks)
    })

    it('stop mid-pass grades nothing further, and calls onFinished exactly once — at Stop, not per pass', () => {
      const h = harness(moneyBeatPlan(), true)
      act(() => h.result.current.start())
      frameAt(h, h.plan.barMs + h.plan.gradedMs + h.plan.windowMs)
      expect(h.passesGraded).toHaveLength(1)
      // Not yet — onFinished is reserved for stop() in loop mode (MAJOR 2).
      expect(h.finished).toHaveLength(0)

      frameAt(h, h.plan.barMs + h.plan.gradedMs + 100)
      act(() => h.result.current.stop())
      expect(h.result.current.phase).toBe('idle')
      // The tally from the pass that DID grade survives Stop — only `start()`
      // resets it.
      expect(h.result.current.passesGraded).toBe(1)
      // Stop is where the one onFinished call happens, with the pass that
      // DID grade.
      expect(h.finished).toHaveLength(1)
      expect(h.finished[0]).toBe(h.passesGraded[0]?.result)

      // Running the clock past where pass 1 would have graded does not
      // resurrect grading — the timeline is really gone.
      frameAt(h, h.plan.barMs + 3 * h.plan.gradedMs)
      expect(h.passesGraded).toHaveLength(1)
      expect(h.finished).toHaveLength(1)
      expect(h.result.current.passesGraded).toBe(1)
    })

    it('stopped before any pass graded, onFinished never fires (MAJOR 2)', () => {
      const h = harness(moneyBeatPlan(), true)
      act(() => h.result.current.start())
      // Mid pass 0, well before it becomes gradeable.
      frameAt(h, h.plan.barMs + 100)
      expect(h.passesGraded).toHaveLength(0)

      act(() => h.result.current.stop())
      expect(h.result.current.phase).toBe('idle')
      expect(h.finished).toHaveLength(0)
    })

    it('a loop run of three graded passes calls onPassGraded three times, with passes 1, 2, 3, and onFinished once, at Stop, with the third pass’s result (MAJOR 2)', () => {
      const h = harness(moneyBeatPlan(), true)
      act(() => h.result.current.start())
      const origin = h.plan.barMs

      frameAt(h, origin + h.plan.gradedMs + h.plan.windowMs)
      frameAt(h, origin + 2 * h.plan.gradedMs + h.plan.windowMs)
      frameAt(h, origin + 3 * h.plan.gradedMs + h.plan.windowMs)
      expect(h.passesGraded.map((p) => p.pass)).toEqual([1, 2, 3])
      expect(h.finished).toHaveLength(0)

      act(() => h.result.current.stop())
      expect(h.finished).toHaveLength(1)
      expect(h.finished[0]).toBe(h.passesGraded[2]?.result)
    })

    it('accepts a hit with no upper bound while looping — unlike a non-loop run, a very late stroke still counts', () => {
      const h = harness(moneyBeatPlan(), true)
      act(() => h.result.current.start())
      const gradedOrigin = h.plan.barMs

      // Grade every earlier pass boundary on its own frame first — the
      // FakeClock this harness uses cannot go backwards, and the late hit
      // below has to land after all of them — so this stays a clean test of
      // `hit()`'s own acceptance rule rather than also exercising the
      // MAJOR 1 stall-discard below.
      frameAt(h, gradedOrigin + h.plan.gradedMs + h.plan.windowMs)
      frameAt(h, gradedOrigin + 2 * h.plan.gradedMs + h.plan.windowMs)
      frameAt(h, gradedOrigin + 3 * h.plan.gradedMs + h.plan.windowMs)

      // Land well past a single non-loop run's acceptance window
      // (`endAt + windowMs`), deep into what would be pass 3 (0-based).
      act(() => {
        h.clock.setTime(gradedOrigin + 3 * h.plan.gradedMs + 500)
        h.result.current.hit('kick')
      })
      frameAt(h, gradedOrigin + 4 * h.plan.gradedMs + h.plan.windowMs)

      const pass4 = h.passesGraded.find((p) => p.pass === 4)
      const pass4Kick = pass4?.result.pads.find((row) => row.pad === 'kick')
      expect(pass4Kick?.hits).toBe(1)
    })

    /**
     * MAJOR 1: a hidden tab (or any other large gap between frames) must not
     * replay a backlog of clicks into the past, nor grade passes the learner
     * never heard the click track for. See the module comment's "Stalled
     * frames" section.
     */
    describe('stalled frames', () => {
      it('drops every pass more than one whole gradedMs stale, never schedules a click behind the stalled frame’s instant, and never calls onFinished for any of them', () => {
        const h = harness(moneyBeatPlan(), true)
        act(() => h.result.current.start())
        const clicksBeforeStall = h.audio.clickCalls.length

        // No frame runs for a long stretch, then one arrives exactly on the
        // instant the 12th pass becomes gradeable — landing many whole
        // passes past where pass 0 (and the nine after it) became gradeable.
        // The two MOST RECENT ungraded passes (11 and 12, 1-based) are, by
        // the windowMs overlap this module already relies on, both within
        // one gradedMs of "now" at that exact instant — the stall-snap
        // threshold is "more than a whole EXTRA gradedMs late", so both of
        // those still grade; only the ones further back than that are stale.
        const stallPasses = 12
        const stallAt = h.plan.barMs + stallPasses * h.plan.gradedMs + h.plan.windowMs
        frameAt(h, stallAt)

        // CLICK FLOOR: nothing scheduled during this frame landed behind
        // `now` — the backlog was skipped, not replayed.
        for (const click of h.audio.clickCalls.slice(clicksBeforeStall)) {
          expect(click.atMs).toBeGreaterThanOrEqual(stallAt)
        }

        // STALL SNAP: the ten passes further back than that are dropped —
        // no `onPassGraded`, no tally growth for any of them — and since no
        // `stop()` has happened yet, `onFinished` was not called for any
        // pass either (loop mode reserves that call for `stop()` — MAJOR 2).
        expect(h.passesGraded.map((p) => p.pass)).toEqual([stallPasses - 1, stallPasses])
        expect(h.result.current.passesGraded).toBe(2)
        expect(h.finished).toHaveLength(0)
      })

      /**
       * A property sweep rather than one hand-picked gap: whatever sequence
       * of frame gaps arrives — some ordinary, some multi-pass stalls —
       * `steadyPasses` can never exceed `passesGraded`, and `onPassGraded`
       * fires exactly once for every pass the tally counts (no pass is
       * silently double-counted or counted without its own callback).
       */
      it('holds steadyPasses <= passesGraded, and one onPassGraded call per counted pass, across arbitrary sequences of frame gaps', () => {
        const plan = moneyBeatPlan()
        fc.assert(
          fc.property(
            fc.array(fc.integer({ min: 10, max: 3 * plan.gradedMs }), {
              minLength: 30,
              maxLength: 30,
            }),
            (gapsMs) => {
              const h = harness(plan, true)
              act(() => h.result.current.start())
              let now: number = h.clock.now()
              for (const gap of gapsMs) {
                now += gap
                frameAt(h, now)
                expect(h.result.current.steadyPasses).toBeLessThanOrEqual(
                  h.result.current.passesGraded,
                )
                expect(h.passesGraded).toHaveLength(h.result.current.passesGraded)
              }
            },
          ),
          { numRuns: 25 },
        )
      })
    })
  })

  describe('per-limb mute (roadmap DR-09 "per-limb mute")', () => {
    /** This plan's `pad`'s expected instants, within ONE pass, sorted. */
    function padExpectedMs(plan: GrooveRunPlan, pad: MappedDrumPad): readonly number[] {
      const found = plan.pads.find((p) => p.pad === pad)
      return found?.expectedMs ?? []
    }

    it('start() voices every muted instant itself, at the grader’s own ms, and schedules nothing for the pads still on', () => {
      const h = harness(moneyBeatPlan(), false, new Set<MappedDrumPad>(['kick']))
      act(() => h.result.current.start())

      const gradedOrigin = h.plan.barMs
      const kickMs = padExpectedMs(h.plan, 'kick')
      expect(kickMs.length).toBeGreaterThan(0)
      expect(h.audio.strikes).toEqual(
        kickMs.map((ms) => ({ pad: 'kick', velocity: VOICED_VELOCITY, atMs: gradedOrigin + ms })),
      )

      // Nothing else is voiced by the app — the pads still on are left for
      // the learner to play.
      expect(h.audio.strikes.every((s) => s.pad === 'kick')).toBe(true)
    })

    it('grades the pads still on exactly as it would unmuted, and drops the muted pad from the result entirely', () => {
      const unmuted = harness(moneyBeatPlan())
      const muted = harness(moneyBeatPlan(), false, new Set<MappedDrumPad>(['kick']))
      const gradedOrigin = unmuted.plan.barMs

      for (const h of [unmuted, muted]) {
        act(() => h.result.current.start())
        // Driven in time order across both pads — the clock is monotonic,
        // so hhClosed's and snare's own instants must be interleaved rather
        // than played out one pad at a time.
        const strokes = (['hhClosed', 'snare'] as const)
          .flatMap((pad) => padExpectedMs(h.plan, pad).map((ms) => ({ pad, ms })))
          .sort((a, b) => a.ms - b.ms)
        for (const { pad, ms } of strokes) {
          act(() => {
            h.clock.setTime(gradedOrigin + ms)
            h.result.current.hit(pad)
          })
        }
        frameAt(h, gradedOrigin + h.plan.gradedMs)
      }

      const mutedRows = muted.result.current.result?.result.pads ?? []
      expect(mutedRows.find((row) => row.pad === 'kick')).toBeUndefined()

      const unmutedRows = unmuted.result.current.result?.result.pads ?? []
      for (const pad of ['hhClosed', 'snare'] as const) {
        expect(mutedRows.find((row) => row.pad === pad)).toEqual(
          unmutedRows.find((row) => row.pad === pad),
        )
      }
    })

    it('a hit on a muted pad is never recorded: no lastHit, no hitByPad entry, no result row', () => {
      const h = harness(moneyBeatPlan(), false, new Set<MappedDrumPad>(['kick']))
      act(() => h.result.current.start())
      const gradedOrigin = h.plan.barMs
      const kickMs = padExpectedMs(h.plan, 'kick')
      const firstKick = kickMs[0]
      if (firstKick === undefined) throw new Error('fixture has no kick instants')

      act(() => {
        h.clock.setTime(gradedOrigin + firstKick)
        h.result.current.hit('kick')
      })
      expect(h.result.current.lastHit).toBeUndefined()
      expect(h.result.current.hitByPad.size).toBe(0)

      frameAt(h, gradedOrigin + h.plan.gradedMs)
      const kickRow = h.result.current.result?.result.pads.find((row) => row.pad === 'kick')
      expect(kickRow).toBeUndefined()
    })

    it('loop mode: the second pass’s muted strikes are scheduled one pass ahead, at that pass’s own origin', () => {
      const h = harness(moneyBeatPlan(), true, new Set<MappedDrumPad>(['kick']))
      act(() => h.result.current.start())

      const gradedOrigin = h.plan.barMs
      const kickMs = padExpectedMs(h.plan, 'kick')
      const pass0Strikes = kickMs.map((ms) => ({
        pad: 'kick' as const,
        velocity: VOICED_VELOCITY,
        atMs: gradedOrigin + ms,
      }))
      expect(h.audio.strikes).toEqual(pass0Strikes)

      // The instant pass 0 opens, pass 1's muted strikes are scheduled too —
      // one pass ahead, exactly like its click track (see the click-track
      // test above this describe block).
      frameAt(h, gradedOrigin)
      const pass1Origin = gradedOrigin + h.plan.gradedMs
      const pass1Strikes = kickMs.map((ms) => ({
        pad: 'kick' as const,
        velocity: VOICED_VELOCITY,
        atMs: pass1Origin + ms,
      }))
      expect(h.audio.strikes).toEqual([...pass0Strikes, ...pass1Strikes])
    })

    it('changing muted mid-run changes nothing until the next start()', () => {
      const h = harness(moneyBeatPlan())
      act(() => h.result.current.start())
      const gradedOrigin = h.plan.barMs
      const kickMs = padExpectedMs(h.plan, 'kick')
      const firstKick = kickMs[0]
      if (firstKick === undefined) throw new Error('fixture has no kick instants')

      // Flipping the switch mid-run does not touch the run in progress: it
      // was started unmuted, so a kick hit still grades normally.
      h.setMuted(new Set<MappedDrumPad>(['kick']))
      act(() => {
        h.clock.setTime(gradedOrigin + firstKick)
        h.result.current.hit('kick')
      })
      expect(h.result.current.lastHit).toBeDefined()
      expect(h.result.current.hitByPad.has('kick')).toBe(true)

      // A fresh start() freezes the now-current muted set (kick).
      act(() => h.result.current.stop())
      const strikesBeforeRestart = h.audio.strikes.length
      act(() => h.result.current.start())
      const gradedOrigin2 = h.clock.now() + h.plan.barMs
      expect(
        h.audio.strikes
          .slice(strikesBeforeRestart)
          .some((s) => s.pad === 'kick' && s.atMs === gradedOrigin2 + firstKick),
      ).toBe(true)

      // F6: changing `muted` AGAIN, this time mid the SECOND run, must not
      // touch that run either — the freeze holds the set from ITS OWN
      // start() (kick), not whatever `options.muted` has drifted to since.
      // Asserting `hitByPad.has('kick')` is false right after `start()`
      // would be trivially true regardless of the freeze (start() always
      // resets `hitByPad` to empty) — so this changes `muted` to a
      // DIFFERENT set first: if `hit()` read the live ref instead of the
      // one frozen at start(), the kick hit below would no longer be
      // filtered (mutedRef no longer has kick) and would show up in
      // `hitByPad`, the result, and would not match the strikes already
      // scheduled — only the freeze keeps all three as they were.
      h.setMuted(new Set<MappedDrumPad>())
      act(() => {
        h.clock.setTime(gradedOrigin2 + firstKick)
        h.result.current.hit('kick')
      })
      expect(h.result.current.hitByPad.has('kick')).toBe(false)

      frameAt(h, gradedOrigin2 + h.plan.gradedMs)
      const kickRow = h.result.current.result?.result.pads.find((row) => row.pad === 'kick')
      expect(kickRow).toBeUndefined()

      // And the voices the APP itself scheduled for this run are still the
      // ORIGINAL frozen set's (kick) — not recomputed against the changed
      // (now empty) live `muted`. Filtered to `VOICED_VELOCITY`: the kick
      // press above also sounds at `HIT_VELOCITY` — every press does,
      // muted or not (see the module comment) — which is a different thing
      // from what the app voices on the learner's behalf.
      const voiced = h.audio.strikes
        .slice(strikesBeforeRestart)
        .filter((s) => s.velocity === VOICED_VELOCITY)
      expect(voiced).toEqual(
        kickMs.map((ms) => ({ pad: 'kick', velocity: VOICED_VELOCITY, atMs: gradedOrigin2 + ms })),
      )
    })

    it('start() does not throw when every pad would be muted — it grades as if unmuted instead', () => {
      // F3: `mutePads` (the core primitive) THROWS when `muted` covers every
      // plan pad — a run needs at least one graded limb. The screen already
      // disables the last switch to prevent a learner from reaching this,
      // but the hook must be total on its own, not merely lucky that its one
      // caller behaves: a throw here would escape `start()` into a React
      // click handler with `loopingRef`/`frozenMutedRef` already mutated.
      const allPads = new Set(moneyBeatPlan().pads.map((p) => p.pad))
      const h = harness(moneyBeatPlan(), false, allPads)

      expect(() => act(() => h.result.current.start())).not.toThrow()
      expect(h.result.current.phase).toBe('count-in')

      const gradedOrigin = h.plan.barMs
      frameAt(h, gradedOrigin + h.plan.gradedMs)

      // Graded as if nothing were muted: every plan pad gets a result row.
      const rows = h.result.current.result?.result.pads ?? []
      for (const padPlan of h.plan.pads) {
        expect(rows.find((row) => row.pad === padPlan.pad)).toBeDefined()
      }
    })

    /**
     * F4: the voiced strikes used to share one `withAudio` block with the
     * clicks, in both `start()` and the loop's per-pass scheduling — a
     * throwing `out.click` would abort the strikes right after it, leaving a
     * muted limb silent while still ungraded. Each now gets its own
     * `withAudio` call.
     */
    it('still records the muted pad’s strikes even when out.click throws', () => {
      class ThrowingClickAudio extends RecordingDrumAudio {
        override click(): void {
          throw new Error('click failed')
        }
      }
      const clock = new FakeClock()
      const audio = new ThrowingClickAudio(clock)
      const manual = manualDriver()
      const view = renderHook(
        (plan: GrooveRunPlan) =>
          useGrooveRun({
            plan,
            clock,
            audio: () => audio,
            driver: manual.driver,
            muted: new Set<MappedDrumPad>(['kick']),
          }),
        { initialProps: moneyBeatPlan() },
      )

      expect(() => act(() => view.result.current.start())).not.toThrow()

      const plan = moneyBeatPlan()
      const gradedOrigin = plan.barMs
      const kickMs = padExpectedMs(plan, 'kick')
      expect(kickMs.length).toBeGreaterThan(0)
      expect(audio.strikes).toEqual(
        kickMs.map((ms) => ({ pad: 'kick', velocity: VOICED_VELOCITY, atMs: gradedOrigin + ms })),
      )
    })

    it('preview() ignores mute and still strikes the muted pad', () => {
      const h = harness(moneyBeatPlan(), false, new Set<MappedDrumPad>(['kick']))
      act(() => h.result.current.preview())
      expect(h.audio.strikes.some((s) => s.pad === 'kick')).toBe(true)
    })
  })
})
