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
}

function harness(initialPlan: GrooveRunPlan = moneyBeatPlan(), loop = false): Harness {
  const clock = new FakeClock()
  const audio = new RecordingDrumAudio(clock)
  const manual = manualDriver()
  const finished: GrooveRunResult[] = []
  const passesGraded: PassGraded[] = []
  const optionsFor = (plan: GrooveRunPlan): UseGrooveRunOptions => ({
    plan,
    clock,
    audio: () => audio,
    driver: manual.driver,
    onFinished: (graded) => finished.push(graded),
    onPassGraded: (graded, pass) => passesGraded.push({ result: graded, pass }),
    ...(loop ? { loop: true } : {}),
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
})
