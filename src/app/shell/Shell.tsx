/**
 * App shell (roadmap 1.17, REQ-4.6): a left nav and a main area. A single-user
 * app with six destinations doesn't need a router library — `useState` is
 * the boring, maintainable choice.
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
import { RhythmScreen } from '@app/rhythm/RhythmScreen.tsx'
import { SessionPlanScreen } from '@app/session/SessionPlanScreen.tsx'
import { SightReadingScreen } from '@app/sightreading/SightReadingScreen.tsx'
import { TheoryScreen } from '@app/theory/TheoryScreen.tsx'
import type { Exercise } from '@core/curriculum/types.ts'
import { useState } from 'react'

const NAV_ITEMS = [
  { id: 'today', label: 'Today' },
  { id: 'practice', label: 'Practice' },
  { id: 'sight-reading', label: 'Sight reading' },
  { id: 'flashcards', label: 'Flashcards' },
  { id: 'ear-training', label: 'Ear training' },
  { id: 'rhythm', label: 'Rhythm' },
  { id: 'metronome', label: 'Metronome' },
  { id: 'theory', label: 'Theory' },
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
    case 'play':
    case 'repertoire':
      return 'practice'
  }
}

function renderScreen(screen: ScreenId, open: (exercise: Exercise) => void) {
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
    case 'metronome':
      return <MetronomeScreen />
    case 'theory':
      return <TheoryScreen />
    case 'progress':
      return <DashboardScreen />
  }
}

export function Shell() {
  const [screen, setScreen] = useState<ScreenId>('practice')

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
      <main className="shell-main">
        {renderScreen(screen, (exercise) => setScreen(destinationFor(exercise)))}
      </main>
    </div>
  )
}
