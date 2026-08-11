/**
 * The first-run entry point on Today (roadmap 5.40): a small, dismissible
 * callout — never a hard gate. `Shell.tsx` renders this unconditionally
 * alongside `InputCapabilityBanner`; it decides for itself whether there is
 * anything to show, via `show` (only true on the Today route) and its own
 * `useOnboardingGate` read.
 *
 * ## Why a callout, not a gate that blocks the routed screen
 *
 * The roadmap text describes a first-run flow a learner "completes" before
 * reaching the dashboard, which reads like a hard gate. A hard gate was
 * rejected here on the evidence in the task report: this app's e2e suite is
 * ~60 spec files, nearly all of which `goto('/')` (landing on Today, the
 * default route) with NO IndexedDB seeded — the exact "fresh install"
 * condition a gate would trigger on, since Playwright isolates storage per
 * test. Blocking `renderScreen('today', …)` behind onboarding completion
 * would have intercepted essentially every existing spec in the repo, most
 * of which are owned by other live parallel sessions. This callout is
 * purely ADDITIVE — a sibling rendered before `renderScreen`'s own output —
 * so `SessionPlanScreen`'s own heading, controls and item list are
 * untouched and every existing test that does not specifically look for
 * this callout's own distinctive button labels ("Set up my practice",
 * "Not now") cannot observe it.
 */
import { useState } from 'react'
import type { Store } from '@core/ports/index.ts'
import { OnboardingFlow } from './OnboardingFlow.tsx'
import { useOnboardingGate } from './useOnboardingGate.ts'

export type OnboardingGatewayProps = {
  /** Only ever relevant on the Today route — the first-run entry point. */
  readonly show: boolean
  /** Injection seam for tests; defaults (via `useOnboardingGate`) to the real IndexedDB store. */
  readonly openStore?: () => Promise<Store>
}

export function OnboardingGateway({ show, openStore }: OnboardingGatewayProps) {
  const gate = useOnboardingGate(openStore === undefined ? {} : { openStore })
  const [expanded, setExpanded] = useState(false)

  if (!show || !gate.hydrated || gate.completed) return null

  if (expanded) {
    return (
      <OnboardingFlow
        onDone={gate.markCompleted}
        {...(openStore === undefined ? {} : { openStore })}
      />
    )
  }

  return (
    <div className="onboarding-banner" role="note" aria-label="First-run setup">
      <p>
        New here? Set up your practice in under a minute — pick your starting level, your goal
        and how long you usually practice.
      </p>
      <div className="onboarding-banner-actions">
        <button type="button" className="btn-primary" onClick={() => setExpanded(true)}>
          Set up my practice
        </button>
        <button type="button" className="btn-ghost" onClick={gate.markCompleted}>
          Not now
        </button>
      </div>
    </div>
  )
}
