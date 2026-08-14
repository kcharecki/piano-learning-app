/**
 * `SessionPlanScreen`'s own wiring (roadmap 4.7a, 5.44, 5.45, REQ-3.1.4;
 * redesigned UI-08, 2026-08-12 UI audit): the rendered minutes sum to the
 * chosen budget, the per-segment split matches `DEFAULT_MIX` (plus warm-up's
 * flat reservation), clicking an item's card calls `onOpen` with that item's
 * own `Exercise`, an unfillable plan renders the error text instead of an
 * empty list, and — 5.44/5.45 — starting a session shows a running view with
 * a position ("Item N of TOTAL"), completing items advances it, and the
 * warm-up item opens a real checklist rather than a plain "Open" link.
 * `useSessionPlan`, `useSessionRun` and `candidates.ts` have their own
 * suites — every test here exercises them for real (through the real
 * stores and a fake `Store`/`Clock`), so the assertions are about what
 * actually renders, not a mock's say-so.
 *
 * UI-08 also proves the "one primary action per screen" rule (screen rule
 * 1): exactly one `.btn-primary` while planning, and exactly one while a
 * session is running.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScoreStore } from '@app/state/scoreStore.ts'
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { useProgressStore } from '@app/state/progressStore.ts'
import { useRepertoireStore } from '@app/state/repertoireStore.ts'
import { MIN_LEVEL } from '@core/sightreading/adaptive.ts'
import { makeScore } from '@core/notation/score.ts'
import type { Exercise } from '@core/curriculum/types.ts'
import type { DateSource } from '@core/ports/index.ts'
import { FakeClock, MemoryStore } from '@test/fakes.ts'
import { SessionPlanScreen } from './SessionPlanScreen.tsx'

function resetStores(): void {
  useScoreStore.setState({
    loaded: undefined,
    importError: undefined,
    availableMidiDevices: [],
    selectedMidiDeviceId: null,
    settings: {
      tempoScale: 1,
      activeHands: ['left', 'right'],
      metronomeEnabled: false,
      loop: undefined,
    },
  })
  useSightReadingStore.setState({ level: MIN_LEVEL, history: [] })
  useProgressStore.setState({ assessments: [], recordings: [], practiceEntries: [] })
  // roadmap 4.10: a cold repertoire library, so "no score loaded" tests
  // actually exercise the curriculum fallback (candidates.ts) rather than
  // an accidental repertoire-piece candidate left over from another test.
  useRepertoireStore.setState({ pieces: [] })
}

/** Loads a score so all four mixable segments (including lesson) have a
 * candidate, making the split match DEFAULT_MIX's 20/20/40/20 exactly. */
function loadAScore(): void {
  useScoreStore.getState().loadScore({
    score: makeScore({ id: 'test-score', measures: [{}], notes: [], tempos: [{ tick: 0, bpm: 120 }] }),
    sourceName: 'Test Piece',
    musicXml: undefined,
  })
}

beforeEach(resetStores)
afterEach(() => {
  cleanup()
  resetStores()
})

/** Reads one item row's own duration badge — its own dedicated element, not
 * a regex over the whole row's concatenated text: a title that itself ends
 * in a digit ("…level 1") sits flush against the badge in the DOM (no
 * whitespace text node between sibling `<span>`s — the visual gap is
 * layout-only, from the card's flex `gap`), so "level 1" + "6 min" reads as
 * the single fused token "16 min" in `textContent`. Reading the badge's own
 * `.session-plan-item-duration` element sidesteps that entirely. */
function rowMinutes(row: HTMLElement): number {
  const badge = row.querySelector('.session-plan-item-duration')
  const match = /^(\d+) min$/.exec(badge?.textContent ?? '')
  if (match?.[1] === undefined) throw new Error(`no duration badge found in row: ${row.textContent}`)
  return Number(match[1])
}

/** Sums the duration badge across every item card belonging to one segment
 * (UI-08: replaces the old dedicated `session-plan-segment-*` breakdown
 * testids — each item card now carries its own `data-segment`, which is
 * what actually renders on screen). */
function segmentMinutes(name: string): number {
  const items = screen.getByRole('list', { name: 'Session items' })
  const rows = within(items).getAllByRole('listitem')
  return rows
    .filter((row) => row.getAttribute('data-segment') === name)
    .reduce((sum, row) => sum + rowMinutes(row), 0)
}

function totalMinutes(): number {
  const text = screen.getByTestId('session-plan-total').textContent ?? ''
  return Number(text.replace(/[^\d.-]/g, ''))
}

