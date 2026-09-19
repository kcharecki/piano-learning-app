/**
 * `useRudimentTrainer` — the ladder/persistence wiring, not the grading rules
 * themselves (those are `@core/drums/rudiment/tempoLadder.ts`'s own tests).
 * What is pinned here: a clean pass advances the ladder and the trainer's own
 * plan follows the new tempo, a failed pass drops it, a personal best lands
 * in `useDrumsRudimentStore`, and changing rudiments resets the ladder.
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { KEYBOARD_ACCENT_VELOCITY, KEYBOARD_NORMAL_VELOCITY } from '@app/drums/groove/groovePadHooks.ts'
import { useDrumsRudimentStore } from '@app/state/drumsRudimentStore.ts'
import { FakeClock } from '@test/fakes.ts'
import { rudimentById } from '@content/drums/rudiments.ts'
import type { DynamicsClass } from '@core/drums/model/groove.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import type { Rudiment } from '@core/drums/rudiment/index.ts'
import { RUDIMENT_CLEAN_EVENNESS, rudimentEvenness } from '@core/drums/rudiment/index.ts'
import type { Clock, DrumAudioOutput } from '@core/ports/index.ts'
import type { Millis } from '@core/shared/units.ts'
import { accentLine } from './rudimentRun.ts'
import { useRudimentTrainer, type UseRudimentTrainerOptions } from './useRudimentTrainer.ts'

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

/** A silent stand-in for the real drum audio port — see `useGrooveRun.test.ts`'s own copy of this idea. */
class SilentDrumAudio implements DrumAudioOutput {
  private readonly clock: Clock
  constructor(clock: Clock) {
    this.clock = clock
  }
  strike(): void {
    // Not exercised here.
  }
  click(): void {
    // Not exercised here.
  }
  allNotesOff(): void {
    // Not exercised here.
  }
  setVolume(): void {
    // Not exercised here.
  }
  now(): Millis {
    return this.clock.now() as Millis
  }
}

function singleStrokeRoll(): Rudiment {
  const rudiment = rudimentById('single-stroke-roll')
  if (rudiment === undefined) throw new Error('fixture missing: single-stroke-roll')
  return rudiment
}

function singleParadiddle(): Rudiment {
  const rudiment = rudimentById('single-paradiddle')
  if (rudiment === undefined) throw new Error('fixture missing: single-paradiddle')
  return rudiment
}

function harness(rudiment: Rudiment) {
  const clock = new FakeClock()
  const audio = new SilentDrumAudio(clock)
  const manual = manualDriver()
  let stamp = 1_700_000_000_000
  const nowStamp = (): number => {
    stamp += 1
    return stamp
  }
  const optionsFor = (props: { rudiment: Rudiment }): UseRudimentTrainerOptions => ({
    rudiment: props.rudiment,
    clock,
    audio: () => audio,
    driver: manual.driver,
    now: nowStamp,
  })
  const view = renderHook(
    (props: { rudiment: Rudiment }) => useRudimentTrainer(optionsFor(props)),
    {
      initialProps: { rudiment },
    },
  )
  return { clock, pump: manual.pump, view, nowStamp }
}

type Harness = ReturnType<typeof harness>

/** Move the clock to `ms` and run one frame there. */
function frameAt(h: Harness, ms: number): void {
  act(() => {
    h.clock.setTime(ms)
    h.pump()
  })
}

/**
 * Drives one full graded run. `clean` hits every expected snare instant
 * exactly on time (a rudiment's whole pattern is on `snare` — see
 * `rudimentToScore`); a failed run plays nothing at all, which the grader
 * marks every instant missed and `totalHits === 0`, so `steady` is false.
 */
