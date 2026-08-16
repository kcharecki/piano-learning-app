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
 * Every piano destination here renders a real screen; there are no
 * placeholders left on that side. "Today" (roadmap 4.7a) is the planned
 * practice session AND the default landing destination (roadmap 5.39) — it
 * is also the one destination that navigates to others — `destinationFor`
 * maps a planned exercise to the screen that runs it, which is why the nav
 * state lives here rather than inside that screen.
 *
 * Roadmap DR-01 added a second, disjoint instrument: the shell now holds two
 * independent nav tables (`PIANO_*`/`DRUMS_*`) and two independent screen
 * renderers, selected by `AppRoute.instrument` — never a single flat
 * `ScreenId` union across both, so a piano screen id can never leak into a
 * drums route or vice versa (see `route.ts`'s own module comment for why
 * that split lives at the type level, not just by convention). The switcher
 * itself is shell chrome (`switcher` below), not a nav item — it is what
 * decides which of the two nav tables `NavGroups` renders.
 */
import { InputCapabilityBanner } from '@app/shell/InputCapabilityBanner.tsx'
import { NavGroups, type NavGroup, type NavItem } from '@app/shell/NavGroups.tsx'
import type {
  DrumsScreenId,
  Instrument,
  PianoRoute,
  PianoScreenId,
} from '@app/shell/route.ts'
import { useRoute } from '@app/shell/routing.ts'
import { useInstrumentStore } from '@app/state/instrumentStore.ts'
import { DrumsTodayScreen } from '@app/drums/DrumsTodayScreen.tsx'
import { ReferencePanel } from '@app/reference/ReferencePanel.tsx'
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

