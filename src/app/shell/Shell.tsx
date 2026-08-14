/**
 * App shell (roadmap 1.17, REQ-4.6): a grouped nav (5.43) and a main area,
 * navigated by a hand-rolled URL router (5.42, `@app/shell/routing.ts` +
 * `@app/shell/route.ts`) instead of bare `useState`. The route IS the
 * source of navigation truth now: `screen`/`technique`/`deck`/`theoryDrill`
 * below are all derived from it, not separately tracked state, so a
 * `popstate` (Back/Forward) or a direct reload lands on exactly what the
 * URL names. (The nav item count used to be written out here as "six" and
 * had been wrong for several sessions; a number that has to be maintained
 * by hand is not worth the sentence — it isn't written out at all now.)
 *
 * Every destination here renders a real screen; there are no placeholders
 * left. "Today" (roadmap 4.7a) is the planned practice session AND the
 * default landing destination (roadmap 5.39) — it is also the one
 * destination that navigates to others — `destinationFor` maps a planned
 * exercise to the screen that runs it, which is why the nav state lives here
 * rather than inside that screen.
 */
import { InputCapabilityBanner } from '@app/shell/InputCapabilityBanner.tsx'
import { NavGroups, type NavGroup, type NavItem } from '@app/shell/NavGroups.tsx'
import type { Route, ScreenId } from '@app/shell/route.ts'
import { useRoute } from '@app/shell/routing.ts'
import { ReferencePanel } from '@app/reference/ReferencePanel.tsx'
import { OnboardingGateway } from '@app/onboarding/OnboardingGateway.tsx'
import { SettingsScreen } from '@app/onboarding/SettingsScreen.tsx'
import { ScoreScreen } from '@app/score/ScoreScreen.tsx'
import { DashboardScreen } from '@app/dashboard/DashboardScreen.tsx'
import { FlashcardScreen } from '@app/drills/FlashcardScreen.tsx'
import type { DrillKind } from '@app/drills/useFlashcardDrill.ts'
import { LessonsScreen } from '@app/lessons/LessonsScreen.tsx'
import { EarTrainingScreen } from '@app/eartraining/EarTrainingScreen.tsx'
import { MetronomeScreen } from '@app/metronome/MetronomeScreen.tsx'
import { RepertoireScreen } from '@app/repertoire/RepertoireScreen.tsx'
import { RhythmScreen } from '@app/rhythm/RhythmScreen.tsx'
import { SessionPlanScreen } from '@app/session/SessionPlanScreen.tsx'
import { SightReadingScreen } from '@app/sightreading/SightReadingScreen.tsx'
import { TechniqueScreen } from '@app/technique/TechniqueScreen.tsx'
import { TheoryScreen } from '@app/theory/TheoryScreen.tsx'
import { useLevelStore } from '@app/state/levelStore.ts'
import { useProgressStore } from '@app/state/progressStore.ts'
import { currentStreakDays } from '@core/progress/log.ts'
import type { Exercise } from '@core/curriculum/types.ts'
import { ALL_THEORY_KINDS, type TheoryQuizKind } from '@core/drills/theory.ts'
import { techniqueDrillById } from '@core/technique/library.ts'
import { useEffect, useMemo, useRef, useState } from 'react'

