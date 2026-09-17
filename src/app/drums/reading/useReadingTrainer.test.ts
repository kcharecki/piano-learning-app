/**
 * `useReadingTrainer` — the wiring `useGrooveRun` runs under (its own timing
 * contract is pinned in `useGrooveRun.test.ts`), plus the two things unique
 * to this hook: the generator actually produces a one-voice, snare-only
 * exercise, and the level only ever moves the drawn staff at `next()`, never
 * mid-run.
 */
import { act, renderHook } from '@testing-library/react'
import { FakeClock } from '@test/fakes.ts'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useDrumsReadingStore } from '@app/state/drumsReadingStore.ts'
import { describeReadingLevel } from '@core/drums/reading/index.ts'
import type { Clock, DrumAudioOutput } from '@core/ports/index.ts'
import type { Millis } from '@core/shared/units.ts'
import { useReadingTrainer, type UseReadingTrainerOptions } from './useReadingTrainer.ts'

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

/** Never asserted on directly here — exists only so a strike or click has somewhere to go. */
function fakeAudio(clock: Clock): DrumAudioOutput {
  return {
    strike: () => {},
    click: () => {},
    allNotesOff: () => {},
    setVolume: () => {},
    now: (): Millis => clock.now(),
  }
}

function harness(options: Omit<UseReadingTrainerOptions, 'clock' | 'audio' | 'driver'> = {}) {
  const clock = new FakeClock()
  const audio = fakeAudio(clock)
  const manual = manualDriver()
  const view = renderHook(() =>
    useReadingTrainer({ ...options, clock, audio: () => audio, driver: manual.driver }),
  )
  return { clock, pump: manual.pump, result: view.result }
}

/** Move the clock to `ms` and run one frame there. */
function frameAt(h: ReturnType<typeof harness>, ms: number): void {
  act(() => {
    h.clock.setTime(ms)
    h.pump()
  })
}

/**
 * Starts a run and taps every one of the current plan's expected instants
 * dead on time, then lets it grade. Level-1 seed 1 (used throughout this
 * file) puts every onset on `'snare'` with a 100 ms window, so tapping at
 * the exact instant always matches.
 */
function playPerfectRun(h: ReturnType<typeof harness>): void {
  const startedAt = h.clock.now()
  act(() => h.result.current.run.start())
  const plan = h.result.current.plan
  const gradedOrigin = startedAt + plan.countInBars * plan.barMs
  const snareRow = plan.pads.find((row) => row.pad === 'snare')
  for (const ms of snareRow?.expectedMs ?? []) {
    act(() => {
      h.clock.setTime(gradedOrigin + ms)
      h.result.current.tap()
    })
  }
  frameAt(h, gradedOrigin + plan.gradedMs)
}

/** Starts a run and lets it grade without a single tap — every onset missed, well under the adapt band's low end. */
function playMissedRun(h: ReturnType<typeof harness>): void {
  const startedAt = h.clock.now()
  act(() => h.result.current.run.start())
  const plan = h.result.current.plan
  const gradedOrigin = startedAt + plan.countInBars * plan.barMs
  frameAt(h, gradedOrigin + plan.gradedMs)
}

beforeEach(() => {
  useDrumsReadingStore.setState({ level: 1, runs: [] })
})