function driveRun(h: Harness, clean: boolean): void {
  const startedAt = h.clock.now()
  act(() => h.view.result.current.run.start())
  const plan = h.view.result.current.plan
  const gradedOrigin = startedAt + plan.countInBars * plan.barMs
  frameAt(h, gradedOrigin)

  if (clean) {
    for (const padPlan of plan.pads) {
      for (const ms of padPlan.expectedMs) {
        act(() => {
          h.clock.setTime(gradedOrigin + ms)
          h.view.result.current.tap()
        })
      }
    }
  }

  frameAt(h, gradedOrigin + plan.gradedMs)
}

/**
 * Drives one full graded run, tapping every expected snare instant exactly
 * on time with a velocity chosen by `velocityFor` off that instant's OWN
 * notated dynamics class (DR-10 accents) — `undefined` reproduces an
 * on-screen pad press (unclassified), a fixed number reproduces a keyboard
 * or e-kit stroke. `expectedMs`/`expectedDynamics` are index-for-index on
 * the same `GroovePadPlan` (see `plan.ts`'s own doc on `expectedNominalMs`),
 * so `velocityFor` reads the class this run's own plan notated at each
 * instant rather than a guessed position.
 */
function driveRunWithVelocities(
  h: Harness,
  velocityFor: (dynamicsClass: DynamicsClass) => number | undefined,
): void {
  const startedAt = h.clock.now()
  act(() => h.view.result.current.run.start())
  const plan = h.view.result.current.plan
  const gradedOrigin = startedAt + plan.countInBars * plan.barMs
  frameAt(h, gradedOrigin)

  for (const padPlan of plan.pads) {
    padPlan.expectedMs.forEach((ms, index) => {
      const dynamicsClass = padPlan.expectedDynamics[index] ?? 'normal'
      const velocity = velocityFor(dynamicsClass)
      act(() => {
        h.clock.setTime(gradedOrigin + ms)
        h.view.result.current.tap(velocity)
      })
    })
  }

  frameAt(h, gradedOrigin + plan.gradedMs)
}

/**
 * Drives one full graded run like `driveRunWithVelocities`, except every
 * instant notated 'accent' is never tapped AT ALL — not even an unclassified
 * on-screen press — so it lands as a genuinely missed accent (RED-B's own
 * round-3 scenario: an over-accented run where nothing about the accents was
 * even attempted). Every other instant is tapped on time at `plainVelocity`.
 */
function driveRunSkippingAccents(h: Harness, plainVelocity: number): void {
  const startedAt = h.clock.now()
  act(() => h.view.result.current.run.start())
  const plan = h.view.result.current.plan
  const gradedOrigin = startedAt + plan.countInBars * plan.barMs
  frameAt(h, gradedOrigin)

  for (const padPlan of plan.pads) {
    padPlan.expectedMs.forEach((ms, index) => {
      const dynamicsClass = padPlan.expectedDynamics[index] ?? 'normal'
      if (dynamicsClass === 'accent') return
      act(() => {
        h.clock.setTime(gradedOrigin + ms)
        h.view.result.current.tap(plainVelocity)
      })
    })
  }

  frameAt(h, gradedOrigin + plan.gradedMs)
}

/** Total 'accent' instants the CURRENT view's own plan notates on the snare row — computed from the live plan, never typed by hand. */
function notatedAccents(h: Harness): number {
  return h.view.result.current.plan.pads.reduce(
    (sum, padPlan) => sum + padPlan.expectedDynamics.filter((dynamicsClass) => dynamicsClass === 'accent').length,
    0,
  )
}

/** Total 'normal' instants the CURRENT view's own plan notates on the snare row — same reasoning as `notatedAccents`. */
function notatedNormals(h: Harness): number {
  return h.view.result.current.plan.pads.reduce(
    (sum, padPlan) => sum + padPlan.expectedDynamics.filter((dynamicsClass) => dynamicsClass === 'normal').length,
    0,
  )
}

/**
 * Drives one full graded run identically to `driveRun(h, true)`, except the
 * stroke at `shiftIndex` (into the flattened, time-ordered list of expected
 * instants — single-stroke-roll is one pad, so this is just its own
 * `expectedMs`) lands `shiftMs` late. Picked deliberately NOT at either end
 * of the run, so the shift disturbs two adjacent gaps rather than one — see
 * the evenness tests below for the arithmetic this is built to produce.
 */