// Typed against `ScreenId` (imported from `route.ts`, the router's single
// source of truth for what a "screen" is) rather than deriving it from this
// array, as it used to — a typo'd id here is now a compile error instead of
// silently widening the union. `icon` (roadmap UI-04a, 2026-08-12 UI audit)
// is the nav rail's 16px glyph per item — chosen for what the destination
// IS, not decoratively: sight-reading/theory/lessons all read music/learn
// from a page, so all three share `book`; flashcards and repertoire both
// share `cards` (repertoire's own choice per the task brief; flashcards is
// this session's judgement call — `SrsSummary.tsx` already uses `cards` for
// the same spaced-repetition/flip-card concept, so it is the closest
// existing match in the 24-name set, not a fresh invention).
const NAV_ITEMS: readonly NavItem[] = [
  { id: 'today', label: 'Today', icon: 'target' },
  { id: 'lessons', label: 'Lessons', icon: 'book' },
  { id: 'practice', label: 'Practice', icon: 'keyboard' },
  { id: 'sight-reading', label: 'Sight reading', icon: 'book' },
  { id: 'flashcards', label: 'Flashcards', icon: 'cards' },
  { id: 'ear-training', label: 'Ear training', icon: 'ear' },
  { id: 'rhythm', label: 'Rhythm', icon: 'rhythm' },
  { id: 'technique', label: 'Technique', icon: 'hand' },
  { id: 'metronome', label: 'Metronome', icon: 'metronome' },
  { id: 'theory', label: 'Theory', icon: 'book' },
  { id: 'repertoire', label: 'Repertoire', icon: 'cards' },
  { id: 'progress', label: 'Progress', icon: 'chart' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]

export type { ScreenId }

/**
 * The grouped structure of `NAV_ITEMS` (roadmap 5.43): Today stands alone as
 * the entry point; everything else falls into Practice / Learn / Drills /
 * Progress — the structure the app already has but 12 flat buttons hid.
 * Built by id lookup against `NAV_ITEMS` rather than duplicating labels, so
 * the two can never disagree.
 */
function navItem(id: ScreenId): NavItem {
  const item = NAV_ITEMS.find((n) => n.id === id)
  // Programmer error only — every id passed here is a literal below, drawn
  // from NAV_ITEMS itself.
  if (item === undefined) throw new Error(`no NAV_ITEMS entry for "${id}"`)
  return item
}

const NAV_PRIMARY: NavItem = navItem('today')

const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'Practice',
    items: [
      navItem('practice'),
      navItem('sight-reading'),
      navItem('repertoire'),
      navItem('metronome'),
    ],
  },
  { label: 'Learn', items: [navItem('lessons')] },
  {
    label: 'Drills',
    items: [
      navItem('flashcards'),
      navItem('ear-training'),
      navItem('rhythm'),
      navItem('technique'),
      navItem('theory'),
    ],
  },
  { label: 'Progress', items: [navItem('progress'), navItem('settings')] },
]

/**
 * Where a planned session item sends the learner (roadmap 4.7a). The plan is
 * built from what the app can actually open — see `@app/session/candidates.ts`,
 * which deliberately emits no exercise for a screen that does not exist — so
 * every kind here has a real destination.
 */
function destinationFor(exercise: Exercise): ScreenId {
  switch (exercise.kind) {
    case 'sight-read':
      return 'sight-reading'
    case 'theory-quiz':
      // A quiz whose topic no flashcard deck covers (triads, inversions,
      // cadences) names a `TheoryQuizKind` and belongs on the MIDI-answered
      // theory drill instead (roadmap 3.12).
      return openedTheoryDrillOf(exercise) === undefined ? 'flashcards' : 'theory'
    case 'ear-training':
      return 'ear-training'
    case 'technique':
      return 'technique'
    case 'play':
    case 'repertoire':
      return 'practice'
  }
}

/**
 * The technique drill a planned session item asked for (roadmap 2.34). The
 * plan names a `drillId`; the screen also needs the level that drill lives at,
 * because `useTechniqueDrill` builds its picker from `techniqueLibrary(level)`
 * and would drop an id that is not in that level's list.
 */
type OpenedTechnique = { readonly drillId: string; readonly level: number }

/** The planned drill, if this exercise names one the library actually knows. */
function openedTechniqueOf(exercise: Exercise): OpenedTechnique | undefined {
  const drillId = exercise.params?.['drillId']
  const drill = typeof drillId === 'string' ? techniqueDrillById(drillId) : undefined
  return drill === undefined ? undefined : { drillId: drill.id, level: drill.level }
}

/**
 * The flashcard deck a planned item asked for (roadmap 4.9c). `candidates.ts`
 * emits decks with `params.drillKind`, and a curriculum theory quiz names one
 * too; without this every one of them opened the note-naming deck whatever its
 * title promised.
 *
 * The membership test is over the whole `FlashcardKind` union deliberately
 * (roadmap 3.11). This was a two-way `===` chain while the curriculum had
 * already been retargeted at all four decks, so the seven lessons naming
 * `note-name` or `key-signature` fell through to `undefined` and opened the
 * default staff-to-key deck — the exact dishonest-title defect the retarget
 * was meant to remove, made invisible by a silent fallback.
 */
const DECK_KINDS: ReadonlySet<string> = new Set<DrillKind>([
  'staff-to-key',
  'interval-on-staff',
  'note-name',
  'key-signature',
])

/** The deck a planned item opens, and the level it opens at if it named one. */
type OpenedDeck = { readonly kind: DrillKind; readonly level?: number }

function openedDeckOf(exercise: Exercise): OpenedDeck | undefined {
  const kind = exercise.params?.['drillKind']
  if (typeof kind !== 'string' || !DECK_KINDS.has(kind)) return undefined
  const level = openedDeckLevelOf(exercise)
  return level === undefined ? { kind: kind as DrillKind } : { kind: kind as DrillKind, level }
}

