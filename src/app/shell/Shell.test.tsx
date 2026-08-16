/**
 * Shell navigation (roadmap 1.17, 2.12, 5.39, 5.42, REQ-4.6): every
 * destination is a real screen, reached through the router (`route.ts` +
 * `routing.ts`) rather than bare `useState`, and Today — not Practice — is
 * the default (roadmap 5.39). `ScoreScreen` pulls in the OSMD-backed
 * viewer, so it is mocked here — this file only asserts on navigation
 * wiring. Sight reading and Flashcards are cheap enough to render for real
 * (no OSMD, no audio/MIDI access started until a user acts), so this is
 * also the regression test for roadmap 1.18's own lesson: a screen built and
 * tested in isolation but never mounted by the shell is unreachable. Full
 * routing behaviour (URL changes, Back/Forward, reload) is proved end to
 * end in `e2e/routing.spec.ts`, not here — happy-dom's `window.history` is
 * real enough for `routing.test.ts`'s unit coverage but a Playwright-driven
 * proof is what the roadmap item's proof action actually asks for. See
 * `e2e/smoke.spec.ts` for the real-browser boot proof.
 */
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import { useLevelStore } from '@app/state/levelStore.ts'
import { useProgressStore } from '@app/state/progressStore.ts'
import { INSTRUMENT_HINT_KEY, useInstrumentStore } from '@app/state/instrumentStore.ts'
import { MIN_LEVEL } from '@core/sightreading/adaptive.ts'
import { initialLevelState } from '@core/progress/levels.ts'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@app/score/ScoreScreen.tsx', () => ({
  ScoreScreen: () => <div data-testid="mock-score-screen" />,
}))

// The Theory destination reaches a SECOND OSMD mount that `ScoreScreen`'s mock
// does not cover: `TheoryScreen` -> `ChordScaleReference` -> `ScaleStaff`
// (roadmap 3.14) -> `ExerciseScore` -> `ScoreViewer`. happy-dom has no canvas,
// so OSMD's text measurer throws — and because `autoResize: true` makes OSMD
// re-render on a timer it owns, that throw lands OUTSIDE the `load()` promise
// `ScoreViewer` catches, as an unhandled exception that fails the whole run
// while every test still passes. Same mock as ChordScaleReference.test.tsx /
// ScaleStaff.test.tsx / TechniqueScreen.test.tsx; the real engraving is proved
// in a browser by e2e, not here.
vi.mock('@app/score/ScoreViewer.tsx', () => ({
  ScoreViewer: ({ score }: { readonly score: { readonly meta: { readonly title: string } } }) => (
    <div data-testid="mock-score-viewer" data-title={score.meta.title} />
  ),
}))

const { Shell } = await import('./Shell.tsx')

function resetStores(): void {
  useSightReadingStore.setState({ level: MIN_LEVEL, history: [] })
  useFlashcardStore.setState({ cardsById: {} })
  // Roadmap UI-04a: the rail footer now reads these two directly — neither
  // is mutated by anything this file drives, but reset for the same reason
  // the stores above are: a stray write from an earlier test must never
  // leak into a later one's render.
  useLevelStore.setState({ levelState: initialLevelState(), hydrated: false })
  useProgressStore.setState({ practiceEntries: [], assessments: [] })
  // Roadmap DR-01: the switcher's own persistence effect writes here — both
  // the zustand store AND, via `setLastInstrument`'s real `writeHint`, the
  // synchronous localStorage hint `routing.ts` reads as `parseAppRoute`'s
  // `defaultInstrument` on a bare-root mount. Both must be reset, or a
  // switch driven by one test leaks into the next test's default-instrument
  // assumption even after the URL itself is reset (see the top-level
  // afterEach's own comment).
  useInstrumentStore.setState({ lastInstrument: 'piano' })
  localStorage.removeItem(INSTRUMENT_HINT_KEY)
}