function driveRunOneStrokeLate(h: Harness, shiftIndex: number, shiftMs: number): void {
  const startedAt = h.clock.now()
  act(() => h.view.result.current.run.start())
  const plan = h.view.result.current.plan
  const gradedOrigin = startedAt + plan.countInBars * plan.barMs
  frameAt(h, gradedOrigin)

  for (const padPlan of plan.pads) {
    padPlan.expectedMs.forEach((ms, i) => {
      const lateBy = i === shiftIndex ? shiftMs : 0
      act(() => {
        h.clock.setTime(gradedOrigin + ms + lateBy)
        h.view.result.current.tap()
      })
    })
  }

  frameAt(h, gradedOrigin + plan.gradedMs)
}

beforeEach(() => {
  useDrumsRudimentStore.setState({ records: {} })
})

describe('useRudimentTrainer', () => {
  it('starts the ladder at the rudiment’s own bpmBand.start', () => {
    const h = harness(singleStrokeRoll())
    expect(h.view.result.current.ladder.bpm).toBe(60)
    expect(h.view.result.current.plan.bpm).toBe(60)
  })

  it('advances the ladder — and the trainer’s own plan — after passesToAdvance clean runs, and records the personal best', () => {
    const h = harness(singleStrokeRoll())

    driveRun(h, true)
    expect(h.view.result.current.lastClean).toBe(true)
    expect(h.view.result.current.lastEvenness).toBeCloseTo(1, 9)
    expect(h.view.result.current.ladder.cleanStreak).toBe(1)
    // Still building the streak — the default passesToAdvance is 2 (tempoLadder.ts).
    expect(h.view.result.current.ladder.bpm).toBe(60)
    expect(h.view.result.current.plan.bpm).toBe(60)

    driveRun(h, true)
    expect(h.view.result.current.lastClean).toBe(true)
    // The streak just completed: bpm steps up by the default 5.
    expect(h.view.result.current.ladder.bpm).toBe(65)
    expect(h.view.result.current.plan.bpm).toBe(65)

    const record = useDrumsRudimentStore.getState().records['single-stroke-roll']
    expect(record?.bestCleanBpm).toBe(60)
  })

  it('drops the ladder by stepBpm on a failed run, without touching bestCleanBpm', () => {
    const h = harness(singleStrokeRoll())
    driveRun(h, true)
    driveRun(h, true)
    expect(h.view.result.current.ladder.bpm).toBe(65)

    driveRun(h, false)
    expect(h.view.result.current.lastClean).toBe(false)
    expect(h.view.result.current.ladder.failStreak).toBe(1)
    expect(h.view.result.current.ladder.bpm).toBe(60)

    // The failed run's verdict is still readable after the tempo stepped
    // down: the plan's grooveId does not carry the bpm (see the hook's module
    // comment), so `useGrooveRun` keeps the result, labelled with the bpm it
    // was graded at. A silent run has no evenness evidence, so no score.
    expect(h.view.result.current.run.result?.bpm).toBe(65)
    expect(h.view.result.current.run.result?.result.steady).toBe(false)
    expect(h.view.result.current.lastEvenness).toBeUndefined()

    // The best clean pass is still on record — a later failure never erases it.
    expect(useDrumsRudimentStore.getState().records['single-stroke-roll']?.bestCleanBpm).toBe(60)
  })

  it('resets the ladder when the rudiment changes, even mid-progress', () => {
    const h = harness(singleStrokeRoll())
    driveRun(h, true)
    driveRun(h, true)
    expect(h.view.result.current.ladder.bpm).toBe(65)

    act(() => h.view.rerender({ rudiment: singleParadiddle() }))

    // single-paradiddle shares single-stroke-roll's tier-1 band (start 60).
    expect(h.view.result.current.ladder.bpm).toBe(60)
    expect(h.view.result.current.ladder.history).toEqual([])
    expect(h.view.result.current.ladder.bestCleanBpm).toBeUndefined()
    expect(h.view.result.current.lastClean).toBeUndefined()
    expect(h.view.result.current.plan.grooveId).toContain('single-paradiddle')
  })

  it('restart() puts the ladder back to the start, without touching the stored best', () => {
    const h = harness(singleStrokeRoll())
    driveRun(h, true)
    driveRun(h, true)
    expect(h.view.result.current.ladder.bpm).toBe(65)

    act(() => h.view.result.current.restart())

    expect(h.view.result.current.ladder.bpm).toBe(60)
    expect(h.view.result.current.ladder.history).toEqual([])
    expect(h.view.result.current.lastEvenness).toBeUndefined()
    expect(useDrumsRudimentStore.getState().records['single-stroke-roll']?.bestCleanBpm).toBe(60)
  })

  it('names the score with the sticking-bearing pad the honesty line cares about', () => {
    const h = harness(singleStrokeRoll())
    const pads = new Set(
      h.view.result.current.score.notes.map((note: { pad: MappedDrumPad }) => note.pad),
    )
    expect(pads).toEqual(new Set(['snare']))
  })
})