/**
 * The deck level a planned item asked for, if it named one (roadmap 3.11).
 * A quiz titled "identify fourths and fifths" needs level 2+, because the
 * level-1 interval deck holds only seconds and thirds; the circle-of-fifths
 * quiz needs level 7 to see the whole circle. `FlashcardScreen` clamps.
 */
function openedDeckLevelOf(exercise: Exercise): number | undefined {
  const level = exercise.params?.['drillLevel']
  return typeof level === 'number' && Number.isFinite(level) ? level : undefined
}

/**
 * The theory drill a planned item asked for (roadmap 3.12). `drillKind` carries
 * either a flashcard deck or a `TheoryQuizKind`; the two unions are disjoint, so
 * which one it names is what decides the destination. `drillLevel` is shared
 * with the deck case and clamped by the panel.
 */
type OpenedTheoryDrill = { readonly kind: TheoryQuizKind; readonly level?: number }

const THEORY_KINDS: ReadonlySet<string> = new Set<TheoryQuizKind>(ALL_THEORY_KINDS)

function openedTheoryDrillOf(exercise: Exercise): OpenedTheoryDrill | undefined {
  const kind = exercise.params?.['drillKind']
  if (typeof kind !== 'string' || !THEORY_KINDS.has(kind)) return undefined
  const level = openedDeckLevelOf(exercise)
  return level === undefined
    ? { kind: kind as TheoryQuizKind }
    : { kind: kind as TheoryQuizKind, level }
}

/**
 * `Route` -> the shell's opened-drill state (roadmap 5.42): the inverse of
 * `routeFor` below. Used both for the route the app boots/reloads on and for
 * a `popstate` (Back/Forward) — the id embedded in the URL is re-validated
 * against the same library lookups `openedTechniqueOf`/`DECK_KINDS`/
 * `THEORY_KINDS` already use, so a stale or hand-typed URL degrades to "no
 * deep-link param" instead of crashing.
 */
function techniqueFromRoute(route: Route): OpenedTechnique | undefined {
  const id = route.params?.id
  if (route.screen !== 'technique' || id === undefined) return undefined
  const drill = techniqueDrillById(id)
  return drill === undefined
    ? undefined
    : { drillId: drill.id, level: route.params?.level ?? drill.level }
}

function deckFromRoute(route: Route): OpenedDeck | undefined {
  const id = route.params?.id
  if (route.screen !== 'flashcards' || id === undefined || !DECK_KINDS.has(id)) return undefined
  const level = route.params?.level
  return level === undefined ? { kind: id as DrillKind } : { kind: id as DrillKind, level }
}

function theoryDrillFromRoute(route: Route): OpenedTheoryDrill | undefined {
  const id = route.params?.id
  if (route.screen !== 'theory' || id === undefined || !THEORY_KINDS.has(id)) return undefined
  const level = route.params?.level
  return level === undefined
    ? { kind: id as TheoryQuizKind }
    : { kind: id as TheoryQuizKind, level }
}

/**
 * A destination screen plus the shell's opened-drill state -> the `Route`
 * that reaches it (the inverse of the three functions above). Only the one
 * matching `screen` ever contributes params — `open()` below computes all
 * three from a single exercise, but only the one the exercise actually
 * routes to is relevant.
 */
function routeFor(
  screen: ScreenId,
  technique: OpenedTechnique | undefined,
  deck: OpenedDeck | undefined,
  theoryDrill: OpenedTheoryDrill | undefined,
): Route {
  if (screen === 'technique' && technique !== undefined) {
    return { screen, params: { id: technique.drillId, level: technique.level } }
  }
  if (screen === 'flashcards' && deck !== undefined) {
    return deck.level === undefined
      ? { screen, params: { id: deck.kind } }
      : { screen, params: { id: deck.kind, level: deck.level } }
  }
  if (screen === 'theory' && theoryDrill !== undefined) {
    return theoryDrill.level === undefined
      ? { screen, params: { id: theoryDrill.kind } }
      : { screen, params: { id: theoryDrill.kind, level: theoryDrill.level } }
  }
  return { screen }
}

