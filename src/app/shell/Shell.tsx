/**
 * App shell (roadmap 1.17, REQ-4.6): a left nav and a main area. A single-user
 * app with five destinations doesn't need a router library — `useState` is
 * the boring, maintainable choice.
 *
 * Sight reading and Flashcards (roadmap 2.12, REQ-3.4.1/3/4/5/6) are real
 * screens, not placeholders — see `@app/sightreading/SightReadingScreen.tsx`
 * and `@app/drills/FlashcardScreen.tsx`. Flashcards did not fit any existing
 * nav item (it is not the practice screen, and it is not sight reading), so
 * it gets its own.
 */
import { ScoreScreen } from '@app/score/ScoreScreen.tsx'
import { FlashcardScreen } from '@app/drills/FlashcardScreen.tsx'
import { SightReadingScreen } from '@app/sightreading/SightReadingScreen.tsx'
import { useState } from 'react'
import { NotBuiltPanel } from './NotBuiltPanel.tsx'

const NAV_ITEMS = [
  { id: 'practice', label: 'Practice' },
  { id: 'sight-reading', label: 'Sight reading' },
  { id: 'flashcards', label: 'Flashcards' },
  { id: 'theory', label: 'Theory' },
  { id: 'progress', label: 'Progress' },
] as const

export type ScreenId = (typeof NAV_ITEMS)[number]['id']

function renderScreen(screen: ScreenId) {
  switch (screen) {
    case 'practice':
      return <ScoreScreen />
    case 'sight-reading':
      return <SightReadingScreen />
    case 'flashcards':
      return <FlashcardScreen />
    case 'theory':
      return <NotBuiltPanel label="Theory" roadmapTask="3.8" />
    case 'progress':
      return <NotBuiltPanel label="Progress" roadmapTask="4.7" />
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
      <main className="shell-main">{renderScreen(screen)}</main>
    </div>
  )
}
