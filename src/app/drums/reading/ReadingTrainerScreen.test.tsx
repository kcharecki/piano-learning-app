/**
 * `ReadingTrainerScreen` — thin, per the testing rules: what is asserted
 * here is wiring and accessible names. The run, the grading and the level
 * adaptation are `useReadingTrainer.test.ts`'s job; the result panel's
 * wording is `readingRun.test.ts`'s.
 */
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeClock } from '@test/fakes.ts'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useDrumsReadingStore } from '@app/state/drumsReadingStore.ts'
import { planGrooveRun } from '@core/drums/practice/plan.ts'
import { generateReadingExercise } from '@core/drums/reading/index.ts'
import type { DrumAudioOutput } from '@core/ports/index.ts'
import { seededRng } from '@core/ports/rng.ts'
import { ReadingTrainerScreen } from './ReadingTrainerScreen.tsx'

function fakeDrumAudio(clock: FakeClock): DrumAudioOutput {
  return {
    strike: () => {},
    click: () => {},
    allNotesOff: () => {},
    setVolume: () => {},
    now: () => clock.now(),
  }
}

function setup(initialSeed = 1) {
  const clock = new FakeClock()
  const audio = fakeDrumAudio(clock)
  let frame: (() => void) | undefined
  const frameDriver: FrameDriver = (cb) => {
    frame = cb
    return () => {
      frame = undefined
    }
  }
  const user = userEvent.setup()
  render(
    <ReadingTrainerScreen
      clock={clock}
      audio={() => audio}
      frameDriver={frameDriver}
      initialSeed={initialSeed}
    />,
  )
  return {
    user,
    clock,
    frameAt: (ms: number) =>
      act(() => {
        clock.setTime(ms)
        frame?.()
      }),
  }
}

function levelStatus(): string {
  return screen.getByRole('status', { name: 'Level' }).textContent ?? ''
}

function runState(): string {
  return screen.getByRole('status', { name: 'Run state' }).textContent ?? ''
}

beforeEach(() => {
  useDrumsReadingStore.setState({ level: 1, runs: [] })
})

describe('ReadingTrainerScreen', () => {
  it('opens on level 1, describing it in words, ready to start', () => {
    setup()
    expect(screen.getByRole('heading', { level: 1, name: 'Rhythm reading' })).toBeInTheDocument()
    expect(levelStatus()).toBe('Level 1 — Quarters: one note or one silence per beat.')
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    expect(runState()).toBe('Ready when you are')
  })

  it('draws the exercise on a percussion staff with an accessible label', () => {
    setup()
    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  it('has no per-pad legend or pad buttons — pad identity is ignored, only one Tap target exists', () => {
    setup()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tap' })).toBeInTheDocument()
  })

  it('has the six main-bar controls: Start, Listen, Next exercise, Slower, Faster, Tap', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Listen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next exercise' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Slower' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Faster' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tap' })).toBeInTheDocument()
  })

  it('Listen and Next exercise are disabled while a run is live, and Start becomes Stop', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Start' }))

    // Start itself is not merely disabled — it is replaced by Stop, since a
    // live run still needs a way to end it early.
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Listen' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next exercise' })).toBeDisabled()
  })

  it('the Tap pad is wired to the run: pressing it flashes and registers a hit', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(runState()).toMatch(/^Counting in/)

    const tapPad = screen.getByRole('button', { name: 'Tap' })
    await user.pointer({ keys: '[MouseLeft]', target: tapPad })
    expect(tapPad).toHaveAttribute('data-lit', 'true')
  })

  it('Next exercise draws a new staff', async () => {
    const { user } = setup()
    const before = screen.getByRole('img').getAttribute('data-groove-staff')
    await user.click(screen.getByRole('button', { name: 'Next exercise' }))
    const after = screen.getByRole('img').getAttribute('data-groove-staff')
    expect(after).not.toBe(before)
  })
})