function renderScreen(
  screen: ScreenId,
  open: (exercise: Exercise) => void,
  goToPractice: () => void,
  goToToday: () => void,
  technique: OpenedTechnique | undefined,
  deck: OpenedDeck | undefined,
  theoryDrill: OpenedTheoryDrill | undefined,
) {
  switch (screen) {
    case 'today':
      return <SessionPlanScreen onOpen={open} />
    case 'lessons':
      return <LessonsScreen onOpen={open} onOpenDemo={goToPractice} />
    case 'practice':
      return <ScoreScreen />
    case 'sight-reading':
      return <SightReadingScreen />
    case 'flashcards':
      // `key` for the same reason the technique case has one: `initialKind`
      // and `initialLevel` only seed `useState`, so a second Today → Flashcards
      // hop naming a different deck or level would otherwise be ignored.
      return deck === undefined ? (
        <FlashcardScreen />
      ) : deck.level === undefined ? (
        <FlashcardScreen key={deck.kind} initialKind={deck.kind} />
      ) : (
        <FlashcardScreen
          key={`${deck.kind}:${deck.level}`}
          initialKind={deck.kind}
          initialLevel={deck.level}
        />
      )
    case 'ear-training':
      return <EarTrainingScreen />
    case 'rhythm':
      return <RhythmScreen />
    case 'technique':
      // `key` remounts the screen when the plan names a different drill, so
      // `initialDrillId`/`initialLevel` (read once into `useState`) are
      // re-read instead of being ignored on a second Today → Technique hop.
      return technique === undefined ? (
        <TechniqueScreen />
      ) : (
        <TechniqueScreen
          key={technique.drillId}
          initialDrillId={technique.drillId}
          initialLevel={technique.level}
        />
      )
    case 'metronome':
      return <MetronomeScreen />
    case 'theory':
      // `key` for the same reason the technique and flashcard cases have one:
      // the panel's `initialKind`/`initialLevel` only seed `useState`, so a
      // second Today → Theory hop naming a different topic would be ignored.
      return theoryDrill === undefined ? (
        <TheoryScreen />
      ) : theoryDrill.level === undefined ? (
        <TheoryScreen key={theoryDrill.kind} initialDrillKind={theoryDrill.kind} />
      ) : (
        <TheoryScreen
          key={`${theoryDrill.kind}:${theoryDrill.level}`}
          initialDrillKind={theoryDrill.kind}
          initialDrillLevel={theoryDrill.level}
        />
      )
    case 'repertoire':
      return <RepertoireScreen onOpenInPractice={goToPractice} />
    case 'progress':
      return <DashboardScreen />
    case 'settings':
      return <SettingsScreen onGoToToday={goToToday} />
  }
}

