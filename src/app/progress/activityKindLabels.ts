/**
 * Learner-facing display name per `ActivityKind` (roadmap 5.16) — the single
 * canonical mapping. `Record<ActivityKind, string>` makes it exhaustive: a
 * new `ActivityKind` with no entry here fails the build.
 *
 * Lives here (not in `DashboardScreen.tsx`, which used to declare it inline)
 * so `@app/progress/PracticeSheet.tsx` (roadmap 5.47) can reuse the exact
 * same mapping without either duplicating it (risking the two silently
 * drifting apart) or creating a module cycle with `DashboardScreen.tsx`
 * (which itself renders `PracticeSheet`).
 */
import type { ActivityKind } from '@core/progress/log.ts'

export const ACTIVITY_KIND_LABELS: Readonly<Record<ActivityKind, string>> = {
  technique: 'Technique',
  sightreading: 'Sight reading',
  repertoire: 'Repertoire',
  lesson: 'Lesson',
  theory: 'Theory',
  eartraining: 'Ear training',
}