describe('useReadingTrainer', () => {
  it('draws a level-1 exercise as quarter notes only, on a single snare row', () => {
    const h = harness({ initialSeed: 1 })
    const { score, plan } = h.result.current

    expect(score.notes.length).toBeGreaterThan(0)
    for (const note of score.notes) {
      expect(note.tick % 480).toBe(0)
    }

    expect(plan.pads).toHaveLength(1)
    expect(plan.pads[0]?.pad).toBe('snare')
  })

  it('reports the level in words, matching the level the current exercise was drawn at', () => {
    const h = harness({ initialSeed: 1 })
    expect(h.result.current.level).toBe(1)
    expect(h.result.current.levelText).toBe('Quarters: one note or one silence per beat.')
  })

  it('grades pad-agnostically: tap() always reports the one voice every exercise is graded on', () => {
    const h = harness({ initialSeed: 1 })
    act(() => h.result.current.run.start())
    act(() => h.result.current.tap())
    expect(h.result.current.run.flash?.pad).toBe('snare')
  })

  it('a perfect run scores full accuracy and is recorded to the store', () => {
    const h = harness({ initialSeed: 1 })
    playPerfectRun(h)

    expect(h.result.current.run.result).toBeDefined()
    expect(h.result.current.lastAccuracy).toBe(1)
    expect(useDrumsReadingStore.getState().runs).toHaveLength(1)
    expect(useDrumsReadingStore.getState().runs[0]).toEqual({ level: 1, accuracy: 1 })
  })

  it('adapts the level after three agreeing runs, but leaves the staff on screen unchanged until next()', () => {
    const h = harness({ initialSeed: 1 })
    const scoreIdBefore = h.result.current.score.id

    playPerfectRun(h)
    expect(h.result.current.levelChanged).toBeUndefined()
    expect(useDrumsReadingStore.getState().level).toBe(1)

    playPerfectRun(h)
    expect(h.result.current.levelChanged).toBeUndefined()
    expect(useDrumsReadingStore.getState().level).toBe(1)

    playPerfectRun(h)
    expect(h.result.current.levelChanged).toBe('up')
    expect(useDrumsReadingStore.getState().level).toBe(2)

    // The level the trainer reports and the score it is showing must not have
    // moved — only the STORE's level did, ready for `next()` to pick up.
    expect(h.result.current.level).toBe(1)
    expect(h.result.current.score.id).toBe(scoreIdBefore)
  })

  it('next() draws a new exercise, at whatever level the store now holds, and clears the old result', () => {
    const h = harness({ initialSeed: 1 })
    playPerfectRun(h)
    playPerfectRun(h)
    playPerfectRun(h)
    expect(useDrumsReadingStore.getState().level).toBe(2)
    const idBeforeNext = h.result.current.score.id

    act(() => h.result.current.next())

    expect(h.result.current.score.id).not.toBe(idBeforeNext)
    expect(h.result.current.level).toBe(2)
    expect(h.result.current.run.result).toBeUndefined()
    expect(h.result.current.levelChanged).toBeUndefined()
  })

  it('clamps a requested tempo to the trainer’s bpm range', () => {
    const h = harness({ initialSeed: 1 })
    act(() => h.result.current.setBpm(9999))
    expect(h.result.current.bpm).toBeLessThanOrEqual(200)
    act(() => h.result.current.setBpm(-50))
    expect(h.result.current.bpm).toBeGreaterThanOrEqual(40)
  })

  /**
   * Roadmap DR-11 review, MAJOR 1: `App.tsx` restores a persisted reading
   * level in an effect that runs after this hook has already mounted (and
   * already drawn a level-1 exercise from `activeLevel`'s initial state), so
   * a later-arriving store level must still reach `activeLevel` — but only
   * until the learner actually commits to the exercise on screen by starting
   * it.
   */
  it('re-syncs the level to a store level that arrives after mount, but stops following it once a run starts', () => {
    const h = harness({ initialSeed: 1 })
    expect(h.result.current.level).toBe(1)

    act(() => useDrumsReadingStore.getState().setLevel(4))
    expect(h.result.current.level).toBe(4)
    // The exercise itself, not just the number, followed the late-arriving
    // store level — `levelText` and `score` both derive from `activeLevel`.
    expect(h.result.current.levelText).toBe(describeReadingLevel(4))
    for (const note of h.result.current.score.notes) {
      expect(note.pad).toBe('snare')
    }

    act(() => h.result.current.run.start())
    act(() => useDrumsReadingStore.getState().setLevel(6))
    expect(h.result.current.level).toBe(4)
  })

  /**
   * Roadmap DR-11 review, MAJOR 2: a plain "last 3 runs at this level" read
   * ping-pongs, because a demotion back to a level the learner already
   * cleared could otherwise see that old clearing run again and immediately
   * promote back off it. The realistic version of this: promote 1→2, play
   * enough at level 2 to demote back to 1, then prove the level-1 runs from
   * BEFORE the promotion cannot be reused — they are separated from any new
   * level-1 run by the level-2 runs recorded in between, which is exactly
   * what ends a CONTIGUOUS streak.
   */
  it('a demotion back to a level already cleared cannot reuse that level’s old runs to instantly re-promote', () => {
    const h = harness({ initialSeed: 1 })
    playPerfectRun(h)
    playPerfectRun(h)
    playPerfectRun(h)
    expect(useDrumsReadingStore.getState().level).toBe(2)

    act(() => h.result.current.next())
    expect(h.result.current.level).toBe(2)

    // `adaptReadingLevel` demotes once every run in the window falls below
    // `READING_ADAPT_BAND[0]` (0.6) — a fully missed run scores 0.
    playMissedRun(h)
    playMissedRun(h)
    playMissedRun(h)
    expect(useDrumsReadingStore.getState().level).toBe(1)

    act(() => h.result.current.next())
    expect(h.result.current.level).toBe(1)

    // The three level-1 runs that earned the original promotion are still in
    // the store, but three level-2 runs now sit newest between them and any
    // run recorded from here — the streak this hook reads cannot cross that.
    playPerfectRun(h)
    expect(useDrumsReadingStore.getState().level).toBe(1)

    playPerfectRun(h)
    playPerfectRun(h)
    expect(useDrumsReadingStore.getState().level).toBe(2)
  })

  /**
   * Roadmap DR-11 review: the case a `decisionBoundaryRef` (since removed)
   * broke outright — it reset on every `next()`, so a learner who plays one
   * run per exercise and moves on could never accumulate the 3-run window
   * `adaptReadingLevel` needs, and the adaptive level would never move for
   * real usage at all. Nothing here resets between exercises: only an actual
   * OTHER-level run may ever end the streak.
   */
  it('promotes even when the learner presses next() between every single run', () => {
    const h = harness({ initialSeed: 1 })
    playPerfectRun(h)
    expect(useDrumsReadingStore.getState().level).toBe(1)
    act(() => h.result.current.next())

    playPerfectRun(h)
    expect(useDrumsReadingStore.getState().level).toBe(1)
    act(() => h.result.current.next())

    playPerfectRun(h)
    expect(useDrumsReadingStore.getState().level).toBe(2)
  })

  /**
   * Roadmap DR-11 review, MAJOR 5: the reversal into chronological order is
   * what makes `adaptReadingLevel`'s `.slice(-WINDOW)` read the NEWEST three
   * runs. Without it, three old sub-band runs sitting ahead of three brand
   * new clean ones would be exactly what the window reads instead, and this
   * would never promote.
   */
  it('reads the newest three runs, not the oldest three, when a bad streak is followed by a clean one', () => {
    const h = harness({ initialSeed: 1 })
    playMissedRun(h)
    playMissedRun(h)
    playMissedRun(h)
    // Level 1 is the floor — three misses attempt a demotion that clamps
    // right back to 1, so this does not itself count as a decision (no
    // boundary is consumed) and the level truly has not moved yet.
    expect(useDrumsReadingStore.getState().level).toBe(1)
    expect(h.result.current.levelChanged).toBeUndefined()

    playPerfectRun(h)
    playPerfectRun(h)
    expect(useDrumsReadingStore.getState().level).toBe(1)

    playPerfectRun(h)
    expect(useDrumsReadingStore.getState().level).toBe(2)
    expect(h.result.current.levelChanged).toBe('up')
  })

  /**
   * Roadmap DR-11 review, MAJOR 4: `useGrooveRun`'s own `phase` only ever
   * resets on `stop()` — a groove-id change (which `next()` always causes)
   * clears `result` but not `phase` — so without an explicit `stop()` inside
   * `next()`, a freshly drawn exercise would still read `'graded'` and the
   * screen would caption it "Run finished" before a single beat of it plays.
   */
  it('next() leaves the run idle, not still reporting the previous run as graded', () => {
    const h = harness({ initialSeed: 1 })
    playPerfectRun(h)
    expect(h.result.current.run.phase).toBe('graded')

    act(() => h.result.current.next())
    expect(h.result.current.run.phase).toBe('idle')
  })
})
