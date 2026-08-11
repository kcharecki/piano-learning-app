/**
 * Settings destination (roadmap 5.40's "re-runnable from settings"). Today
 * this holds exactly one thing — re-running the first-run flow — because
 * that is the only settings surface this roadmap item asks for; a broader
 * settings hub is out of scope here.
 */
import { useState } from 'react'
import { OnboardingFlow } from './OnboardingFlow.tsx'
import { useOnboardingGate } from './useOnboardingGate.ts'

export type SettingsScreenProps = {
  /** Shell's own navigation, so "Back to Today" is a real nav action, not a dead link. */
  readonly onGoToToday: () => void
}

export function SettingsScreen({ onGoToToday }: SettingsScreenProps) {
  const gate = useOnboardingGate()
  const [justFinished, setJustFinished] = useState(false)

  function handleDone(): void {
    gate.markCompleted()
    setJustFinished(true)
  }

  return (
    <div className="settings-screen">
      <h1>Settings</h1>
      {justFinished ? (
        <div>
          <p role="status">
            Setup updated — your levels and today&apos;s plan reflect your latest answers.
          </p>
          <button type="button" className="btn-primary" onClick={onGoToToday}>
            Back to Today
          </button>
        </div>
      ) : (
        <OnboardingFlow onDone={handleDone} />
      )}
    </div>
  )
}