// Typed against `PianoScreenId` (imported from `route.ts`, the router's
// single source of truth for what a piano "screen" is) rather than deriving
// it from this array, as it used to — a typo'd id here is now a compile
// error instead of silently widening the union. `icon` (roadmap UI-04a,
// 2026-08-12 UI audit) is the nav rail's 16px glyph per item — chosen for
// what the destination IS, not decoratively: sight-reading/theory/lessons
// all read music/learn from a page, so all three share `book`; flashcards
// and repertoire both share `cards` (repertoire's own choice per the task
// brief; flashcards is this session's judgement call — `SrsSummary.tsx`
// already uses `cards` for the same spaced-repetition/flip-card concept, so
// it is the closest existing match in the 24-name set, not a fresh
// invention).
const PIANO_NAV_ITEMS: readonly NavItem<PianoScreenId>[] = [
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

export type { PianoScreenId, DrumsScreenId }

/**
 * The grouped structure of `PIANO_NAV_ITEMS` (roadmap 5.43): Today stands
 * alone as the entry point; everything else falls into Practice / Learn /
 * Drills / Progress — the structure the app already has but 12 flat buttons
 * hid. Built by id lookup against `PIANO_NAV_ITEMS` rather than duplicating
 * labels, so the two can never disagree.
 */
function pianoNavItem(id: PianoScreenId): NavItem<PianoScreenId> {
  const item = PIANO_NAV_ITEMS.find((n) => n.id === id)
  // Programmer error only — every id passed here is a literal below, drawn
  // from PIANO_NAV_ITEMS itself.
  if (item === undefined) throw new Error(`no PIANO_NAV_ITEMS entry for "${id}"`)
  return item
}

const PIANO_NAV_PRIMARY: NavItem<PianoScreenId> = pianoNavItem('today')

const PIANO_NAV_GROUPS: readonly NavGroup<PianoScreenId>[] = [
  {
    label: 'Practice',
    items: [
      pianoNavItem('practice'),
      pianoNavItem('sight-reading'),
      pianoNavItem('repertoire'),
      pianoNavItem('metronome'),
    ],
  },
  { label: 'Learn', items: [pianoNavItem('lessons')] },
  {
    label: 'Drills',
    items: [
      pianoNavItem('flashcards'),
      pianoNavItem('ear-training'),
      pianoNavItem('rhythm'),
      pianoNavItem('technique'),
      pianoNavItem('theory'),
    ],
  },
  { label: 'Progress', items: [pianoNavItem('progress'), pianoNavItem('settings')] },
]

/**
 * Drums' own nav table (roadmap DR-01) — one destination so far
 * (`drums-today`, the placeholder home `DrumsTodayScreen` renders), no
 * groups yet. Grows per phase as drum features land; the type-level split
 * from `PIANO_NAV_ITEMS`/`PIANO_NAV_GROUPS` (see `route.ts`'s `DrumsScreenId`)
 * means adding a Drums screen can never accidentally collide with a piano one.
 */
const DRUMS_NAV_PRIMARY: NavItem<DrumsScreenId> = { id: 'drums-today', label: 'Today', icon: 'target' }
const DRUMS_NAV_GROUPS: readonly NavGroup<DrumsScreenId>[] = []

/**
 * Where a planned session item sends the learner (roadmap 4.7a). The plan is
 * built from what the app can actually open — see `@app/session/candidates.ts`,
 * which deliberately emits no exercise for a screen that does not exist — so
 * every kind here has a real destination. Piano-only: `Today`'s session plan
 * is a piano concept, so this always returns a `PianoScreenId`.
 */
function destinationFor(exercise: Exercise): PianoScreenId {
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
 * `PianoRoute` -> the shell's opened-drill state (roadmap 5.42): the inverse
 * of `routeFor` below. Used both for the route the app boots/reloads on and
 * for a `popstate` (Back/Forward) — the id embedded in the URL is
 * re-validated against the same library lookups
 * `openedTechniqueOf`/`DECK_KINDS`/`THEORY_KINDS` already use, so a stale or
 * hand-typed URL degrades to "no deep-link param" instead of crashing.
 */
function techniqueFromRoute(route: PianoRoute): OpenedTechnique | undefined {
  const id = route.params?.id
  if (route.screen !== 'technique' || id === undefined) return undefined
  const drill = techniqueDrillById(id)
  return drill === undefined
    ? undefined
    : { drillId: drill.id, level: route.params?.level ?? drill.level }
}

function deckFromRoute(route: PianoRoute): OpenedDeck | undefined {
  const id = route.params?.id
  if (route.screen !== 'flashcards' || id === undefined || !DECK_KINDS.has(id)) return undefined
  const level = route.params?.level
  return level === undefined ? { kind: id as DrillKind } : { kind: id as DrillKind, level }
}

function theoryDrillFromRoute(route: PianoRoute): OpenedTheoryDrill | undefined {
  const id = route.params?.id
  if (route.screen !== 'theory' || id === undefined || !THEORY_KINDS.has(id)) return undefined
  const level = route.params?.level
  return level === undefined
    ? { kind: id as TheoryQuizKind }
    : { kind: id as TheoryQuizKind, level }
}

/**
 * A destination screen plus the shell's opened-drill state -> the
 * `PianoRoute` that reaches it (the inverse of the three functions above).
 * Only the one matching `screen` ever contributes params — `open()` below
 * computes all three from a single exercise, but only the one the exercise
 * actually routes to is relevant.
 */
function routeFor(
  screen: PianoScreenId,
  technique: OpenedTechnique | undefined,
  deck: OpenedDeck | undefined,
  theoryDrill: OpenedTheoryDrill | undefined,
): PianoRoute {
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

function renderPianoScreen(
  screen: PianoScreenId,
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

/** Drums' own screen renderer (roadmap DR-01) — one case so far, grows per phase. */
function renderDrumsScreen(screen: DrumsScreenId) {
  switch (screen) {
    case 'drums-today':
      return <DrumsTodayScreen />
  }
}

const COMPACT_QUERY = '(max-width: 1024px)'

/**
 * Roadmap UI-36: whether the shell is currently in its ≤1024px "compact"
 * configuration — the one live signal that decides where the action cluster
 * (input-status chip + Reference toggle) mounts. Below this, `.app-nav` is a
 * drawer and the rail footer is off-canvas along with everything else in it,
 * so the cluster needs its own always-visible home: the topbar. Above it,
 * the rail is a static, always-visible sidebar, so the cluster rides in the
 * rail's own footer instead and the topbar does not render at all.
 *
 * `useState`'s initializer reads `matchMedia` synchronously so the FIRST
 * render already has the right answer (no flash of the wrong cluster home
 * before the effect below runs). happy-dom's default viewport is 1024x768,
 * so `window.matchMedia('(max-width: 1024px)').matches` is `true` by
 * default in every test that never stubs `matchMedia` — every existing unit
 * test keeps rendering the compact shell unchanged; desktop coverage has to
 * stub `matchMedia` explicitly (see Shell.test.tsx).
 */
function useCompactShell(): boolean {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_QUERY).matches)
  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY)
    setCompact(query.matches)
    const onChange = (e: MediaQueryListEvent): void => setCompact(e.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return compact
}

export function Shell() {
  // The route is the single source of navigation truth (roadmap 5.42, DR-01):
  // `instrument`/`screen`/`technique`/`deck`/`theoryDrill` are all derived
  // from it below, not separately tracked — so a direct reload, a deep link,
  // or a browser Back/Forward (both drive `appRoute` via `useRoute`'s
  // popstate listener) reproduce exactly the same shell state a click would
  // have, including which instrument's nav is showing.
  const { route: appRoute, navigate } = useRoute()
  // Roadmap UI-36: which of the two homes (topbar vs. rail footer) the
  // action cluster below renders into. See `useCompactShell`'s own comment.
  const compact = useCompactShell()
  const [navOpen, setNavOpen] = useState(false)
  // Roadmap 3.17: the reference panel's own open/closed flag — ephemeral
  // chrome, deliberately not derived from `route` (see ReferencePanel.tsx's
  // module doc on why this must never enter history).
  const [referenceOpen, setReferenceOpen] = useState(false)
  const referenceToggleRef = useRef<HTMLButtonElement>(null)
  const navToggleRef = useRef<HTMLButtonElement>(null)
  const navRef = useRef<HTMLElement>(null)

  const instrument = appRoute.instrument
  const technique =
    appRoute.instrument === 'piano' ? techniqueFromRoute(appRoute.route) : undefined
  const deck = appRoute.instrument === 'piano' ? deckFromRoute(appRoute.route) : undefined
  const theoryDrill =
    appRoute.instrument === 'piano' ? theoryDrillFromRoute(appRoute.route) : undefined

  // Roadmap UI-04a: the rail footer's "current level · streak" line —
  // display only. `playingLevel` is `useLevelStore`'s `playing` track read
  // directly; `streakDays` reuses `@core/progress/log.ts`'s
  // `currentStreakDays` over `useProgressStore`'s practice log, the exact
  // function `useDashboard.ts` already calls for the dashboard's own streak
  // line — not the whole (much heavier) dashboard hook, which also computes
  // technique/assessment/milestone trends this footer never shows. Streak
  // is shared across instruments (roadmap DR-01's spec); level is piano-only
  // — see `NavFooter.level`'s own doc for why Drums omits it rather than
  // showing a piano number that describes nothing on that side.
  const playingLevel = useLevelStore((s) => s.levelState.levels.playing)
  const practiceEntries = useProgressStore((s) => s.practiceEntries)
  const streakDays = useMemo(
    () => currentStreakDays(practiceEntries, Date.now(), -new Date().getTimezoneOffset()),
    [practiceEntries],
  )

  // Roadmap DR-01: persist the learner's last-used instrument so a reload
  // opens where they left off. Skips its own first invocation via
  // `didMountRef` — writing on the very first render would race `App.tsx`'s
  // async `restoreSession`, which has not yet applied IndexedDB's own
  // restored value at that point (see `persistence.ts`'s mandatory
  // "restore before persisting" ordering, and `instrumentStore.ts`'s module
  // comment for the fuller reasoning). Every instrument transition AFTER
  // mount is tracked — whether the switcher, a deep link, or a Back/Forward
  // that lands in the other instrument's namespace — not only explicit
  // switcher clicks, on the view that "where the URL took the learner" is
  // what "last-used" means, same as every other route-driven persistence in
  // this app.
  const didMountRef = useRef(false)
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true
      return
    }
    useInstrumentStore.getState().setLastInstrument(instrument)
  }, [instrument])

  function open(exercise: Exercise): void {
    const nextScreen = destinationFor(exercise)
    const nextTechnique = exercise.kind === 'technique' ? openedTechniqueOf(exercise) : undefined
    const nextDeck = exercise.kind === 'theory-quiz' ? openedDeckOf(exercise) : undefined
    const nextTheoryDrill =
      exercise.kind === 'theory-quiz' ? openedTheoryDrillOf(exercise) : undefined
    navigate({
      instrument: 'piano',
      route: routeFor(nextScreen, nextTechnique, nextDeck, nextTheoryDrill),
    })
  }

  function goToPiano(id: PianoScreenId): void {
    navigate({ instrument: 'piano', route: { screen: id } })
    setNavOpen(false)
  }

  function goToDrums(id: DrumsScreenId): void {
    navigate({ instrument: 'drums', route: { screen: id } })
    setNavOpen(false)
  }

  /** The switcher's own click handler (roadmap DR-01) — a no-op re-click of the already-active instrument never navigates. */
  function switchInstrument(next: Instrument): void {
    if (next === instrument) return
    if (next === 'piano') goToPiano('today')
    else goToDrums('drums-today')
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

  // a11y sweep (2026-08): Tab-cycling focus trap for the drawer — deliberately
  // held back until now because it needs viewport awareness, which this gets
  // by re-checking the media query INSIDE the handler on every Tab press
  // rather than caching a yes/no at mount. `.app-nav` is only ever a drawer
  // OVER content at <=1024px (responsive.css's own breakpoint, matched here
  // verbatim); at every wider viewport the identical markup is a static
  // sidebar next to `<main>`, and trapping Tab there would strand a keyboard
  // user inside the rail, unable to ever reach the score/flashcard/whatever
  // screen it sits beside. Re-checking live (rather than only when `navOpen`
  // flips) also means a mid-open resize — e.g. a tablet rotated from portrait
  // to landscape, or a window dragged wider — updates the trap immediately
  // instead of leaving it wired to whatever width was current when the
  // drawer opened.
  //
  // Scoped to `.app-nav`'s own focusable elements only (not the hamburger).
  // Roadmap UI-36: the action cluster (input-status chip + Reference toggle)
  // used to be a permanent sibling of this query's target regardless of
  // width; now it is rendered EITHER inside `.app-topbar` (compact) OR
  // inside `.app-nav` itself (desktop, `.nav-actions` in the rail footer) —
  // never both. This trap only ever runs at <=1024px (the live matchMedia
  // check below), and at that width the cluster lives in the topbar, not
  // the rail, so `nav.querySelectorAll(...)` below still only ever collects
  // the rail's OWN focusable items (the switcher, primary + groups), exactly
  // as before — the one-instance rule (see `useCompactShell`) is what keeps
  // that true without this query needing to exclude anything by hand. The
  // topbar itself remains its own separately reachable, still-visible chrome
  // (one tier above the drawer, see responsive.css) and stays outside the
  // drawer this trap is about. The mechanism only engages once focus is
  // actually somewhere inside the drawer (first/last-element wraparound) —
  // it does not forcibly move focus into the drawer on open, matching
  // Escape/close above, which returns focus to the hamburger rather than
  // assuming the drawer was ever entered.
  useEffect(() => {
    if (!navOpen) return
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Tab') return
      if (!window.matchMedia('(max-width: 1024px)').matches) return
      const nav = navRef.current
      if (nav === null) return
      const focusable = Array.from(
        nav.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (first === undefined || last === undefined) return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [navOpen])

  const activeLabel =
    appRoute.instrument === 'piano'
      ? (PIANO_NAV_ITEMS.find((item) => item.id === appRoute.route.screen)?.label ?? '')
      : DRUMS_NAV_PRIMARY.label

  // Roadmap DR-01: the Piano/Drums switcher — shell chrome, not a nav item
  // (see the module comment). `.seg-control` (primitives.css) is the same
  // bordered-radiogroup primitive `HandMuteControl.tsx` already uses; a
  // re-click of the already-active option is a no-op via `switchInstrument`.
  const switcher = (
    <div className="seg-control instrument-switcher" role="radiogroup" aria-label="Instrument">
      <button
        type="button"
        role="radio"
        aria-checked={instrument === 'piano'}
        onClick={() => switchInstrument('piano')}
      >
        Piano
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={instrument === 'drums'}
        onClick={() => switchInstrument('drums')}
      >
        Drums
      </button>
    </div>
  )

  // Roadmap UI-36: the action cluster — input-status chip, then Reference —
  // is ONE JSX expression, rendered in exactly one of the two homes below,
  // never both. That single-instance rule is what lets `referenceToggleRef`
  // keep pointing at a real, visible button at every width: two separately
  // rendered copies would leave the ref attached to whichever button mounted
  // last, silently pointing at a hidden element the other half of the time.
  // Its own class name switches with `compact` (`.topbar-actions` vs.
  // `.nav-actions`) since the two homes lay it out differently — a row
  // flush right in the topbar, a column of full-width rows in the rail
  // footer (feature-nav-groups.css).
  //
  // Crossing the breakpoint unmounts and remounts `InputCapabilityBanner`
  // along with the rest of this cluster (React tears down the whole subtree
  // when it moves from the topbar branch to the `NavGroups` `actions` prop,
  // even though both renders come from this same expression) — its own
  // `open` popover state is lost, so a popover left open mid-resize closes.
  // Nothing about an in-progress Bluetooth MIDI pairing is lost with it: the
  // GATT connection and its device state live in `useBluetoothMidi.ts`'s
  // module-scope singleton, not in this subtree, so a remount here just
  // resubscribes to whatever that singleton already holds.
  const actions = (
    <div className={compact ? 'topbar-actions' : 'nav-actions'}>
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
  )

  return (
    <div className="app-layout">
      {/* Roadmap UI-36: `.app-topbar` only exists in the DOM at all at
          <=1024px now — desktop's version of this bar (roadmap UI-04a) was
          deleted outright once its one real cost (a permanent 56px band of
          nothing between the topbar and the sticky rail on any scrolled
          desktop page — see base.css's UI-04a comment for the measured
          argument) turned out to have no fix that did not also delete it.
          The hamburger and screen title are still ≤1024px-only content; the
          action cluster used to render unconditionally in this same slot —
          it now renders here ONLY while compact, and inside the rail footer
          otherwise (below). */}
      {compact && (
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
          {actions}
        </div>
      )}
      {navOpen && <div className="nav-scrim" aria-hidden="true" onClick={closeNav} />}
      <nav className="app-nav" aria-label="Main" data-open={navOpen} ref={navRef}>
        {appRoute.instrument === 'piano' ? (
          <NavGroups<PianoScreenId>
            primary={PIANO_NAV_PRIMARY}
            groups={PIANO_NAV_GROUPS}
            activeScreen={appRoute.route.screen}
            onNavigate={goToPiano}
            footer={{ level: playingLevel, streakDays }}
            switcher={switcher}
            actions={compact ? undefined : actions}
          />
        ) : (
          <NavGroups<DrumsScreenId>
            primary={DRUMS_NAV_PRIMARY}
            groups={DRUMS_NAV_GROUPS}
            activeScreen={appRoute.route.screen}
            onNavigate={goToDrums}
            footer={{ streakDays }}
            switcher={switcher}
            actions={compact ? undefined : actions}
          />
        )}
      </nav>
      <main className="app-main">
        {/* Roadmap 5.40's OnboardingGateway used to render here, gated on
            `screen === 'today'`. UI-08 moved it into SessionPlanScreen: the
            callout must hide while a session is running, and only that screen
            knows whether one is — finding out here would mean calling
            useSessionRun a second time against the same persisted run. See
            that file for the full argument. */}
        {appRoute.instrument === 'piano'
          ? renderPianoScreen(
              appRoute.route.screen,
              open,
              () => goToPiano('practice'),
              () => goToPiano('today'),
              technique,
              deck,
              theoryDrill,
            )
          : renderDrumsScreen(appRoute.route.screen)}
      </main>
      {/* Sibling AFTER app-main, never a wrapper around it and never a layout
          column (module doc + parallel-round-10.md Q2) — position:fixed, so
          app-main's own box is untouched by this element's presence. */}
      <ReferencePanel open={referenceOpen} onClose={closeReference} />
    </div>
  )
}