/**
 * DR-08: the slip sentence `readingRun.ts`'s `readingResultLines` adds to the
 * Result section. Level 2 at this seed puts eighth notes throughout the
 * exercise (`plan.nominalSubdivisionMs` a fraction of `plan.barMs` — see
 * `readingRun.test.ts`'s own module comment for why level 1's sparser
 * quarters/rests are a bad fit for this), so shifting every onset by exactly
 * one nominal grid step stays inside every onset's own acceptance window
 * (`useGrooveRun`'s `hit()` rejects anything after `endAt + windowMs`) —
 * verified against the plan this describe block builds the very same way
 * `useReadingTrainer` does, never against a hand-picked instant.
 */
describe('ReadingTrainerScreen slip sentence (DR-08)', () => {
  const SEED = 1
  // Mirrors `useReadingTrainer`'s own un-exported defaults (`DEFAULT_BPM`,
  // `DEFAULT_MEASURES`) and `ReadingTrainerScreenProps`, which exposes no way
  // to override either — this is the exact plan the screen will build for
  // `initialSeed={SEED}` at level 2.
  const BPM = 80
  const MEASURES = 2
  const SCORE = generateReadingExercise({ level: 2, measures: MEASURES, id: `ex-${SEED}` }, seededRng(SEED))
  const PLAN = planGrooveRun(SCORE, BPM, { gradedBars: SCORE.measures.length })
  const GRADED_ORIGIN = PLAN.countInBars * PLAN.barMs
  const END_AT = GRADED_ORIGIN + PLAN.gradedMs
  const SNARE_ONSETS = PLAN.pads.find((p) => p.pad === 'snare')?.expectedMs ?? []

  /** Taps every notated onset, each shifted by `offsetMs` — see the module comment. */
  async function tapEveryOnset(
    user: ReturnType<typeof userEvent.setup>,
    clock: FakeClock,
    offsetMs: number,
  ): Promise<void> {
    const tapPad = screen.getByRole('button', { name: 'Tap' })
    for (const onset of SNARE_ONSETS) {
      clock.setTime(GRADED_ORIGIN + onset + offsetMs)
      await user.pointer({ keys: '[MouseLeft]', target: tapPad })
    }
  }

  beforeEach(() => {
    useDrumsReadingStore.setState({ level: 2, runs: [] })
  })

  it('names the slip in the Result section when every onset lands one grid step late', async () => {
    const { user, clock, frameAt } = setup(SEED)
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await tapEveryOnset(user, clock, PLAN.nominalSubdivisionMs)
    frameAt(END_AT)

    const resultSection = screen.getByRole('region', { name: 'Result' })
    expect(resultSection.textContent ?? '').toContain('behind the click')
    // Round-2 review: a text-only assertion cannot tell a real third
    // paragraph from a coincidence, and cannot tell "no slip line at all"
    // apart from "a slip line with different wording" on its own — pin the
    // paragraph count too, so a screen that never renders the slip `<p>`
    // (e.g. `resultLines.slip` silently dropped before it reaches the DOM)
    // cannot pass this test by some other paragraph's text happening to
    // match. One run never adapts the level (that needs a 3-run streak), so
    // this is verdict + detail + slip, no level-change line.
    expect(within(resultSection).getAllByRole('paragraph')).toHaveLength(3)
  })

  it('has no slip sentence in the Result section when every onset lands exactly on the grid', async () => {
    const { user, clock, frameAt } = setup(SEED)
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await tapEveryOnset(user, clock, 0)
    frameAt(END_AT)

    const resultSection = screen.getByRole('region', { name: 'Result' })
    expect(resultSection.textContent ?? '').not.toContain('behind the click')
    // Same negative control as above, the other direction: exactly two
    // paragraphs (verdict, detail) — not three — so a regression that always
    // renders a (possibly empty or stale) third paragraph would be caught
    // even if its text never happens to contain "behind the click".
    expect(within(resultSection).getAllByRole('paragraph')).toHaveLength(2)
  })
})
