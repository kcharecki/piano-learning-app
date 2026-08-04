/**
 * App shell (roadmap 1.17, REQ-4.6): a left nav and a main area. A single-user
 * app with this handful of destinations doesn't need a router library —
 * `useState` is the boring, maintainable choice. (The count used to be written
 * out here as "six" and had been wrong for several sessions; a number that
 * has to be maintained by hand is not worth the sentence.)
 *
 * Every destination here renders a real screen; there are no placeholders
 * left. "Today" (roadmap 4.7a) is the planned practice session, and it is the
 * one destination that navigates to others — `destinationFor` maps a planned
 * exercise to the screen that runs it, which is why the nav state lives here
 * rather than inside that screen.
 */
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
import type { Exercise } from '@core/curriculum/types.ts'
import { techniqueDrillById } from '@core/technique/library.ts'
import { useState } from 'react'

const NAV_ITEMS = [
  { id: 'today', label: 'Today' },
  { id: 'lessons', label: 'Lessons' },
  { id: 'practice', label: 'Practice' },
  { id: 'sight-reading', label: 'Sight reading' },
  { id: 'flashcards', label: 'Flashcards' },
  { id: 'ear-training', label: 'Ear training' },
  { id: 'rhythm', label: 'Rhythm' },
  { id: 'technique', label: 'Technique' },
  { id: 'metronome', label: 'Metronome' },
  { id: 'theory', label: 'Theory' },
  { id: 'repertoire', label: 'Repertoire' },
  { id: 'progress', label: 'Progress' },
] as const

export type ScreenId = (typeof NAV_ITEMS)[number]['id']

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
      return 'flashcards'
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

function renderScreen(
  screen: ScreenId,
  open: (exercise: Exercise) => void,
  technique: OpenedTechnique | undefined,
  deck: OpenedDeck | undefined,
) {
  switch (screen) {
    case 'today':
      return <SessionPlanScreen onOpen={open} />
    case 'lessons':
      return <LessonsScreen onOpen={open} />
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
      return <TheoryScreen />
    case 'repertoire':
      return <RepertoireScreen />
    case 'progress':
      return <DashboardScreen />
  }
}

export function Shell() {
  const [screen, setScreen] = useState<ScreenId>('practice')
  const [technique, setTechnique] = useState<OpenedTechnique | undefined>(undefined)
  const [deck, setDeck] = useState<OpenedDeck | undefined>(undefined)

  function open(exercise: Exercise): void {
    if (exercise.kind === 'technique') setTechnique(openedTechniqueOf(exercise))
    if (exercise.kind === 'theory-quiz') setDeck(openedDeckOf(exercise))
    setScreen(destinationFor(exercise))
  }

  return (
    <div className="shell">
      <nav className="shell-nav" aria-label="Main">
        <ul>
          {NAV_ITEMS.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-current={screen === item.id ? 'page' : undefined}
                className={screen === item.id ? 'active' : undefined}
                onClick={() => setScreen(item.id)}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <main className="shell-main">{renderScreen(screen, open, technique, deck)}</main>
    </div>
  )
}