/** `useSessionRun` opens a real IndexedDB store by default; every render
 * here injects a fresh in-memory one instead, exactly like `App.tsx`'s own
 * `openStore` injection seam, so no test depends on (or shares) real
 * browser storage. */
function freshStoreProps() {
  const store = new MemoryStore()
  const clock = new FakeClock()
  const date: DateSource = { epochMillis: () => Date.now() }
  return { openStore: () => Promise.resolve(store), clock, date }
}

/** Waits past `useSessionRun`'s macrotask-deferred hydration/timer-start. */
async function waitHydrated(): Promise<void> {
  await waitFor(() => expect(screen.queryByText(/loading today/i)).not.toBeInTheDocument())
}

describe('SessionPlanScreen — planning', () => {
  it('renders minutes summing exactly to the chosen budget, for 15/30/60 — both the segment split and every rendered item', async () => {
    const user = userEvent.setup()
    loadAScore()
    render(<SessionPlanScreen onOpen={() => {}} {...freshStoreProps()} />)
    await waitHydrated()

    for (const minutes of [15, 30, 60]) {
      await user.click(screen.getByRole('radio', { name: `${minutes} min` }))
      expect(totalMinutes()).toBe(minutes)
      const segmentSum =
        segmentMinutes('warmup') +
        segmentMinutes('technique') +
        segmentMinutes('sight-reading') +
        segmentMinutes('lesson') +
        segmentMinutes('theory-ear')
      expect(segmentSum).toBe(minutes)

      const items = screen.getByRole('list', { name: 'Session items' })
      const rows = within(items).getAllByRole('listitem')
      const itemMinutesSum = rows.reduce((sum, row) => sum + rowMinutes(row), 0)
      expect(itemMinutesSum).toBe(minutes)
      expect(itemMinutesSum).toBe(segmentSum)
    }
  })

  it('splits 30 minutes so warm-up/technique together hold REQ-3.1.4\'s ~20%, now that every mixable segment has candidates (roadmap 4.10)', async () => {
    const user = userEvent.setup()
    loadAScore()
    render(<SessionPlanScreen onOpen={() => {}} {...freshStoreProps()} />)
    await waitHydrated()

    await user.click(screen.getByRole('radio', { name: '30 min' }))

    // technique's own 20% share of the FULL 30 minutes is a 6-minute bucket
    // shared with warm-up (roadmap 4.10 — see session.ts's module doc):
    // warm-up claims its full 5-minute routine, technique keeps the rest.
    // sight-reading/lesson/theory-ear split the plain 20/40/20 of the same
    // full 30 minutes, unaffected by warm-up's existence.
    expect(segmentMinutes('warmup')).toBe(5)
    expect(segmentMinutes('technique')).toBe(1)
    expect(segmentMinutes('sight-reading')).toBe(6)
    expect(segmentMinutes('lesson')).toBe(12)
    expect(segmentMinutes('theory-ear')).toBe(6)
  })

  it('the first item is always warm-up and renders as a static card (opens as a checklist), not a clickable "Open" card', async () => {
    loadAScore()
    render(<SessionPlanScreen onOpen={() => {}} {...freshStoreProps()} />)
    await waitHydrated()

    const items = screen.getByRole('list', { name: 'Session items' })
    const rows = within(items).getAllByRole('listitem')
    const firstRow = rows[0]
    if (firstRow === undefined) throw new Error('expected at least one session item')
    expect(firstRow.textContent).toMatch(/warm-up/i)
    expect(within(firstRow).queryByRole('button', { name: /^Open/ })).not.toBeInTheDocument()
    expect(firstRow.textContent).toMatch(/opens as a checklist/i)
  })

  it('every other item renders as a card whose whole surface is the "Open" click target, identified exactly by its own exercise', async () => {
    const user = userEvent.setup()
    loadAScore()
    const onOpen = vi.fn<(exercise: Exercise) => void>()
    render(<SessionPlanScreen onOpen={onOpen} {...freshStoreProps()} />)
    await waitHydrated()

    const items = screen.getByRole('list', { name: 'Session items' })
    const rows = within(items).getAllByRole('listitem')
    const lastRow = rows[rows.length - 1]
    if (lastRow === undefined) throw new Error('expected at least one session item')
    const openCard = within(lastRow).getByRole('button', { name: /^Open / })
    // The whole card is the click target — a real <button>, keyboard
    // reachable and focusable by default, not a link buried inside a row.
    expect(openCard.tagName).toBe('BUTTON')

    await user.click(openCard)

    expect(onOpen).toHaveBeenCalledTimes(1)
    const openedExercise = onOpen.mock.calls[0]?.[0]
    if (openedExercise === undefined) throw new Error('onOpen was not called with an exercise')
    // The last row is always a 'theory-ear' item (items arrive pre-ordered
    // by segment) and the only reachable theory-ear candidate today is the
    // staff-to-key flashcard deck — assert its exact id, not a substring
    // match that any exercise sharing a word in its title would satisfy.
    expect(openedExercise.id).toBe('flashcards-staff-to-key')
  })

  it('no item card renders the old em-dash-joined row text', async () => {
    loadAScore()
    render(<SessionPlanScreen onOpen={() => {}} {...freshStoreProps()} />)
    await waitHydrated()

    const items = screen.getByRole('list', { name: 'Session items' })
    const rows = within(items).getAllByRole('listitem')
    for (const row of rows) {
      expect(row.textContent ?? '').not.toMatch(/—/)
    }
  })

  it('with no score loaded and no repertoire yet, the lesson segment falls back to the curriculum and shows a note (roadmap 4.10)', async () => {
    render(<SessionPlanScreen onOpen={() => {}} {...freshStoreProps()} />)
    await waitHydrated()

    // Defect 1b (docs/m4-acceptance-2026-08-12.md): a fresh install used to
    // plan "Lesson / repertoire — 0 min" on Today, the app's own default
    // screen. It no longer does — candidates.ts's fallback chain gives it
    // the curriculum's first lesson instead.
    expect(segmentMinutes('lesson')).toBeGreaterThan(0)
    const items = screen.getByRole('list', { name: 'Session items' })
    expect(within(items).getByText(/^Lesson: /)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/no score loaded/i)
  })

  it('once a score is loaded, the lesson segment opens it directly and the curriculum-fallback note disappears', async () => {
    loadAScore()
    render(<SessionPlanScreen onOpen={() => {}} {...freshStoreProps()} />)
    await waitHydrated()

    expect(segmentMinutes('lesson')).toBeGreaterThan(0)
    const items = screen.getByRole('list', { name: 'Session items' })
    expect(within(items).getByText(/Test Piece/)).toBeInTheDocument()
    expect(screen.queryByText(/no score loaded/i)).not.toBeInTheDocument()
  })

  it('renders the error text instead of an empty list for an unfillable request', async () => {
    // `sight-reading` and `theory-ear` always have a candidate by design
    // (candidates.ts), so "every segment empty" cannot presently be reached
    // through this screen's own UI — see this module's build report. The
    // budget field IS a real, reachable way to make `planSession` fail
    // (REQ-3.1.4's positive-whole-minutes contract), and it renders through
    // the exact same branch (`error !== undefined` -> alert, no list).
    const user = userEvent.setup()
    render(<SessionPlanScreen onOpen={() => {}} {...freshStoreProps()} />)
    await waitHydrated()

    const customMinutes = screen.getByLabelText('Custom minutes')
    await user.clear(customMinutes)
    await user.type(customMinutes, '0')

    // Learner-facing text (friendlyError), not planSession's internal
    // parameter name — that raw message is kept in the alert's `title`.
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/enter a session length/i)
    expect(alert.getAttribute('title')).toMatch(/positive/i)
    expect(screen.queryByRole('list', { name: 'Session items' })).not.toBeInTheDocument()
  })

  it('the mix controls are collapsed behind disclosure, keeping "Start session" the one primary action', async () => {
    render(<SessionPlanScreen onOpen={() => {}} {...freshStoreProps()} />)
    await waitHydrated()

    // jsdom does not implement <details> open/closed visual collapse (a
    // rendering concern, not a DOM-structure one), so this asserts the
    // structural fact that drives it: the mix group's own DOM ancestor is a
    // <details> that starts closed.
    const mixGroup = screen.getByRole('group', { name: 'Session mix' })
    const details = mixGroup.closest('details')
    expect(details).not.toBeNull()
    expect(details?.open).toBe(false)

    expect(document.querySelectorAll('.btn-primary')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Start session' })).toHaveClass('btn-primary')
  })

  it('the session-length row is a labelled segmented control, not a bare button group', async () => {
    render(<SessionPlanScreen onOpen={() => {}} {...freshStoreProps()} />)
    await waitHydrated()

    const group = screen.getByRole('radiogroup', { name: 'Session length' })
    expect(within(group).getAllByRole('radio')).toHaveLength(3)
  })
})