// Roadmap UI-36: `useCompactShell()` reads `window.matchMedia('(max-width:
// 1024px)').matches` both synchronously (useState's lazy initializer) and
// on the query's own 'change' event (useEffect) — happy-dom's default
// 1024x768 viewport makes every OTHER test in this file exercise the
// compact path for free (matches: true) without any stub, which is why
// they're untouched by this task. Desktop coverage needs an explicit stub
// installed BEFORE render, since useState's initializer runs on first render.
function stubDesktopMatchMedia(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

afterEach(() => {
  cleanup()
  resetStores()
  vi.unstubAllGlobals()
  // Roadmap DR-01: `useRoute()` reads real `window.location.pathname` on
  // mount, and happy-dom's `window` (and its History) persists across tests
  // in this file — a test that navigates (Practice, Drums, ...) would
  // otherwise leave the NEXT test's initial render booting on that same
  // path instead of the default `/`. Every existing test happened to survive
  // this by always driving its own navigation explicitly, but the switcher
  // tests below assert on the INITIAL state, so this reset is no longer
  // optional.
  window.history.replaceState(null, '', '/')
})

describe('Shell', () => {
  // Roadmap 5.39: the front door is Today, not the densest screen in the
  // app. This also doubles as the routing proof (5.42) at the unit level —
  // happy-dom's default `location.pathname` is `/`, exactly the "cold boot,
  // nothing in the URL" case the e2e default-destination spec drives for
  // real; `parseRoute('/')` resolving to Today is what makes this true.
  it('shows Today as the active, live screen by default', () => {
    render(<Shell />)
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: "Today's session" })).toBeInTheDocument()
  })

  it('reaches the real practice screen through its nav item', async () => {
    const user = userEvent.setup()
    render(<Shell />)

    await user.click(screen.getByRole('button', { name: 'Practice' }))

    expect(screen.getByRole('button', { name: 'Practice' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('mock-score-screen')).toBeInTheDocument()
  })

  it('reaches the real sight-reading trainer through its nav item', async () => {
    const user = userEvent.setup()
    render(<Shell />)

    await user.click(screen.getByRole('button', { name: 'Sight reading' }))

    expect(screen.getByRole('button', { name: 'Sight reading' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('heading', { name: 'Sight reading' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start exercise' })).toBeInTheDocument()
  })

  it('reaches the real flashcard drill through its nav item', async () => {
    const user = userEvent.setup()
    render(<Shell />)

    await user.click(screen.getByRole('button', { name: 'Flashcards' }))

    expect(screen.getByRole('button', { name: 'Flashcards' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('heading', { name: 'Flashcards' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /staff/i })).toBeInTheDocument()
  })

  // Every destination is now a real screen — there are no placeholders left
  // (roadmap 3.8/3.9/3.10, 4.7, 4.7a). Each case asserts on something only
  // that screen renders, so a nav item pointing at the wrong component fails
  // here rather than in a browser.
  it.each([
    ['Theory', 'Theory'],
    ['Progress', 'Progress'],
    // Sentence case since roadmap UI-13 — DESIGN.md rule 7 ("Copy is sentence
    // case"), so the heading now matches the nav label exactly.
    ['Ear training', 'Ear training'],
    ['Metronome', 'Metronome'],
    ['Today', "Today's session"],
  ])('reaches the real %s screen through its nav item', async (label, heading) => {
    const user = userEvent.setup()
    render(<Shell />)

    await user.click(screen.getByRole('button', { name: label }))

    expect(screen.queryByTestId('mock-score-screen')).toBeNull()
    expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
  })

  // Roadmap 3.11. The curriculum names all four decks, but `openedDeckOf`
  // matched only two and returned `undefined` for the rest — and `undefined`
  // falls back to the default staff-to-key deck rather than failing, so seven
  // lessons silently opened the note-naming drill their titles disowned. This
  // drives the real path (Lessons -> lesson -> Open) and asserts on the deck
  // and level the learner actually lands on, which is the only thing a silent
  // fallback cannot fake.
  it('opens a lesson quiz on the deck and level that lesson named', async () => {
    const user = userEvent.setup()
    render(<Shell />)

    await user.click(screen.getByRole('button', { name: 'Lessons' }))
    await user.click(screen.getByRole('button', { name: 'Level 3' }))
    await user.click(screen.getByRole('button', { name: 'The Circle of Fifths' }))
    await user.click(
      screen.getByRole('button', { name: 'Open Quiz: the circle of fifths and key signatures' }),
    )

    expect(screen.getByLabelText('Drill')).toHaveValue('key-signature')
    // Level 1 holds only fifths -1..+1, so a circle-of-fifths quiz that opened
    // at the default level would drill three signatures out of fifteen.
    // The value node holds ONLY the number since roadmap UI-12 moved the
    // "Level" label out of the stepper group and into its own `.field` label —
    // the whole point of the `.stepper` primitive. Anchored so this cannot
    // pass on "17".
    expect(screen.getByTestId('flashcard-level')).toHaveTextContent(/^7$/)
  })

  it('switches back to Practice', async () => {
    const user = userEvent.setup()
    render(<Shell />)

    await user.click(screen.getByRole('button', { name: 'Theory' }))
    await user.click(screen.getByRole('button', { name: 'Practice' }))

    expect(screen.getByTestId('mock-score-screen')).toBeInTheDocument()
  })

  // Roadmap 3.17: the reference panel is shell-level chrome, always
  // reachable, and never unmounts the routed screen underneath it.
  describe('reference panel', () => {
    it('is mounted nowhere until the toggle is first pressed', () => {
      render(<Shell />)
      expect(screen.queryByRole('complementary', { name: /chord and scale reference/i })).toBeNull()
    })

    it('opens on toggle, with the correct aria contract, and never unmounts Practice underneath it', async () => {
      const user = userEvent.setup()
      render(<Shell />)

      await user.click(screen.getByRole('button', { name: 'Practice' }))
      expect(screen.getByTestId('mock-score-screen')).toBeInTheDocument()

      const toggle = screen.getByRole('button', { name: 'Reference' })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(toggle).toHaveAttribute('aria-controls', 'reference-panel')

      await user.click(toggle)

      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      const panel = screen.getByRole('complementary', { name: /chord and scale reference/i })
      expect(panel).not.toHaveAttribute('aria-modal')
      // The routed screen's own instance is untouched — same mock element,
      // never remounted — while the panel is open on top of it.
      expect(screen.getByTestId('mock-score-screen')).toBeInTheDocument()
    })

    it('closes on Escape and returns focus to the toggle', async () => {
      const user = userEvent.setup()
      render(<Shell />)

      const toggle = screen.getByRole('button', { name: 'Reference' })
      await user.click(toggle)
      expect(screen.getByRole('complementary', { name: /chord and scale reference/i })).toBeVisible()

      await user.keyboard('{Escape}')

      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(toggle).toHaveFocus()
    })

    it('is mutually exclusive with the nav drawer — opening one closes the other', async () => {
      const user = userEvent.setup()
      render(<Shell />)

      const navToggle = screen.getByRole('button', { name: 'Open navigation' })
      const referenceToggle = screen.getByRole('button', { name: 'Reference' })

      await user.click(navToggle)
      expect(navToggle).toHaveAttribute('aria-expanded', 'true')

      await user.click(referenceToggle)
      expect(referenceToggle).toHaveAttribute('aria-expanded', 'true')
      expect(navToggle).toHaveAttribute('aria-expanded', 'false')

      await user.click(navToggle)
      expect(navToggle).toHaveAttribute('aria-expanded', 'true')
      expect(referenceToggle).toHaveAttribute('aria-expanded', 'false')
    })
  })

  // Roadmap UI-04a.
  describe('nav drawer', () => {
    it('closes on Escape and returns focus to the hamburger', async () => {
      const user = userEvent.setup()
      render(<Shell />)

      const toggle = screen.getByRole('button', { name: 'Open navigation' })
      await user.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'true')

      await user.keyboard('{Escape}')

      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(toggle).toHaveFocus()
    })

    it('does not respond to Escape while closed', async () => {
      const user = userEvent.setup()
      render(<Shell />)

      const toggle = screen.getByRole('button', { name: 'Open navigation' })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')

      await user.keyboard('{Escape}')

      expect(toggle).toHaveAttribute('aria-expanded', 'false')
    })
  })

  // Roadmap UI-04a: the rail footer — current playing level + streak,
  // display only. A fresh app has no practice history and every track at
  // level 1 (`initialLevelState`), so this also proves a zero streak reads
  // as "No streak yet" (UI-21) rather than a "0-day streak" zero-row.
  it('shows the rail footer with the playing level and current streak', () => {
    render(<Shell />)
    expect(screen.getByText('Level 1 · No streak yet')).toBeInTheDocument()
  })

  // Roadmap UI-36: the action cluster (input-status chip + Reference toggle)
  // has exactly two possible homes — never both live at once — decided by
  // `useCompactShell()`'s live `matchMedia` read. Compact cases rely on
  // happy-dom's default 1024x768 viewport (no stub needed, matches every
  // other test in this file); desktop cases install `stubDesktopMatchMedia`
  // before render, since the compact/desktop decision is made on first
  // render, not after.
  describe('the action cluster', () => {
    it('mounts inside .topbar-actions, itself inside .app-topbar, at compact widths', () => {
      render(<Shell />)
      const chip = screen.getByRole('button', { name: /MIDI/i })
      const actions = chip.closest('.topbar-actions')
      expect(actions).not.toBeNull()
      expect(actions?.closest('.app-topbar')).not.toBeNull()

      const reference = screen.getByRole('button', { name: 'Reference' })
      expect(actions).toContainElement(reference)
      // The chip precedes Reference in DOM order within the cluster.
      expect(chip.compareDocumentPosition(reference) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(reference).not.toHaveClass('reference-toggle')
    })

    it('mounts inside .nav-actions, itself inside the rail footer, at desktop widths', () => {
      stubDesktopMatchMedia()
      render(<Shell />)

      // No topbar at all above 1024px — this task's own DOM-level proof.
      expect(document.querySelector('.app-topbar')).toBeNull()

      const chip = screen.getByRole('button', { name: /MIDI/i })
      const actions = chip.closest('.nav-actions')
      expect(actions).not.toBeNull()
      expect(actions?.closest('.nav-rail-footer')).not.toBeNull()

      const reference = screen.getByRole('button', { name: 'Reference' })
      expect(actions).toContainElement(reference)
      expect(chip.compareDocumentPosition(reference) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    // The single-instance rule (Shell.tsx's own module doc): `actions` is
    // built once and rendered from exactly one of two call sites, gated by
    // `compact ? ... : undefined` — never both, at either width.
    it.each([
      ['compact', () => {}],
      ['desktop', stubDesktopMatchMedia],
    ])('renders exactly one Reference toggle at %s widths', (_label, stub) => {
      stub()
      render(<Shell />)
      expect(screen.getAllByRole('button', { name: 'Reference' })).toHaveLength(1)
    })

    it('closes on Escape and returns focus to the visible Reference toggle at desktop widths too', async () => {
      stubDesktopMatchMedia()
      const user = userEvent.setup()
      render(<Shell />)

      const toggle = screen.getByRole('button', { name: 'Reference' })
      await user.click(toggle)
      expect(screen.getByRole('complementary', { name: /chord and scale reference/i })).toBeVisible()

      await user.keyboard('{Escape}')

      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(toggle).toHaveFocus()
    })
  })

  // Roadmap DR-01: the instrument switcher — shell chrome above the nav
  // proper, not a nav item itself. Full URL/deep-link/reload behaviour lives
  // in `route.test.ts`/`routing.test.ts` (pure) and the new e2e spec (real
  // browser); this only proves the wiring: the control renders, and clicking
  // it swaps the WHOLE nav and the routed screen together.
  describe('instrument switcher', () => {
    it('renders a Piano/Drums radiogroup with Piano selected by default', () => {
      render(<Shell />)
      const group = screen.getByRole('radiogroup', { name: 'Instrument' })
      expect(within(group).getByRole('radio', { name: 'Piano' })).toHaveAttribute(
        'aria-checked',
        'true',
      )
      expect(within(group).getByRole('radio', { name: 'Drums' })).toHaveAttribute(
        'aria-checked',
        'false',
      )
    })

    it('clicking Drums swaps the entire nav to the drums table and renders the drums home screen', async () => {
      const user = userEvent.setup()
      render(<Shell />)

      await user.click(screen.getByRole('radio', { name: 'Drums' }))

      expect(screen.getByRole('radio', { name: 'Drums' })).toHaveAttribute('aria-checked', 'true')
      // The whole piano nav table is gone, not merely unselected.
      expect(screen.queryByRole('button', { name: 'Practice' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Flashcards' })).toBeNull()
      expect(screen.getByRole('heading', { name: 'Drums — start here' })).toBeInTheDocument()
    })

    it('clicking Piano after Drums swaps back to the piano nav and Today', async () => {
      const user = userEvent.setup()
      render(<Shell />)

      await user.click(screen.getByRole('radio', { name: 'Drums' }))
      await user.click(screen.getByRole('radio', { name: 'Piano' }))

      expect(screen.getByRole('radio', { name: 'Piano' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('button', { name: 'Practice' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: "Today's session" })).toBeInTheDocument()
    })

    // Roadmap DR-01 design note: Drums has no per-instrument level concept
    // yet, so the rail footer shows the shared streak alone rather than
    // piano's `playingLevel` — a piano number would describe nothing here.
    it('omits the level from the rail footer while on Drums, keeping only the shared streak', async () => {
      const user = userEvent.setup()
      render(<Shell />)

      await user.click(screen.getByRole('radio', { name: 'Drums' }))

      expect(screen.getByText('No streak yet')).toBeInTheDocument()
      expect(screen.queryByText(/Level/)).not.toBeInTheDocument()
    })

    // Roadmap DR-01: the learner's last-used instrument persists (via
    // `useInstrumentStore`, wired through `persistence.ts` — see that
    // module's own round-trip tests) so a reload opens where they left off.
    // This only proves Shell.tsx's OWN half: a post-mount switch reaches the
    // store. The very first (mount-time) call is deliberately skipped — see
    // Shell.tsx's `didMountRef` comment — which this test also guards by
    // asserting the store is untouched immediately after the initial render.
    it('records the switch in useInstrumentStore, but not on initial mount', () => {
      render(<Shell />)
      expect(useInstrumentStore.getState().lastInstrument).toBe('piano')
    })

    it('records a Drums switch in useInstrumentStore', async () => {
      const user = userEvent.setup()
      render(<Shell />)

      await user.click(screen.getByRole('radio', { name: 'Drums' }))

      expect(useInstrumentStore.getState().lastInstrument).toBe('drums')
    })

    it('re-clicking the already-active instrument is a no-op (no navigation, no store write)', async () => {
      const user = userEvent.setup()
      render(<Shell />)

      await user.click(screen.getByRole('radio', { name: 'Piano' }))

      expect(useInstrumentStore.getState().lastInstrument).toBe('piano')
      expect(screen.getByRole('heading', { name: "Today's session" })).toBeInTheDocument()
    })
  })
})
