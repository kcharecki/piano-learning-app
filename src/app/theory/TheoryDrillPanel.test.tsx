/**
 * Screen-level composition test (roadmap 3.3): a quiz item is built, answered
 * on the on-screen keyboard or a real MIDI keyboard, graded, and its SRS card
 * scheduled into the shared store — driven the way a learner would drive it,
 * not merely rendered. Per-module behaviour (grading, level gating,
 * determinism) is covered by `core/drills/theory.test.ts`.
 */
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import { buildTheoryQuiz, MAX_THEORY_LEVEL, theoryQuizFromId } from '@core/drills/theory.ts'
import { newCard, review } from '@core/srs/scheduler.ts'
import { seededRng } from '@core/ports/rng.ts'
import { act, render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeClock, FakeMidiInput, scriptedRng } from '@test/fakes.ts'
import type { Midi } from '@core/shared/units.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { TheoryDrillPanel } from './TheoryDrillPanel.tsx'

function resetStore(): void {
  useFlashcardStore.setState({ cardsById: {} })
}

afterEach(() => {
  cleanup()
  resetStore()
})

describe('TheoryDrillPanel', () => {
  it('is fully usable with no MIDI keyboard connected — REQ-4.1', () => {
    const neverResolves = (): Promise<never> => new Promise(() => {})
    render(<TheoryDrillPanel connectMidi={neverResolves} rng={scriptedRng([0])} />)

    expect(screen.getByText(/no MIDI keyboard connected/i)).toBeInTheDocument()
    expect(screen.getByTestId('theory-prompt')).toBeInTheDocument()
  })

  it('defaults to the Scale topic at level 1, with a matching prompt', () => {
    render(<TheoryDrillPanel rng={scriptedRng([0])} midiInput={new FakeMidiInput()} />)

    const expected = buildTheoryQuiz('build-scale', 1, scriptedRng([0]))
    expect(screen.getByLabelText('Topic')).toHaveValue('build-scale')
    expect(screen.getByTestId('theory-level')).toHaveTextContent('Level 1')
    expect(screen.getByTestId('theory-prompt')).toHaveTextContent(expected.prompt)
    expect(screen.getByTestId('theory-progress')).toHaveTextContent(`0 / ${expected.answer.length}`)
  })

  it('an already-overdue card in the store is served as the FIRST item on mount, not a fresh random draw (roadmap 3.20)', () => {
    // Before this fix, only `commitAnswer` ever consulted the due card — the
    // initial mount always drew randomly via `buildTheoryQuiz`, so a backlog
    // of overdue facts sat unused until the learner had already answered
    // something. Seed a due card directly into the store and assert it is
    // what's on screen before any interaction at all.
    const NOW = 1_000_000
    const clock = new FakeClock(NOW)
    const dueId = buildTheoryQuiz('build-scale', 1, seededRng(0)).id
    useFlashcardStore.setState({ cardsById: { [dueId]: newCard(dueId, NOW - 100_000) } })

    render(<TheoryDrillPanel rng={scriptedRng([0])} date={clock} midiInput={new FakeMidiInput()} />)

    const dueItem = theoryQuizFromId(dueId)
    expect(dueItem).toBeDefined()
    expect(screen.getByTestId('theory-prompt')).toHaveTextContent(dueItem?.prompt as string)
  })

  it('an unparseable due card at the head of the queue does not block a valid due card behind it', () => {
    // `dueCards` used to be capped at `limit: 1` — a single foreign or stale
    // id sharing a theory kind prefix (reachable via `hydrate` replacing
    // `cardsById` wholesale) would then permanently and silently disable
    // recall for every other overdue card. The unparseable id here is MORE
    // overdue than the valid one, so it sorts first in the due queue.
    const NOW = 1_000_000
    const clock = new FakeClock(NOW)
    const validId = buildTheoryQuiz('build-scale', 1, seededRng(0)).id
    const badId = 'build-scale-Z-major' // 'Z' is not a note letter — never parses
    expect(theoryQuizFromId(badId)).toBeUndefined()
    useFlashcardStore.setState({
      cardsById: {
        [badId]: newCard(badId, NOW - 200_000),
        [validId]: newCard(validId, NOW - 100_000),
      },
    })

    render(<TheoryDrillPanel rng={scriptedRng([0])} date={clock} midiInput={new FakeMidiInput()} />)

    const validItem = theoryQuizFromId(validId)
    expect(validItem).toBeDefined()
    expect(screen.getByTestId('theory-prompt')).toHaveTextContent(validItem?.prompt as string)
  })

  it('initialKind wins over a due card of a DIFFERENT kind at mount (finding 1)', () => {
    // Before finding 1's fix, `dueTheoryItem` scanned every due theory card
    // regardless of kind, so a due 'build-scale' card (the panel's own
    // default, and so the COMMON case after any prior session) would
    // silently override `initialKind="build-cadence"` — exactly the
    // dishonest-title bug roadmap 3.12 exists to remove, re-entering through
    // the seeding path instead of the content path.
    const NOW = 1_000_000
    const clock = new FakeClock(NOW)
    const dueScaleId = buildTheoryQuiz('build-scale', 1, seededRng(0)).id
    useFlashcardStore.setState({ cardsById: { [dueScaleId]: newCard(dueScaleId, NOW - 100_000) } })

    render(
      <TheoryDrillPanel
        rng={scriptedRng([0])}
        date={clock}
        midiInput={new FakeMidiInput()}
        initialKind="build-cadence"
      />,
    )

    const expected = buildTheoryQuiz('build-cadence', 1, scriptedRng([0]))
    expect(screen.getByLabelText('Topic')).toHaveValue('build-cadence')
    expect(screen.getByTestId('theory-prompt')).toHaveTextContent(expected.prompt)
  })

  it('playing the answer on the on-screen keyboard grades it and moves the SRS stat', async () => {
    const user = userEvent.setup()
    render(<TheoryDrillPanel rng={scriptedRng([0])} midiInput={new FakeMidiInput()} />)

    const expected = buildTheoryQuiz('build-scale', 1, scriptedRng([0]))
    expect(screen.getByTestId('theory-stats-total')).toHaveTextContent('0')

    const keyboard = screen.getByRole('group', { name: 'On-screen keyboard' })
    for (const group of expected.answer) {
      for (const note of group) {
        await user.click(within(keyboard).getByRole('button', { name: `Key ${note}` }))
      }
    }

    expect(screen.getByTestId('theory-feedback')).toHaveTextContent(/correct — graded good/i)
    expect(screen.getByTestId('theory-stats-total')).toHaveTextContent('1')
  })

  it('a wrong note grades the attempt incorrect, still scheduling the card', async () => {
    const user = userEvent.setup()
    render(<TheoryDrillPanel rng={scriptedRng([0])} midiInput={new FakeMidiInput()} />)

    const expected = buildTheoryQuiz('build-scale', 1, scriptedRng([0]))
    const firstNote = expected.answer[0]?.[0] as number
    // One semitone off from the correct first note of the scale.
    const wrongNote = firstNote + 1 <= 127 ? firstNote + 1 : firstNote - 1

    const keyboard = screen.getByRole('group', { name: 'On-screen keyboard' })
    await user.click(within(keyboard).getByRole('button', { name: `Key ${wrongNote}` }))

    expect(screen.getByTestId('theory-feedback')).toHaveTextContent(/not quite — graded again/i)
    expect(screen.getByTestId('theory-stats-total')).toHaveTextContent('1')
  })

  it('progressively reports matched groups for a multi-note chord before it is settled', async () => {
    const user = userEvent.setup()
    render(<TheoryDrillPanel rng={scriptedRng([0])} midiInput={new FakeMidiInput()} />)

    await user.selectOptions(screen.getByLabelText('Topic'), 'build-chord')
    const expected = buildTheoryQuiz('build-chord', 1, scriptedRng([0]))
    const chord = expected.answer[0] as readonly number[]
    expect(chord.length).toBeGreaterThanOrEqual(3)

    const keyboard = screen.getByRole('group', { name: 'On-screen keyboard' })
    // Press every note but the last one: the chord is not complete yet, so no
    // feedback should appear.
    for (const note of chord.slice(0, -1)) {
      await user.click(within(keyboard).getByRole('button', { name: `Key ${note}` }))
    }
    expect(screen.queryByTestId('theory-feedback')).toBeNull()

    const lastNote = chord.at(-1) as number
    await user.click(within(keyboard).getByRole('button', { name: `Key ${lastNote}` }))

    expect(screen.getByTestId('theory-feedback')).toHaveTextContent(/correct — graded good/i)
  })

  it('a physical MIDI keyboard press answers the prompt exactly like the on-screen one', () => {
    const midiInput = new FakeMidiInput()
    render(<TheoryDrillPanel rng={scriptedRng([0])} midiInput={midiInput} />)

    const expected = buildTheoryQuiz('build-scale', 1, scriptedRng([0]))
    let atMs = 0
    for (const group of expected.answer) {
      for (const note of group) {
        act(() => midiInput.play(note, atMs))
        atMs += 10
      }
    }

    expect(screen.getByTestId('theory-feedback')).toHaveTextContent(/correct — graded good/i)
    expect(screen.getByTestId('theory-stats-total')).toHaveTextContent('1')
  })

  it('changing the level rebuilds the item', async () => {
    const user = userEvent.setup()
    render(<TheoryDrillPanel rng={scriptedRng([0])} midiInput={new FakeMidiInput()} />)

    const level1 = buildTheoryQuiz('build-scale', 1, scriptedRng([0]))
    expect(screen.getByTestId('theory-prompt')).toHaveTextContent(level1.prompt)

    await user.click(screen.getByRole('button', { name: 'Increase level' }))

    expect(screen.getByTestId('theory-level')).toHaveTextContent('Level 2')
    const level2 = buildTheoryQuiz('build-scale', 2, scriptedRng([0]))
    expect(screen.getByTestId('theory-prompt')).toHaveTextContent(level2.prompt)
  })

  it('changing the topic rebuilds the item for the new kind', async () => {
    const user = userEvent.setup()
    render(<TheoryDrillPanel rng={scriptedRng([0])} midiInput={new FakeMidiInput()} />)

    await user.selectOptions(screen.getByLabelText('Topic'), 'build-interval')

    const expected = buildTheoryQuiz('build-interval', 1, scriptedRng([0]))
    expect(screen.getByTestId('theory-prompt')).toHaveTextContent(expected.prompt)
  })

  it('schedules the SRS card against the injected DateSource, not the wall clock', async () => {
    const user = userEvent.setup()
    const NOW = 1_000_000
    const clock = new FakeClock(NOW)
    render(<TheoryDrillPanel rng={scriptedRng([0])} midiInput={new FakeMidiInput()} date={clock} />)

    const expected = buildTheoryQuiz('build-scale', 1, scriptedRng([0]))
    const keyboard = screen.getByRole('group', { name: 'On-screen keyboard' })
    for (const group of expected.answer) {
      for (const note of group) {
        await user.click(within(keyboard).getByRole('button', { name: `Key ${note}` }))
      }
    }

    const card = useFlashcardStore.getState().cardsById[expected.id]
    expect(card).toBeDefined()
    // A 'good' grade schedules a positive interval strictly after NOW, measured
    // from the injected DateSource — a card scheduled off the real wall clock
    // would not land relative to this fake epoch.
    expect(card?.due).toBeGreaterThan(NOW)
  })

  it('a full chord fired as one batch of MIDI events (a real chord press) accumulates and grades correct', async () => {
    const user = userEvent.setup()
    const midiInput = new FakeMidiInput()
    render(<TheoryDrillPanel rng={scriptedRng([0])} midiInput={midiInput} />)

    await user.selectOptions(screen.getByLabelText('Topic'), 'build-chord')
    const expected = buildTheoryQuiz('build-chord', 1, scriptedRng([0]))
    const chord = expected.answer[0] as readonly Midi[]
    expect(chord.length).toBeGreaterThanOrEqual(3)

    // All notes delivered inside one act(), like a hand pressing a real chord —
    // React batches these, so a bug re-deriving state from stale render-closure
    // values (rather than a ref) would drop every note but the last.
    act(() => {
      let atMs = 0
      for (const note of chord) {
        midiInput.play(note, atMs)
        atMs += 1
      }
    })

    expect(screen.getByTestId('theory-feedback')).toHaveTextContent(/correct — graded good/i)
  })

  it('a wrongly-graded card comes back as ITSELF once due — not a fresh draw that merely shares its kind (roadmap 3.20)', async () => {
    // Mirrors the component's own rng call sequence with a SEPARATE instance
    // of the same seed ONLY to know what to press for item1/item2 — every
    // `buildTheoryQuiz` call spends a FIXED number of `rng.next()` calls
    // regardless of the values drawn (kind alone decides the count), and a
    // wrong ('again') grade spends none in `review`, so the mirror stays in
    // lock-step up to and including item2.
    //
    // The final "comes back as itself" check deliberately does NOT extend
    // the mirror any further to predict what reappears: it instead compares
    // against the prompt captured LIVE from the DOM when item1 was first
    // shown. A behaviour-identical internal reordering of `commitAnswer`'s
    // rng consumption (e.g. hoisting the `??` fallback so it always computes,
    // even when the due branch discards it) would desync a mirror trying to
    // predict further — it cannot desync a comparison against ground truth.
    const SEED = 1
    const NOW = 1_000_000
    const clock = new FakeClock(NOW)
    const user = userEvent.setup()
    render(<TheoryDrillPanel rng={seededRng(SEED)} date={clock} midiInput={new FakeMidiInput()} />)

    const mirror = seededRng(SEED)
    buildTheoryQuiz('build-scale', 1, mirror) // the initial-mount draw

    await user.selectOptions(screen.getByLabelText('Topic'), 'build-chord')
    const item1 = buildTheoryQuiz('build-chord', 1, mirror) // the topic-select draw
    expect(screen.getByTestId('theory-prompt')).toHaveTextContent(item1.prompt)
    const item1PromptFromDom = screen.getByTestId('theory-prompt').textContent

    // Answer item1 WRONG: bump the root by a semitone, keep the other two
    // voices — pitch-class matching then fails on the chord's only group.
    const keyboard = screen.getByRole('group', { name: 'On-screen keyboard' })
    const chord = item1.answer[0] as readonly Midi[]
    const wrongChord = chord.map((n, i) => (i === 0 ? (n + 1 <= 127 ? n + 1 : n - 1) : n))
    for (const note of wrongChord) {
      await user.click(within(keyboard).getByRole('button', { name: `Key ${note}` }))
    }
    expect(screen.getByTestId('theory-feedback')).toHaveTextContent(/not quite — graded again/i)

    // Nothing is due yet (item1's relearning step is ~10 minutes out), so
    // this is the "draw fresh" branch — mirrors the panel's own fallback.
    const item2 = buildTheoryQuiz('build-chord', 1, mirror)
    expect(item2.id).not.toBe(item1.id) // sanity: the pool really did move on
    expect(screen.getByTestId('theory-prompt')).toHaveTextContent(item2.prompt)

    // Past item1's ~10-minute relearning step, well before item2's ~1-day
    // first interval could ever come due.
    act(() => clock.advance(15 * 60 * 1000))

    // Answer item2 (correctly — it does not matter) to trigger the next
    // scheduling pass, which is when the panel re-checks what is due.
    for (const group of item2.answer) {
      for (const note of group) {
        await user.click(within(keyboard).getByRole('button', { name: `Key ${note}` }))
      }
    }

    // item1 — the specific card that was actually due — comes back as
    // itself: the EXACT prompt string captured from the DOM the first time
    // it was shown reappears, not a third fresh draw of 'build-chord' that
    // merely happens to share its kind. A stub that biases only the KIND
    // (the pre-3.20 behaviour) would show some other 'build-chord' prompt
    // here, not item1's.
    expect(screen.getByTestId('theory-prompt').textContent).toBe(item1PromptFromDom)
    expect(screen.getByTestId('theory-progress')).toHaveTextContent(`0 / ${item1.answer.length}`)
  })

  it('draws a fresh item every time nothing is due — never gets stuck re-serving the last one', async () => {
    // Kills a stub that "fixes" the due-recall bug by always re-serving the
    // MOST RECENTLY ANSWERED item's id regardless of whether it is actually
    // due — that would freeze the panel on one fact once no card is overdue.
    const SEED = 2
    const NOW = 1_000_000
    const clock = new FakeClock(NOW)
    const user = userEvent.setup()
    render(<TheoryDrillPanel rng={seededRng(SEED)} date={clock} midiInput={new FakeMidiInput()} />)

    const mirror = seededRng(SEED)
    buildTheoryQuiz('build-scale', 1, mirror) // the initial-mount draw
    await user.selectOptions(screen.getByLabelText('Topic'), 'build-chord')
    let current = buildTheoryQuiz('build-chord', 1, mirror) // the topic-select draw

    const keyboard = screen.getByRole('group', { name: 'On-screen keyboard' })
    const seenIds = new Set<string>()
    for (let round = 0; round < 4; round++) {
      expect(screen.getByTestId('theory-prompt')).toHaveTextContent(current.prompt)
      seenIds.add(current.id)
      const chord = current.answer[0] as readonly Midi[]
      for (const note of chord) {
        await user.click(within(keyboard).getByRole('button', { name: `Key ${note}` }))
      }
      // A correct grade schedules via `review`, which spends 1 rng call on
      // fuzzing the interval (unlike the 'again' path above) — mirror that
      // spend so the next draw stays in lock-step with the component's.
      review(newCard(current.id, NOW), 'good', NOW, mirror)
      // Every answer here is graded correct, so nothing ever comes due
      // (first interval ~1 day out) — every next draw below is the
      // "nothing due" fresh-draw branch, never a due-card recall.
      current = buildTheoryQuiz('build-chord', 1, mirror)
    }
    // At least one of the four rounds drew a genuinely different item — the
    // panel is not stuck re-serving whatever it showed first.
    expect(seenIds.size).toBeGreaterThan(1)
  })

  it('initialKind/initialLevel seed the panel to open on that topic and level (roadmap 3.12, REQ-3.5.2)', () => {
    // 'build-chord' at a constant rng draws the identical index-0 prompt for
    // every level (each *_BY_LEVEL tier is a superset whose first element
    // never moves), so a level-insensitive fixture like it would pass even if
    // `initialLevel` never reached `buildTheoryQuiz` at all (finding 3).
    // 'build-cadence' draws from `fifthsPoolForLevel`, whose index 0 is
    // `-range` and so DOES move with the level — a real proof.
    render(
      <TheoryDrillPanel
        rng={scriptedRng([0])}
        midiInput={new FakeMidiInput()}
        initialKind="build-cadence"
        initialLevel={3}
      />,
    )

    const expected = buildTheoryQuiz('build-cadence', 3, scriptedRng([0]))
    expect(screen.getByLabelText('Topic')).toHaveValue('build-cadence')
    expect(screen.getByTestId('theory-level')).toHaveTextContent('Level 3')
    expect(screen.getByTestId('theory-prompt')).toHaveTextContent(expected.prompt)
  })

  it('initialLevel is clamped into [1, MAX_THEORY_LEVEL]', () => {
    render(
      <TheoryDrillPanel
        rng={scriptedRng([0])}
        midiInput={new FakeMidiInput()}
        initialLevel={MAX_THEORY_LEVEL + 50}
      />,
    )

    expect(screen.getByTestId('theory-level')).toHaveTextContent(`Level ${MAX_THEORY_LEVEL}`)
  })

  it('initialLevel below 1 is clamped up to 1', () => {
    render(<TheoryDrillPanel rng={scriptedRng([0])} midiInput={new FakeMidiInput()} initialLevel={-3} />)

    expect(screen.getByTestId('theory-level')).toHaveTextContent('Level 1')
  })

  it('absent initialKind/initialLevel behaves exactly like today: build-scale at level 1', () => {
    render(<TheoryDrillPanel rng={scriptedRng([0])} midiInput={new FakeMidiInput()} />)

    const expected = buildTheoryQuiz('build-scale', 1, scriptedRng([0]))
    expect(screen.getByLabelText('Topic')).toHaveValue('build-scale')
    expect(screen.getByTestId('theory-level')).toHaveTextContent('Level 1')
    expect(screen.getByTestId('theory-prompt')).toHaveTextContent(expected.prompt)
  })

  it('a wrongly-graded card comes back as ITSELF once due even when seeded via initialKind — seeding only touches mount, not the kind/level reset effect (roadmap 3.20 regression guard)', async () => {
    // Mirrors the existing "comes back as ITSELF" test above, but starting
    // from a seeded initialKind instead of the default 'build-scale', to
    // prove the seed is read once at mount and does not perturb the
    // ref-guarded kind/level effect (lines ~208-233) that this recall
    // behaviour depends on.
    const SEED = 1
    const NOW = 1_000_000
    const clock = new FakeClock(NOW)
    const user = userEvent.setup()
    render(
      <TheoryDrillPanel
        rng={seededRng(SEED)}
        date={clock}
        midiInput={new FakeMidiInput()}
        initialKind="build-chord"
      />,
    )

    const mirror = seededRng(SEED)
    const item1 = buildTheoryQuiz('build-chord', 1, mirror) // the initial-mount draw, seeded kind
    expect(screen.getByTestId('theory-prompt')).toHaveTextContent(item1.prompt)
    const item1PromptFromDom = screen.getByTestId('theory-prompt').textContent

    // Answer item1 WRONG: bump the root by a semitone, keep the other two
    // voices — pitch-class matching then fails on the chord's only group.
    const keyboard = screen.getByRole('group', { name: 'On-screen keyboard' })
    const chord = item1.answer[0] as readonly Midi[]
    const wrongChord = chord.map((n, i) => (i === 0 ? (n + 1 <= 127 ? n + 1 : n - 1) : n))
    for (const note of wrongChord) {
      await user.click(within(keyboard).getByRole('button', { name: `Key ${note}` }))
    }
    expect(screen.getByTestId('theory-feedback')).toHaveTextContent(/not quite — graded again/i)

    // Nothing is due yet, so this is the "draw fresh" branch.
    const item2 = buildTheoryQuiz('build-chord', 1, mirror)
    expect(item2.id).not.toBe(item1.id)
    expect(screen.getByTestId('theory-prompt')).toHaveTextContent(item2.prompt)

    // Past item1's ~10-minute relearning step.
    act(() => clock.advance(15 * 60 * 1000))

    for (const group of item2.answer) {
      for (const note of group) {
        await user.click(within(keyboard).getByRole('button', { name: `Key ${note}` }))
      }
    }

    // item1 comes back as itself.
    expect(screen.getByTestId('theory-prompt').textContent).toBe(item1PromptFromDom)
    expect(screen.getByTestId('theory-progress')).toHaveTextContent(`0 / ${item1.answer.length}`)
  })

  it("the level selector's maximum tracks the core tables' own tier count, not a hardcoded UI number", async () => {
    // Kills a stub that keeps a hardcoded `MAX_LEVEL` (e.g. 8) while the
    // core `*_BY_LEVEL` tables stay at their real width (4) — the selector
    // would let the learner pick levels whose pool never actually changes.
    const user = userEvent.setup()
    render(<TheoryDrillPanel rng={scriptedRng([0])} midiInput={new FakeMidiInput()} />)

    const increase = screen.getByRole('button', { name: 'Increase level' })
    for (let level = 1; level < MAX_THEORY_LEVEL; level++) {
      await user.click(increase)
    }
    expect(screen.getByTestId('theory-level')).toHaveTextContent(`Level ${MAX_THEORY_LEVEL}`)
    expect(increase).toBeDisabled()
  })

  it('selecting the maximum level yields a different item pool than one level below it', async () => {
    const user = userEvent.setup()
    render(<TheoryDrillPanel rng={scriptedRng([0])} midiInput={new FakeMidiInput()} />)

    const increase = screen.getByRole('button', { name: 'Increase level' })
    for (let level = 1; level < MAX_THEORY_LEVEL - 1; level++) {
      await user.click(increase)
    }
    expect(screen.getByTestId('theory-level')).toHaveTextContent(`Level ${MAX_THEORY_LEVEL - 1}`)
    const belowMaxPrompt = screen.getByTestId('theory-prompt').textContent

    await user.click(increase)
    expect(screen.getByTestId('theory-level')).toHaveTextContent(`Level ${MAX_THEORY_LEVEL}`)
    const atMaxPrompt = screen.getByTestId('theory-prompt').textContent

    // With a constant rng, `buildTheoryQuiz` always picks each pool's first
    // candidate, so a real difference here proves the level-4 pool actually
    // differs from level-3's — not merely that the level number went up.
    // Kills a stub that raises `MAX_LEVEL` past the tables' own 4 tiers,
    // where level 4 and any level above it render identically.
    expect(atMaxPrompt).not.toBe(belowMaxPrompt)
  })
})