describe('useRudimentTrainer — evenness (roadmap DR-10)', () => {
  it('scores lastEvenness from the taps recorded during the graded window', () => {
    const h = harness(singleStrokeRoll())
    driveRun(h, true)
    expect(h.view.result.current.lastEvenness).toBeCloseTo(1, 9)
    expect(h.view.result.current.lastClean).toBe(true)
  })

  it('fails the pass on unevenness alone, even when the engine’s own timing verdict stays steady', () => {
    const h = harness(singleStrokeRoll())
    const shiftIndex = 8
    const shiftMs = 80

    // single-stroke-roll at its bpmBand.start (60) is straight sixteenths,
    // 250ms apart. One stroke 80ms late (index 8 — neither end of the run)
    // moves that pad's own spread to roughly 19ms SD, comfortably inside the
    // engine's own ±40ms-SD steady budget (`STEADY_SPREAD_FRACTION` in
    // `@core/drums/practice/grade.ts`). It still breaks two adjacent 250ms
    // gaps to 330ms/170ms, which is well past the evenness axis's own bar
    // (see `evenness.test.ts`'s worked example at the same ~125ms scale) —
    // proving the two axes are independently enforced, not that one implies
    // the other.
    driveRunOneStrokeLate(h, shiftIndex, shiftMs)
    expect(h.view.result.current.run.result?.result.steady).toBe(true)
    expect(h.view.result.current.lastEvenness).toBeLessThan(RUDIMENT_CLEAN_EVENNESS)
    expect(h.view.result.current.lastClean).toBe(false)
  })

  it('ignores taps played during the count-in', () => {
    const h = harness(singleStrokeRoll())
    const startedAt = h.clock.now()
    act(() => h.view.result.current.run.start())

    // A tap while still in the count-in — must not survive into the record.
    act(() => h.view.result.current.tap())

    const plan = h.view.result.current.plan
    const gradedOrigin = startedAt + plan.countInBars * plan.barMs
    frameAt(h, gradedOrigin)

    for (const padPlan of plan.pads) {
      for (const ms of padPlan.expectedMs) {
        act(() => {
          h.clock.setTime(gradedOrigin + ms)
          h.view.result.current.tap()
        })
      }
    }
    frameAt(h, gradedOrigin + plan.gradedMs)

    // Had the count-in tap counted, it would sit far before the pattern's own
    // first onset and wreck the score; instead the run reads perfectly even.
    expect(h.view.result.current.lastEvenness).toBeCloseTo(1, 9)
    expect(h.view.result.current.lastClean).toBe(true)
  })

  it('an early first stroke inside the window counts, as the grader already counts it', () => {
    // `useGrooveRun.hit()` opens its acceptance window at
    // `gradedOrigin - windowMs`, not at `gradedOrigin` itself (see that
    // hook's own module comment) — a stroke landing anywhere in that window
    // is graded, so the evenness record must agree: if the score counts it,
    // evenness counts it. The old phase guard excluded anything before
    // 'playing', which this same stroke would have hit.
    const h = harness(singleStrokeRoll())
    const startedAt = h.clock.now()
    act(() => h.view.result.current.run.start())
    const plan = h.view.result.current.plan
    const gradedOrigin = startedAt + plan.countInBars * plan.barMs
    const padPlan = plan.pads[0]
    if (padPlan === undefined) throw new Error('fixture missing: single-stroke-roll has no pads')
    const expectedMs = padPlan.expectedMs
    const firstMs = expectedMs[0]
    if (firstMs === undefined) throw new Error('fixture missing: single-stroke-roll has no notes')

    const earlyTapAt = gradedOrigin - plan.windowMs + 1

    // Still genuinely mid count-in — no frame has been pumped yet, so the
    // engine's own phase (and any mirror of it) reads 'count-in'. Acceptance
    // here rests entirely on `timingRef` and the clock, never on phase.
    act(() => {
      h.clock.setTime(earlyTapAt)
      h.view.result.current.tap()
    })

    for (const ms of expectedMs.slice(1)) {
      act(() => {
        h.clock.setTime(gradedOrigin + ms)
        h.view.result.current.tap()
      })
    }
    frameAt(h, gradedOrigin + plan.gradedMs)

    const playedWithEarly = [earlyTapAt, ...expectedMs.slice(1).map((ms) => gradedOrigin + ms)]
    const playedWithoutEarly = playedWithEarly.slice(1)
    const withEarly = rudimentEvenness(playedWithEarly)
    const withoutEarly = rudimentEvenness(playedWithoutEarly)
    // Proves the two arrays actually read differently to the evenness
    // function — otherwise this test would pass no matter which one the
    // hook recorded, and would prove nothing (same guard as THE RACE below).
    expect(withEarly).not.toBeCloseTo(withoutEarly, 6)

    expect(h.view.result.current.lastEvenness).toBeCloseTo(withEarly, 9)
  })

  it('THE RACE: a tap in the very first frame of the graded window is graded, not dropped (DR-10)', () => {
    // Regression for the phaseRef-mirror bug: the mirror is written during
    // render, and a `setState` made from OUTSIDE a React event (the manual
    // driver's `pump()`, standing in for a real animation frame) does not
    // commit until this `act()` call returns. A tap dispatched inside the
    // SAME act as the pump that flips the engine to 'playing' would therefore
    // still read the mirror as 'count-in' and be silently dropped by the old
    // code. Acceptance is decided by `timingRef` and the clock, never by
    // phase — `useGrooveRun` mutates its own refs synchronously inside
    // `onFrame`, so `hit()` is genuinely open the instant `onFrame` runs. The
    // pump here is what makes that true within this act; it is not standing
    // in for a render. This test fails against the phaseRef mirror for
    // exactly that reason.
    const h = harness(singleStrokeRoll())
    const startedAt = h.clock.now()
    act(() => h.view.result.current.run.start())
    const plan = h.view.result.current.plan
    const gradedOrigin = startedAt + plan.countInBars * plan.barMs
    const padPlan = plan.pads[0]
    if (padPlan === undefined) throw new Error('fixture missing: single-stroke-roll has no pads')
    const expectedMs = padPlan.expectedMs
    const firstMs = expectedMs[0]
    if (firstMs === undefined) throw new Error('fixture missing: single-stroke-roll has no notes')

    // All strokes are played exactly on their own notated instant EXCEPT the
    // first-frame one, which lands `lateBy` after it — the one deliberate
    // irregularity that makes whether it is recorded at all a fact
    // `rudimentEvenness` can actually detect (dropping it from an otherwise
    // perfectly even run restores perfect evenness; keeping it does not).
    const lateBy = 80

    // The first stroke, in the SAME act() as the frame pump that flips the
    // engine from 'count-in' to 'playing' — the race.
    act(() => {
      h.clock.setTime(gradedOrigin + firstMs + lateBy)
      h.pump()
      h.view.result.current.tap()
    })

    for (const ms of expectedMs.slice(1)) {
      act(() => {
        h.clock.setTime(gradedOrigin + ms)
        h.view.result.current.tap()
      })
    }
    frameAt(h, gradedOrigin + plan.gradedMs)

    const playedWithFirst = [
      gradedOrigin + firstMs + lateBy,
      ...expectedMs.slice(1).map((ms) => gradedOrigin + ms),
    ]
    const playedWithoutFirst = playedWithFirst.slice(1)

    const withFirstTap = rudimentEvenness(playedWithFirst)
    const withoutFirstTap = rudimentEvenness(playedWithoutFirst)
    // Proves the two arrays actually read differently to the evenness
    // function — otherwise this test would pass no matter which one the
    // hook recorded, and would prove nothing.
    expect(withFirstTap).not.toBeCloseTo(withoutFirstTap, 6)

    expect(h.view.result.current.lastEvenness).toBeCloseTo(withFirstTap, 9)
  })

  it('resets the stroke record between runs', () => {
    const h = harness(singleStrokeRoll())
    driveRunOneStrokeLate(h, 8, 80)
    expect(h.view.result.current.lastEvenness).toBeLessThan(RUDIMENT_CLEAN_EVENNESS)

    driveRun(h, true)
    // A clean run right after an uneven one reads as perfectly even — the
    // previous run's taps did not leak into this one's record.
    expect(h.view.result.current.lastEvenness).toBeCloseTo(1, 9)
    expect(h.view.result.current.lastClean).toBe(true)
  })

  it('a restart through run.start clears a stray tap left over from an abandoned run', () => {
    // This is the scenario `wrappedStart` exists for: a tap can now land
    // inside the acceptance window before `gradedOrigin` (DR-10), so a tap
    // taken during one run's count-in and never followed through survives in
    // `tapsRef` until something clears it. It must be cleared by the act of
    // starting the NEXT run, not by a phase-edge effect one render behind.
    const h = harness(singleStrokeRoll())
    const startedAt1 = h.clock.now()
    act(() => h.view.result.current.run.start())
    const plan1 = h.view.result.current.plan
    const gradedOrigin1 = startedAt1 + plan1.countInBars * plan1.barMs

    // A stray tap, inside the first run's own acceptance window, while
    // genuinely still mid count-in — the run is abandoned right after.
    const strayTapAt = gradedOrigin1 - plan1.windowMs + 1
    act(() => {
      h.clock.setTime(strayTapAt)
      h.view.result.current.tap()
    })

    // Restart — through `run.start`, the only entry point the screen calls.
    const startedAt2 = h.clock.now()
    act(() => h.view.result.current.run.start())
    const plan2 = h.view.result.current.plan
    const gradedOrigin2 = startedAt2 + plan2.countInBars * plan2.barMs
    frameAt(h, gradedOrigin2)

    for (const padPlan of plan2.pads) {
      for (const ms of padPlan.expectedMs) {
        act(() => {
          h.clock.setTime(gradedOrigin2 + ms)
          h.view.result.current.tap()
        })
      }
    }
    frameAt(h, gradedOrigin2 + plan2.gradedMs)

    // The second run's own taps, exactly on their own notated instants — if
    // the stray tap survived, this would not match what the hook actually
    // scored.
    const secondRunTaps = plan2.pads.flatMap((padPlan) =>
      padPlan.expectedMs.map((ms) => gradedOrigin2 + ms),
    )
    expect(h.view.result.current.lastEvenness).toBeCloseTo(rudimentEvenness(secondRunTaps), 9)
    expect(h.view.result.current.lastClean).toBe(true)
  })
})

