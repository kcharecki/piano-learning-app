/**
 * First-run flow (roadmap 5.40): a few questions (experience, goal, practice
 * minutes), a MIDI/input check that tells the truth about this browser, and a
 * first session ready to start. Skippable, and re-runnable from Settings —
 * `Shell.tsx` mounts this both as a dismissible banner-triggered flow on
 * Today (first run) and directly from the Settings destination (re-run);
 * this component itself does not care which.
 *
 * ## What "ready to start" means concretely
 *
 * `Finish setup` does two real, persisted things, both through EXISTING
 * mechanisms this task's file boundary does not own the write side of:
 *
 *  1. **Levels.** `setTrackLevel` on `useLevelStore` for all three tracks —
 *     the store `persistence.ts` (outside this task) already subscribes to
 *     and restores on reload. No second persistence path.
 *  2. **A first session.** `SessionPlanScreen`'s own budget
 *     (`useSessionPlan`'s `useState`) has no persistence seam, and that file
 *     is outside this task's boundary (`src/app/session/**`) — see the task
 *     report for the full reasoning. Instead this writes a real
 *     `SessionRunSnapshot` — built with the SAME pure `planSession` +
 *     `sessionCandidates` `SessionPlanScreen` itself uses, at the chosen
 *     minutes — directly to the exact (collection, key) pair
 *     `useSessionRun.ts` already restores from on mount (its own exported
 *     `SESSION_RUN_COLLECTION`/`SESSION_RUN_KEY` constants, imported here
 *     rather than duplicated). This is USING that existing, documented
 *     persistence contract, not inventing a new one — `useSessionRun.ts` is
 *     read-only here, never edited. The learner lands on Today already
 *     mid-plan, item one live, at the exact budget they chose.
 *
 * `Skip` persists nothing beyond the completion flag itself (via the
 * `markCompleted` passed in from `useOnboardingGate`) — no level change, no
 * session write.
 */
import { useState } from 'react'
import type { Store } from '@core/ports/index.ts'
import { TRACKS } from '@core/curriculum/types.ts'
import { planSession, SESSION_LENGTHS } from '@core/curriculum/session.ts'
import { isOk } from '@core/shared/result.ts'
import { isWebMidiSupported } from '@adapters/midi/index.ts'
import { createIdbStore } from '@adapters/store/idb.ts'
import { useLevelStore } from '@app/state/levelStore.ts'
import { useScoreStore } from '@app/state/scoreStore.ts'
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { sessionCandidates } from '@app/session/candidates.ts'
import {
  SESSION_RUN_COLLECTION,
  SESSION_RUN_KEY,
  type SessionRunSnapshot,
} from '@app/session/useSessionRun.ts'

export type OnboardingExperience = 'new' | 'some' | 'experienced'
export type OnboardingGoal = 'sight-reading' | 'repertoire' | 'theory' | 'well-rounded'

/** Upper bound on the typed minutes field — mirrors `useSessionPlan.ts`'s own
 *  `MAX_BUDGET_MINUTES` reasoning (an unbounded budget would build thousands
 *  of session items synchronously) without importing that out-of-boundary
 *  module for a single constant. */
const MAX_MINUTES = 240

const EXPERIENCE_LABEL: Readonly<Record<OnboardingExperience, string>> = {
  new: "I'm new to piano",
  some: "I've played a bit before",
  experienced: 'I can already read music comfortably',
}

/** Starting level (of `MIN_LEVEL`..`MAX_LEVEL`) for every track, by answer —
 *  a deliberately simple, uniform-across-tracks mapping; see the task report
 *  for why (goal does not yet bias this — see `GOAL_LABEL`'s own comment). */
const EXPERIENCE_LEVEL: Readonly<Record<OnboardingExperience, number>> = {
  new: 1,
  some: 2,
  experienced: 3,
}

const GOAL_LABEL: Readonly<Record<OnboardingGoal, string>> = {
  'sight-reading': 'Get better at sight-reading',
  repertoire: 'Learn real pieces',
  theory: 'Understand the theory behind what I play',
  'well-rounded': 'A bit of everything',
}

export type OnboardingFlowProps = {
  /** Called once, after either Finish or Skip — the caller's job is only to
   *  hide this flow and mark the gate completed (`useOnboardingGate`'s own
   *  `markCompleted`); this component never touches that hook itself, so it
   *  works identically whether it is showing because this is a first run or
   *  because Settings re-opened it. */
  readonly onDone: () => void
  /** Test seam for the MIDI check; defaults to real feature detection, same as `InputCapabilityBanner`. */
  readonly midiSupported?: boolean
  /** Injection seam for the session-run write; defaults to the real IndexedDB store. */
  readonly openStore?: () => Promise<Store>
}

