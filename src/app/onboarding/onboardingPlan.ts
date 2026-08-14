/**
 * Onboarding plan vocabulary — experience/goal types, the questionnaire's own
 * copy, and the experience-to-level mapping (roadmap 5.40, extended for
 * roadmap UI-05). Split out of `OnboardingFlow.tsx` into its own module for
 * two reasons:
 *
 *  1. `SettingsScreen.tsx`'s collapsed "Practice plan" summary needs the same
 *     copy `OnboardingFlow` renders in its questionnaire (`EXPERIENCE_LABEL`
 *     / `GOAL_LABEL`) and the same level mapping (`describeLevel`, reversing
 *     `EXPERIENCE_LEVEL`) so the two can never drift into saying different
 *     things about the same answer.
 *  2. Re-exporting non-component values (objects, functions) alongside a
 *     component from the SAME file trips `react-refresh/only-export-components`
 *     — this project's `npm run lint` runs with `--max-warnings 0`, so that
 *     warning is a hard failure, not a nit. Splitting into a plain module is
 *     exactly the fix the rule itself suggests.
 */
export type OnboardingExperience = 'new' | 'some' | 'experienced'
export type OnboardingGoal = 'sight-reading' | 'repertoire' | 'theory' | 'well-rounded'

export type OnboardingAnswers = {
  readonly experience: OnboardingExperience
  readonly goal: OnboardingGoal
  readonly minutes: number
}

export const EXPERIENCE_LABEL: Readonly<Record<OnboardingExperience, string>> = {
  new: "I'm new to piano",
  some: "I've played a bit before",
  experienced: 'I can already read music comfortably',
}

/**
 * Starting level (of `MIN_LEVEL`..`MAX_LEVEL`) for every track, by answer —
 * a deliberately simple, uniform-across-tracks mapping; see the roadmap-5.40
 * task report for why (goal does not yet bias this — see `GOAL_LABEL`'s own
 * comment). The only durable record of the experience answer is the level
 * itself, since nothing persists the raw answer — `describeLevel` below
 * reverses this mapping for Settings' collapsed summary.
 */
export const EXPERIENCE_LEVEL: Readonly<Record<OnboardingExperience, number>> = {
  new: 1,
  some: 2,
  experienced: 3,
}

/**
 * The label matching a track level already set (by a prior "Finish setup"
 * or by in-app advancement), for Settings' collapsed summary — or
 * `undefined` for a level this simple 1:1 mapping doesn't cover (levels 4-5,
 * reachable only by advancing past onboarding's own 1..3 range).
 */
export function describeLevel(level: number): string | undefined {
  const match = (Object.keys(EXPERIENCE_LEVEL) as OnboardingExperience[]).find(
    (key) => EXPERIENCE_LEVEL[key] === level,
  )
  return match === undefined ? undefined : EXPERIENCE_LABEL[match]
}

/** Goal does not yet bias the level mapping above — see `EXPERIENCE_LEVEL`'s own comment. */
export const GOAL_LABEL: Readonly<Record<OnboardingGoal, string>> = {
  'sight-reading': 'Get better at sight-reading',
  repertoire: 'Learn real pieces',
  theory: 'Understand the theory behind what I play',
  'well-rounded': 'A bit of everything',
}
