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

function renderScreen(
  screen: ScreenId,
  open: (exercise: Exercise) => void,
  technique: OpenedTechnique | undefined,
) {
  switch (screen) {
    case 'today':
      return <SessionPlanScreen onOpen={open} />
    case 'practice':
      return <ScoreScreen />
    case 'sight-reading':
      return <SightReadingScreen />
    case 'flashcards':
      return <FlashcardScreen />
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

  function open(exercise: Exercise): void {
    if (exercise.kind === 'technique') setTechnique(openedTechniqueOf(exercise))
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
      <main className="shell-main">{renderScreen(screen, open, technique)}</main>
    </div>
  )
}