export function OnboardingFlow({
  onDone,
  midiSupported = isWebMidiSupported(),
  openStore = createIdbStore,
}: OnboardingFlowProps) {
  const [experience, setExperience] = useState<OnboardingExperience>('new')
  const [goal, setGoal] = useState<OnboardingGoal>('well-rounded')
  const [minutesText, setMinutesText] = useState(String(SESSION_LENGTHS[1] ?? 30))
  const [starting, setStarting] = useState(false)

  const minutes = Math.max(1, Math.min(MAX_MINUTES, Math.floor(Number(minutesText) || 0)))

  async function persistFirstSession(techniqueLevel: number): Promise<void> {
    const { loaded } = useScoreStore.getState()
    const sightReadingLevel = useSightReadingStore.getState().level
    const candidates = sessionCandidates({
      sightReadingLevel,
      loadedScore: loaded,
      techniqueLevel,
    })
    const result = planSession(minutes, { candidates })
    if (!isOk(result)) return // No candidates at all is not reachable in practice — warm-up/technique/theory-ear are always offered — but a failed plan must not block Finish.

    const snapshot: SessionRunSnapshot = {
      plan: result.value,
      dayKey: new Date().toDateString(),
      doneFlags: result.value.items.map(() => false),
    }
    try {
      const store = await openStore()
      await store.put(SESSION_RUN_COLLECTION, SESSION_RUN_KEY, snapshot)
    } catch {
      // Swallowed — Today falls back to its own default 30-minute planning
      // view, which is still a usable first session, just not this exact one.
    }
  }

  function handleFinish(): void {
    setStarting(true)
    const level = EXPERIENCE_LEVEL[experience]
    for (const track of TRACKS) {
      useLevelStore.getState().setTrackLevel(track, level)
    }
    void persistFirstSession(level).finally(() => {
      onDone()
    })
  }

  function handleSkip(): void {
    onDone()
  }

  return (
    <section aria-label="Set up your practice" className="onboarding-flow">
      <h2>Set up your practice</h2>
      <p>A few quick questions — skip any time, and re-run this from Settings whenever you like.</p>

      <fieldset>
        <legend>Where are you starting from?</legend>
        {(Object.keys(EXPERIENCE_LABEL) as OnboardingExperience[]).map((value) => (
          <label key={value} className="onboarding-option">
            <input
              type="radio"
              name="onboarding-experience"
              value={value}
              checked={experience === value}
              onChange={() => setExperience(value)}
            />
            {EXPERIENCE_LABEL[value]}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>What do you most want to work on?</legend>
        {(Object.keys(GOAL_LABEL) as OnboardingGoal[]).map((value) => (
          <label key={value} className="onboarding-option">
            <input
              type="radio"
              name="onboarding-goal"
              value={value}
              checked={goal === value}
              onChange={() => setGoal(value)}
            />
            {GOAL_LABEL[value]}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>How many minutes a day, usually?</legend>
        <div role="group" aria-label="Practice minutes">
          {SESSION_LENGTHS.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-pressed={minutes === preset}
              onClick={() => setMinutesText(String(preset))}
            >
              {preset} min
            </button>
          ))}
          <label htmlFor="onboarding-minutes-custom">Custom minutes</label>
          <input
            id="onboarding-minutes-custom"
            type="number"
            min={1}
            max={MAX_MINUTES}
            value={minutesText}
            onChange={(e) => setMinutesText(e.target.value)}
          />
        </div>
      </fieldset>

      <section aria-label="Input check">
        <h3>Your MIDI keyboard</h3>
        {midiSupported ? (
          <p role="status">
            This browser supports Web MIDI — plug in a keyboard and it will be picked up
            automatically once you start practicing.
          </p>
        ) : (
          <p role="status">
            This browser can&apos;t see a MIDI keyboard (no Web MIDI) — note matching and
            timing feedback won&apos;t work here, but you can still listen, read and play with
            the on-screen keyboard.
          </p>
        )}
      </section>

      <div className="onboarding-actions">
        <button type="button" className="btn-primary" disabled={starting} onClick={handleFinish}>
          {starting ? 'Setting up…' : 'Finish setup'}
        </button>
        <button type="button" className="btn-ghost" disabled={starting} onClick={handleSkip}>
          Skip for now
        </button>
      </div>
    </section>
  )
}
