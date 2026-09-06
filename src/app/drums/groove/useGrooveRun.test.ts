/**
 * `useGrooveRun` — the run, not the grader. What is pinned here is the timing
 * contract the whole feature rests on: one origin read once, a click track
 * scheduled against it and never re-derived per frame, and acceptance of a
 * stroke decided by the clock rather than by which phase the screen is in.
 */
import { act, renderHook } from '@testing-library/react'
import { FakeClock, RecordingAudioOutput } from '@test/fakes.ts'
import { describe, expect, it, vi } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import type { GrooveScore } from '@core/drums/model/groove.ts'
import { moneyBeat, moneyBeatOpenHat } from '@core/drums/model/referenceGrooves.ts'
import { planGrooveRun, type GrooveRunPlan } from '@core/drums/practice/plan.ts'
import type { GrooveRunResult } from '@core/drums/practice/grade.ts'
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

function moneyBeatPlan(): GrooveRunPlan {
  return planGrooveRun(moneyBeat(), 80)
}

type Harness = {
  readonly plan: GrooveRunPlan
  readonly clock: FakeClock
  readonly audio: RecordingAudioOutput
  readonly pump: () => void
  readonly result: { current: ReturnType<typeof useGrooveRun> }
  readonly finished: GrooveRunResult[]
  /** Re-render with a different plan — what picking another groove or tempo does. */
  readonly swapPlan: (plan: GrooveRunPlan) => void
}

