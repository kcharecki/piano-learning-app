/**
 * `useGrooveRun` — the run, not the grader. What is pinned here is the timing
 * contract the whole feature rests on: one origin read once, a click track
 * scheduled against it and never re-derived per frame, and acceptance of a
 * stroke decided by the clock rather than by which phase the screen is in.
 */
import { act, renderHook } from '@testing-library/react'
import { FakeClock } from '@test/fakes.ts'
import { describe, expect, it, vi } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { moneyBeat, moneyBeatOpenHat } from '@core/drums/model/referenceGrooves.ts'
import { planGrooveRun, type GrooveRunPlan } from '@core/drums/practice/plan.ts'
import type { GrooveRunResult } from '@core/drums/practice/grade.ts'
import type { Clock, DrumAudioOutput } from '@core/ports/index.ts'
import type { Millis } from '@core/shared/units.ts'
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

type Harness = {
  readonly plan: GrooveRunPlan
  readonly clock: FakeClock
  readonly audio: RecordingDrumAudio
  readonly pump: () => void
  readonly result: { current: ReturnType<typeof useGrooveRun> }
  readonly finished: GrooveRunResult[]
  /** Re-render with a different plan — what picking another groove or tempo does. */
  readonly swapPlan: (plan: GrooveRunPlan) => void
}

function harness(initialPlan: GrooveRunPlan = moneyBeatPlan()): Harness {
  const clock = new FakeClock()
  const audio = new RecordingDrumAudio(clock)
  const manual = manualDriver()
  const finished: GrooveRunResult[] = []
  const optionsFor = (plan: GrooveRunPlan): UseGrooveRunOptions => ({
    plan,
    clock,
    audio: () => audio,
    driver: manual.driver,
    onFinished: (graded) => finished.push(graded),
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
    swapPlan: (plan) => {
      act(() => view.rerender(plan))
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
})