export function Shell() {
  // The route is the single source of navigation truth (roadmap 5.42):
  // `screen`/`technique`/`deck`/`theoryDrill` are all derived from it below,
  // not separately tracked — so a direct reload, a deep link, or a browser
  // Back/Forward (both drive `route` via `useRoute`'s popstate listener)
  // reproduce exactly the same shell state a click would have.
  const { route, navigate } = useRoute()
  const [navOpen, setNavOpen] = useState(false)
  // Roadmap 3.17: the reference panel's own open/closed flag — ephemeral
  // chrome, deliberately not derived from `route` (see ReferencePanel.tsx's
  // module doc on why this must never enter history).
  const [referenceOpen, setReferenceOpen] = useState(false)
  const referenceToggleRef = useRef<HTMLButtonElement>(null)
  const navToggleRef = useRef<HTMLButtonElement>(null)

  const screen = route.screen
  const technique = techniqueFromRoute(route)
  const deck = deckFromRoute(route)
  const theoryDrill = theoryDrillFromRoute(route)

  // Roadmap UI-04a: the rail footer's "current level · streak" line —
  // display only. `playingLevel` is `useLevelStore`'s `playing` track read
  // directly; `streakDays` reuses `@core/progress/log.ts`'s
  // `currentStreakDays` over `useProgressStore`'s practice log, the exact
  // function `useDashboard.ts` already calls for the dashboard's own streak
  // line — not the whole (much heavier) dashboard hook, which also computes
  // technique/assessment/milestone trends this footer never shows.
  const playingLevel = useLevelStore((s) => s.levelState.levels.playing)
  const practiceEntries = useProgressStore((s) => s.practiceEntries)
  const streakDays = useMemo(
    () => currentStreakDays(practiceEntries, Date.now(), -new Date().getTimezoneOffset()),
    [practiceEntries],
  )

  function open(exercise: Exercise): void {
    const nextScreen = destinationFor(exercise)
    const nextTechnique = exercise.kind === 'technique' ? openedTechniqueOf(exercise) : undefined
    const nextDeck = exercise.kind === 'theory-quiz' ? openedDeckOf(exercise) : undefined
    const nextTheoryDrill =
      exercise.kind === 'theory-quiz' ? openedTheoryDrillOf(exercise) : undefined
    navigate(routeFor(nextScreen, nextTechnique, nextDeck, nextTheoryDrill))
  }

  function goTo(id: ScreenId): void {
    navigate({ screen: id })
    setNavOpen(false)
  }

  // Roadmap 3.17: the nav drawer and the reference drawer are mutually
  // exclusive at <=1024px (their scrims must never stack) — opening either
  // one closes the other. At wider viewports this toggling is harmless (the
  // nav is a static sidebar there, not a drawer, and `navOpen` only matters
  // for the drawer's own CSS state).
  function toggleNav(): void {
    setNavOpen((v) => {
      const next = !v
      if (next) setReferenceOpen(false)
      return next
    })
  }

  function toggleReference(): void {
    setReferenceOpen((v) => {
      const next = !v
      if (next) setNavOpen(false)
      return next
    })
  }

  // Escape/scrim close AND the return-focus-to-toggle behaviour the proof
  // action requires — ReferencePanel itself never touches the toggle button.
  function closeReference(): void {
    setReferenceOpen(false)
    referenceToggleRef.current?.focus()
  }

  // Roadmap UI-04a: the same contract as `closeReference` above, for the nav
  // drawer's own scrim/Escape close.
  function closeNav(): void {
    setNavOpen(false)
    navToggleRef.current?.focus()
  }

  // Roadmap UI-04a: Escape closes the narrow-width nav drawer and returns
  // focus to the hamburger — only wired while the drawer is actually open,
  // so this never fires at >1024px (where `.nav-toggle` itself is hidden —
  // see base.css — and `.app-nav` is a static sidebar, not a drawer).
  useEffect(() => {
    if (!navOpen) return
    // Inlined rather than calling `closeNav` (a new function identity every
    // render): `setNavOpen`/`navToggleRef` are both stable across renders,
    // so this effect's only real dependency is `navOpen` itself.
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setNavOpen(false)
        navToggleRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [navOpen])

  const activeLabel = NAV_ITEMS.find((item) => item.id === screen)?.label ?? ''

  return (
    <div className="app-layout">
      {/* Roadmap UI-04a: still `.app-layout`'s first child (unchanged DOM
          position), but no longer `display: none` above 1024px — base.css
          gives `.app-layout` `flex-wrap: wrap` and this element `flex-basis:
          100%`, so it now always occupies a full-width row of its own above
          nav+main (which still fit together on the row below, exactly as
          before) instead of either being hidden or squeezed in sideways next
          to the nav column. See base.css's own comment for the full "why"
          and for the `.app-nav` top/height compensation this displaces. */}
      <div className="app-topbar">
        <button
          type="button"
          ref={navToggleRef}
          className="nav-toggle btn-icon"
          aria-label="Open navigation"
          aria-expanded={navOpen}
          onClick={toggleNav}
        >
          ☰
        </button>
        <p className="screen-title">{activeLabel}</p>
        {/* Roadmap UI-04a: the right-aligned action cluster — a normal
            topbar citizen now, never `position: fixed`. Roadmap UI-04b: the
            input-status chip mounts here, before the Reference button — its
            one home now, replacing the in-flow banner that used to render at
            the top of `<main>` (and, before that, at the top of seven
            separate screens). */}
        <div className="topbar-actions">
          <InputCapabilityBanner />
          <button
            type="button"
            ref={referenceToggleRef}
            className="btn-ghost"
            aria-expanded={referenceOpen}
            aria-controls="reference-panel"
            onClick={toggleReference}
          >
            Reference
          </button>
        </div>
      </div>
      {navOpen && <div className="nav-scrim" aria-hidden="true" onClick={closeNav} />}
      <nav className="app-nav" aria-label="Main" data-open={navOpen}>
        <NavGroups
          primary={NAV_PRIMARY}
          groups={NAV_GROUPS}
          activeScreen={screen}
          onNavigate={goTo}
          footer={{ level: playingLevel, streakDays }}
        />
      </nav>
      <main className="app-main">
        {/* Roadmap 5.40: purely additive, only ever on Today, only until
            completed/skipped — see OnboardingGateway.tsx's module doc for why
            this is a callout rather than a hard gate. */}
        <OnboardingGateway show={screen === 'today'} />
        {renderScreen(
          screen,
          open,
          () => goTo('practice'),
          () => goTo('today'),
          technique,
          deck,
          theoryDrill,
        )}
      </main>
      {/* Sibling AFTER app-main, never a wrapper around it and never a layout
          column (module doc + parallel-round-10.md Q2) — position:fixed, so
          app-main's own box is untouched by this element's presence. */}
      <ReferencePanel open={referenceOpen} onClose={closeReference} />
    </div>
  )
}