function harness(initialPlan: GrooveRunPlan = moneyBeatPlan()): Harness {
  const clock = new FakeClock()
  const audio = new RecordingAudioOutput(clock)
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

/**
 * Every tone the audio output was told to schedule, as `at@pitch for ms` —
 * the two cues an ear actually has: where the stroke lands, what it sounds
 * like, and how long it rings. Sorted, so it is a set comparison and not an
 * assertion about the order the scheduler happens to walk the pads in.
 *
 * Pairing an onset with its release by "the earliest release of that pitch at
 * or after it" is exact here because every tone is shorter than the gap
 * between two strokes of the same pad (240 ms open hat against a 375 ms
 * eighth at 80 bpm) — the same invariant `OPEN_TONE_MS` is chosen under.
 */
function scheduledVoices(audio: RecordingAudioOutput): string[] {
  const onsets: { at: number; note: number }[] = []
  const releases: { at: number; note: number }[] = []
  for (const call of audio.calls) {
    if (call.kind === 'noteOn') onsets.push({ at: call.at, note: call.note })
    if (call.kind === 'noteOff') releases.push({ at: call.at, note: call.note })
  }
  return onsets
    .map((on) => {
      const held = releases
        .filter((off) => off.note === on.note && off.at >= on.at)
        .sort((a, b) => a.at - b.at)[0]
      return `${on.at}@${on.note}for${held === undefined ? 'ever' : held.at - on.at}`
    })
    .sort()
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
    expect(h.audio.clicks).toEqual([])
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
    expect(h.audio.clicks).toHaveLength(expected)
    expect(h.audio.clicks.map((c) => c.at)).toEqual(
      Array.from({ length: expected }, (_, beat) => beat * h.plan.beatMs),
    )
    expect(h.audio.clicks.filter((c) => c.accented).map((c) => c.at)).toEqual([0, 3000, 6000])
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

  it('flashes and sounds every press, including presses made before the run starts', () => {
    const h = harness()
    act(() => h.result.current.hit('snare'))
    expect(h.result.current.flash?.pad).toBe('snare')
    expect(h.audio.playedNotes).toHaveLength(1)

    act(() => h.result.current.hit('snare'))
    // A fresh sequence number, so two strokes on one pad still re-trigger the
    // screen's flash instead of collapsing into one unchanged object.
    expect(h.result.current.flash?.seq).toBe(2)
  })

  it('gives the kick and the hi-hat audibly different pitches on the fallback voice', () => {
    const h = harness()
    act(() => h.result.current.hit('kick'))
    act(() => h.result.current.hit('hhClosed'))
    act(() => h.result.current.hit('snare'))
    const [kick, hat, snare] = h.audio.playedNotes
    expect(kick).toBeLessThan(snare ?? 0)
    expect(snare).toBeLessThan(hat ?? 0)
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
   * A suspended `AudioContext` — which is exactly what a run started by a
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
        throw new Error('AudioContext unavailable')
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
    it('schedules one tone per graded instant, plus a click on every beat, from one origin — and grades nothing', () => {
      const h = harness()
      act(() => h.result.current.preview())
      expect(h.result.current.phase).toBe('preview')

      // `pad.expectedMs` is the grader's OWN array — the instants
      // `gradeGrooveRun` marks against. Asserting the preview against it,
      // rather than against a second derivation of the tick grid, is the
      // point: the demonstration and the marking cannot state different
      // music, because there is only one statement of it.
      const expectedOnsets = h.plan.pads
        .flatMap((pad) => [...pad.expectedMs])
        .sort((a, b) => a - b)
      const actualOnsets = h.audio.calls
        .filter((c) => c.kind === 'noteOn')
        .map((c) => c.at)
        .sort((a, b) => a - b)
      expect(actualOnsets).toEqual(expectedOnsets)

      // The Teacher-seat MAJOR: the staff draws `×2` from `gradedBars`, and
      // the run grades `gradedBars`, so a preview of one bar made the card
      // state the length of the task two different ways. Guard the number,
      // not the formula — a one-bar preview would fail here.
      const beatsPerBar = Math.round(h.plan.barMs / h.plan.beatMs)
      expect(h.plan.gradedBars).toBeGreaterThan(1)
      expect(h.audio.clicks).toHaveLength(beatsPerBar * h.plan.gradedBars)

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
     * The round-2 BLOCKER, in one assertion. `Money Beat (Open Hat)` differs
     * from `Money Beat` by exactly one glyph, and "Listen — the groove as
     * written" is the control a learner presses to settle which reading the
     * chart means. When both grooves scheduled identical audio, the preview
     * said the opposite of what the staff drew, and the only remaining
     * reason to press K was the grader.
     */
    it('gives the open hi-hat its own voice, so the two hi-hat grooves cannot sound identical', () => {
      const previewOf = (score: GrooveScore): string[] => {
        const h = harness(planGrooveRun(score, 80))
        act(() => h.result.current.preview())
        return scheduledVoices(h.audio)
      }
      const closed = previewOf(moneyBeat())
      const open = previewOf(moneyBeatOpenHat())

      expect(open).not.toEqual(closed)

      // Not merely different somewhere: different on the open strokes, and
      // different in BOTH cues. Pitch alone is a weak cue on the fallback
      // triangle voice; length is what "open" means on a real hi-hat.
      const onlyInOpen = open.filter((voice) => !closed.includes(voice))
      expect(onlyInOpen).toHaveLength(2)
      for (const voice of onlyInOpen) {
        expect(voice).not.toMatch(/@88for/)
        expect(voice).toMatch(/for240$/)
      }

      // The rest of the bar is untouched: the one glyph that differs on the
      // staff is the one instant that differs in the ear.
      expect(open.filter((voice) => closed.includes(voice))).toHaveLength(closed.length - 2)
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
      const soundedBefore = h.audio.playedNotes.length

      act(() => h.result.current.hit('kick'))

      expect(h.result.current.flash?.pad).toBe('kick')
      expect(h.audio.playedNotes.length).toBeGreaterThan(soundedBefore)
      expect(h.result.current.result).toBeUndefined()
      expect(h.finished).toEqual([])
    })
  })

  /**
   * A `GrooveRunResult` outlives the run that made it, on purpose — it stays
   * on screen so the learner can read it. That is exactly why it needs an
   * owner: the Skeptic and Regression-Hunter seats both drove a graded run,
   * then switched groove, and read a verdict and a per-pad score standing
   * under a chart they were never about. A marking is a marking OF something.
   */
  describe('result ownership', () => {
    /** Drive a whole run to its verdict, from wherever the clock already is. */
    function gradeARun(h: Harness, plan: GrooveRunPlan = h.plan): void {
      const from = h.clock.now()
      act(() => h.result.current.start())
      frameAt(h, from + plan.barMs + plan.gradedMs)
    }

    it('retires the marking when the groove changes, and when the tempo changes', () => {
      const h = harness()
      gradeARun(h)
      expect(h.result.current.result).toBeDefined()

      // Same groove, new tempo. The marking was never made at this tempo —
      // every window it was graded against was a different width.
      h.swapPlan(planGrooveRun(moneyBeat(), 120))
      expect(h.result.current.result).toBeUndefined()

      // Retired, not destroyed: back on the plan it was graded under, it is
      // still the reading of that run.
      h.swapPlan(h.plan)
      expect(h.result.current.result).toBeDefined()

      // Different groove at the same tempo. Money Beat (Open Hat) has a pad
      // Money Beat does not, so the frozen panel would have scored 3 pads
      // beside a staff whose whole point is the 4th.
      h.swapPlan(planGrooveRun(moneyBeatOpenHat(), 80))
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
      expect(graded?.pads.map((pad) => pad.pad)).toContain('hhOpen')
    })
  })
})
