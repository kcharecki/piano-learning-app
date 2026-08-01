/**
 * App shell (roadmap 1.17, REQ-4.6): a left nav and a main area. A single-user
 * app with four destinations doesn't need a router library — `useState` is
 * the boring, maintainable choice.
 */
import { ScoreScreen } from '@app/score/ScoreScreen.tsx'
import { useState } from 'react'
import { NotBuiltPanel } from './NotBuiltPanel.tsx'

const NAV_ITEMS = [
  { id: 'practice', label: 'Practice' },
  { id: 'sight-reading', label: 'Sight reading' },
  { id: 'theory', label: 'Theory' },
  { id: 'progress', label: 'Progress' },
] as const

export type ScreenId = (typeof NAV_ITEMS)[number]['id']

function renderScreen(screen: ScreenId) {
  switch (screen) {
    case 'practice':
      return <ScoreScreen />
    case 'sight-reading':
      return <NotBuiltPanel label="Sight reading" roadmapTask="2.12" />
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