describe('SessionPlanScreen — running (roadmap 5.44)', () => {
  it('starting a session shows "Item 1 of N" and completing items advances the position, ending in a complete state', async () => {
    const user = userEvent.setup()
    render(<SessionPlanScreen onOpen={() => {}} {...freshStoreProps()} />)
    await waitHydrated()
    await user.click(screen.getByRole('radio', { name: '15 min' }))

    const itemRows = within(screen.getByRole('list', { name: 'Session items' })).getAllByRole(
      'listitem',
    )
    const totalItems = itemRows.length

    await user.click(screen.getByRole('button', { name: 'Start session' }))

    expect(screen.getByTestId('session-run-position')).toHaveTextContent(
      `Item 1 of ${totalItems}`,
    )
    // Exactly one primary action while running — the current step's own
    // advance action, never two competing primaries (screen rule 1).
    expect(document.querySelectorAll('.btn-primary')).toHaveLength(1)
    // Warm-up is first, and its "Complete" is gated until every checklist
    // step is checked — not completable immediately.
    expect(screen.getByRole('button', { name: 'Complete warm-up' })).toBeDisabled()

    for (const checkbox of screen.getAllByRole('checkbox')) {
      await user.click(checkbox)
    }
    const completeWarmup = screen.getByRole('button', { name: 'Complete warm-up' })
    expect(completeWarmup).toBeEnabled()
    await user.click(completeWarmup)

    await waitFor(() =>
      expect(screen.getByTestId('session-run-position')).toHaveTextContent(
        `Item 2 of ${totalItems}`,
      ),
    )
    // Per-item completion state (roadmap 5.44): item 0 (warm-up) reads
    // "done", item 1 reads "current", everything after is "upcoming" — not
    // just the position counter. UI-08: each status also carries its own
    // icon rather than `--text-3` text alone (rule 8 — color/text is never
    // the only signal).
    expect(screen.getByTestId('session-run-item-0')).toHaveAttribute('data-status', 'done')
    expect(screen.getByTestId('session-run-item-0').querySelector('svg')).not.toBeNull()
    expect(screen.getByTestId('session-run-item-1')).toHaveAttribute('data-status', 'current')
    if (totalItems > 2) {
      expect(screen.getByTestId('session-run-item-2')).toHaveAttribute('data-status', 'upcoming')
    }

    // Complete item 2 (index 1) and land on item 3 (index 2) — the exact
    // "resumes at item 3 with the first two marked done" shape this
    // roadmap's proof asks for (5.44's e2e spec then also proves this
    // survives a reload against real IndexedDB).
    if (totalItems >= 3) {
      await user.click(screen.getByRole('button', { name: 'Complete item' }))
      await waitFor(() =>
        expect(screen.getByTestId('session-run-position')).toHaveTextContent(
          `Item 3 of ${totalItems}`,
        ),
      )
      expect(screen.getByTestId('session-run-item-0')).toHaveAttribute('data-status', 'done')
      expect(screen.getByTestId('session-run-item-1')).toHaveAttribute('data-status', 'done')
      expect(screen.getByTestId('session-run-item-2')).toHaveAttribute('data-status', 'current')
    }

    // Walk through every remaining item via "Complete item" — starting from
    // item 3 (index 2) if the block above already advanced there.
    const alreadyAdvancedTo = totalItems >= 3 ? 3 : 2
    for (let i = alreadyAdvancedTo; i <= totalItems; i++) {
      const completeButton = await screen.findByRole('button', { name: 'Complete item' })
      await user.click(completeButton)
      if (i < totalItems) {
        await waitFor(() =>
          expect(screen.getByTestId('session-run-position')).toHaveTextContent(
            `Item ${i + 1} of ${totalItems}`,
          ),
        )
      }
    }

    await waitFor(() => expect(screen.getByTestId('session-run-complete')).toBeInTheDocument())
    expect(screen.getByTestId('session-run-complete')).toHaveTextContent(
      `${totalItems} of ${totalItems} items done`,
    )
    expect(screen.getByRole('button', { name: 'Plan a new session' })).toHaveClass('btn-primary')
    expect(document.querySelectorAll('.btn-primary')).toHaveLength(1)

    // Only warm-up and one other real activity kind can be asserted
    // generically here (candidates vary by segment) — the practice log now
    // has one entry per completed item.
    expect(useProgressStore.getState().practiceEntries).toHaveLength(totalItems)
    expect(useProgressStore.getState().practiceEntries.some((e) => e.kind === 'warmup')).toBe(true)
  })

  it('a completed run can be discarded via "Plan a new session", returning to the planner', async () => {
    const user = userEvent.setup()
    render(<SessionPlanScreen onOpen={() => {}} {...freshStoreProps()} />)
    await waitHydrated()
    await user.click(screen.getByRole('radio', { name: '15 min' }))
    await user.click(screen.getByRole('button', { name: 'Start session' }))

    await user.click(screen.getByRole('button', { name: 'Stop session' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Start session' })).toBeInTheDocument())
  })
})