describe('useRudimentTrainer — accents (roadmap DR-10)', () => {
  it('grades a fully-accented run clean when every stroke lands at its notated velocity', () => {
    const h = harness(singleParadiddle())
    const notated = notatedAccents(h)
    // Single paradiddle is a bundled fixture that DOES notate accents — this
    // guards the assumption the rest of the test leans on, rather than
    // hardcoding the count.
    expect(notated).toBeGreaterThan(0)

    driveRunWithVelocities(h, (dynamicsClass) =>
      dynamicsClass === 'accent' ? KEYBOARD_ACCENT_VELOCITY : KEYBOARD_NORMAL_VELOCITY,
    )

    expect(h.view.result.current.lastClean).toBe(true)
    expect(h.view.result.current.lastAccents).toEqual({
      notated,
      graded: notated,
      unclassified: 0,
      missedAccents: 0,
      // Every plain stroke was played at KEYBOARD_NORMAL_VELOCITY (not
      // accent-class), so every normal instant is counted but none over-accented.
      normalInstants: notatedNormals(h),
      loudNormals: 0,
    })
  })

  it('fails a clean pass when an accented rudiment is played at uniform (normal) velocity', () => {
    const h = harness(singleParadiddle())
    const notated = notatedAccents(h)
    expect(notated).toBeGreaterThan(0)

    driveRunWithVelocities(h, () => KEYBOARD_NORMAL_VELOCITY)

    expect(h.view.result.current.lastClean).toBe(false)
    expect(h.view.result.current.lastAccents).toEqual({
      notated,
      graded: notated,
      unclassified: 0,
      missedAccents: notated,
      // Every plain stroke also played at KEYBOARD_NORMAL_VELOCITY — counted, never over-accented.
      normalInstants: notatedNormals(h),
      loudNormals: 0,
    })
  })

  it('leaves the clean verdict on timing/evenness alone when every stroke is unclassified (no velocity)', () => {
    const h = harness(singleParadiddle())
    const notated = notatedAccents(h)
    expect(notated).toBeGreaterThan(0)

    driveRunWithVelocities(h, () => undefined)

    // Same verdict a plain `driveRun(h, true)` would have produced before
    // this slice: an unclassified stroke never blocks a clean pass (see
    // `isCleanPass`'s own doc in rudimentRun.ts).
    expect(h.view.result.current.lastClean).toBe(true)
    expect(h.view.result.current.lastAccents).toEqual({
      notated,
      graded: 0,
      unclassified: notated,
      missedAccents: 0,
      // No velocity at all on ANY stroke — a normal instant with no velocity
      // is excluded from normalInstants too (dynamics.ts's own doc).
      normalInstants: 0,
      loudNormals: 0,
    })
  })

  /**
   * RED-1 (over-accenting): the reviewer's exact scenario — Shift held on
   * EVERY stroke, not just the notated accents. Every accent instant still
   * lands correctly (110 classifies 'accent', same as the notated class), so
   * `missedAccents` stays 0 — but every PLAIN stroke also comes out loud,
   * which must fail the pass even though nothing was graded wrong.
   */
  it('over-accenting: tapping every stroke (accent AND plain) at an accent velocity fails the pass, with every plain stroke counted as over-accented and no accent missed', () => {
    const h = harness(singleParadiddle())
    const notated = notatedAccents(h)
    expect(notated).toBeGreaterThan(0)

    driveRunWithVelocities(h, () => KEYBOARD_ACCENT_VELOCITY)

    const accents = h.view.result.current.lastAccents
    expect(accents).toBeDefined()
    if (accents === undefined) throw new Error('expected lastAccents to be defined')
    expect(accents.normalInstants).toBeGreaterThan(0)
    expect(accents.loudNormals).toBe(accents.normalInstants)
    expect(accents.missedAccents).toBe(0)
    expect(h.view.result.current.lastClean).toBe(false)
  })

  it('resets lastAccents on restart() and when the rudiment changes', () => {
    const h = harness(singleParadiddle())
    const velocityFor = (dynamicsClass: DynamicsClass): number | undefined =>
      dynamicsClass === 'accent' ? KEYBOARD_ACCENT_VELOCITY : KEYBOARD_NORMAL_VELOCITY

    driveRunWithVelocities(h, velocityFor)
    expect(h.view.result.current.lastAccents).toBeDefined()

    act(() => h.view.result.current.restart())
    expect(h.view.result.current.lastAccents).toBeUndefined()

    driveRunWithVelocities(h, velocityFor)
    expect(h.view.result.current.lastAccents).toBeDefined()

    act(() => h.view.rerender({ rudiment: singleStrokeRoll() }))
    expect(h.view.result.current.lastAccents).toBeUndefined()
  })

  /**
   * RED-A (round 3): Single Stroke Roll is the reviewer's own example of an
   * unaccented rudiment — notates zero 'accent' instants, so the round-2
   * over-accenting gate must not apply to it at all. Every stroke played
   * loud used to read "Not clean" for no real mistake; it must now pass, and
   * with nothing notated there is nothing for the accent line to say either.
   */
  it('RED-A: an unaccented rudiment (Single Stroke Roll) played with Shift on every stroke passes clean, notates 0 accents, and shows no accent line', () => {
    const h = harness(singleStrokeRoll())
    const notated = notatedAccents(h)
    expect(notated).toBe(0) // guard: the reviewer's own "default rudiment, no accents" case

    driveRunWithVelocities(h, () => KEYBOARD_ACCENT_VELOCITY)

    const accents = h.view.result.current.lastAccents
    expect(accents).toBeDefined()
    if (accents === undefined) throw new Error('expected lastAccents to be defined')
    expect(accents.notated).toBe(0)
    expect(accents.loudNormals).toBeGreaterThan(0) // guard: this run really did over-accent every stroke
    expect(accentLine(accents)).toBeUndefined()
    expect(h.view.result.current.lastClean).toBe(true)
  })

  /**
   * RED-B (round 3): with every accent instant skipped entirely (never
   * tapped, not even unclassified) and every plain stroke played loud, the
   * round-2 `graded === 0` early return in `accentLine` would have hidden
   * the over-accenting behind either `undefined` or the bare not-graded
   * literal. This is `accentLine` regime R18's own numbers, reproduced here
   * by really driving the run rather than a hand-built fixture — confirms
   * the fix reaches the trainer, not just the pure helper's own unit tests.
   */
  it('RED-B: single paradiddle with every accent instant skipped and every plain stroke played loud fails the pass and reports the over-accenting (regime R18)', () => {
    const h = harness(singleParadiddle())
    const notated = notatedAccents(h)
    const normals = notatedNormals(h)
    expect(notated).toBeGreaterThan(0)
    expect(normals).toBeGreaterThan(0)

    driveRunSkippingAccents(h, KEYBOARD_ACCENT_VELOCITY)

    expect(h.view.result.current.lastClean).toBe(false)
    const accents = h.view.result.current.lastAccents
    expect(accents).toBeDefined()
    if (accents === undefined) throw new Error('expected lastAccents to be defined')
    expect(accents).toEqual({
      notated,
      graded: 0,
      unclassified: 0,
      missedAccents: 0,
      normalInstants: normals,
      loudNormals: normals,
    })
    // Single paradiddle's own bundled content happens to match R18's fixture
    // numbers exactly (8 notated accents, 24 notated plain strokes) — guarded
    // above rather than assumed, so this literal stays honest if the content
    // ever changes.
    expect(notated).toBe(8)
    expect(normals).toBe(24)
    expect(accentLine(accents)).toBe('Every plain stroke you hit came out as an accent. Keep them soft. 8 accents were missed.')
  })
})
