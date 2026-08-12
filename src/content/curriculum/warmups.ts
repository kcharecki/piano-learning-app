/**
 * Warm-up content (roadmap 5.45, REQ-3.1.4). Every practice-routine source
 * consulted puts a short warm-up first, and the physical-education/piano
 * pedagogy guidance among them (Juilliard's own pre-practice routine is the
 * clearest of the sources checked) is specific that it happens AWAY FROM THE
 * KEYS — loosening the jaw, shoulders, wrists and fingers before the first
 * note, not a five-finger pattern at the keyboard (that is what the
 * `technique` segment is for, and it already exists).
 *
 * This is the ONE new file this task may add to `src/content/curriculum/`
 * (see `docs/agent-brief.md`'s per-task file boundary — `curriculum.ts`,
 * `lessonsLevel*.ts` and `diagrams.ts` belong to a different session this
 * round and are read-only here). `@app/session/candidates.ts` is what wires
 * `WARMUP_EXERCISE` into `planSession`'s candidates — see that file's own
 * comment for why the wiring happens there and not inside `session.ts`
 * itself: `src/core` may not import `src/content` (the architecture
 * boundary in `docs/agent-brief.md` runs one way only), so the pure planner
 * cannot reach into this module directly. `planSession` only ever sees this
 * content already turned into an `Exercise` by the caller, exactly like
 * every other segment's candidates.
 *
 * `WARMUP_EXERCISE.kind` is `'technique'` — a deliberate reuse of the
 * existing `ExerciseKind` rather than a new one, because `types.ts` is
 * outside this task's file boundary (owned by another session's
 * `core/curriculum/model.ts`) and a stretch/posture routine IS a physical
 * technique exercise in the sense that union already means (see its own
 * comment: "what a learner actually does"). Nothing downstream inspects
 * `Exercise.kind` to decide the warm-up's own behaviour — `SessionRunView`
 * (`@app/session/SessionPlanScreen.tsx`) recognises the warm-up item by its
 * segment (`'warmup'`) and `id` (`WARMUP_EXERCISE_ID`), not by its kind, and
 * renders `WARMUP_STEPS` as a real checklist rather than routing to the
 * Technique screen the way an ordinary `'technique'`-kind item would.
 */
import type { Exercise } from '@core/curriculum/types.ts'

export type WarmupStep = {
  readonly id: string
  /** Sentence-case instruction, spoken to the learner directly. */
  readonly instruction: string
}

/**
 * A short, away-from-the-keys routine: jaw and shoulders (tension carried
 * into playing goes unnoticed until it is released), wrists and fingers
 * (the joints that do the actual work), then one posture/breath check
 * before sitting down to play. Five steps at roughly a minute each fits
 * `WARMUP_MINUTES` (`@core/curriculum/session.ts`).
 *
 * Roadmap 5.52: the 'jaw-and-neck' step used to add "Piano tension hides in
 * the jaw first" — a specific causal claim no source consulted supports.
 * Juilliard's Basic Warm-Up Guide (the clearest source consulted for this
 * routine, named in the module comment above) verifies a pre-practice
 * release for the SHOULDERS and POSTURE at the bench; it is an at-the-bench
 * routine and does not mention the jaw at all. A gentle jaw/neck roll is
 * still a reasonable general tension-release action (any physical warm-up
 * guide recommends releasing the jaw and neck before sustained fine-motor
 * work), so the action stays — only the unsupported "hides... first" claim
 * is removed.
 */
export const WARMUP_STEPS: readonly WarmupStep[] = [
  {
    id: 'jaw-and-neck',
    instruction:
      'Drop your jaw open, roll your neck slowly side to side — a gentle release before you sit down to play.',
  },
  {
    id: 'shoulder-rolls',
    instruction: 'Roll both shoulders back, five slow circles, then let them drop away from your ears.',
  },
  {
    id: 'wrist-circles',
    instruction: 'Shake out both hands, then circle each wrist gently in both directions.',
  },
  {
    id: 'finger-stretch',
    instruction: 'Spread your fingers wide, hold for a few seconds, then let them curl loosely closed.',
  },
  {
    id: 'posture-check',
    instruction:
      'Sit tall with feet flat on the floor, shoulders relaxed, forearms level — then take one slow breath before you begin.',
  },
] as const

export const WARMUP_EXERCISE_ID = 'warmup-away-from-keys'

/**
 * The one candidate `@app/session/candidates.ts` offers for the warm-up
 * segment. A single fixed exercise, not a library to pick from — the
 * routine does not need variety, only to run every day (`estimatedMinutes`
 * matches `WARMUP_MINUTES`, though `planSession` never actually reads it
 * for this segment: warm-up's minutes are a flat reservation, not an
 * estimate-based fill, since it is the only candidate and always claims the
 * whole reserved block in one item).
 */
export const WARMUP_EXERCISE: Exercise = {
  id: WARMUP_EXERCISE_ID,
  kind: 'technique',
  title: 'Away-from-the-keys warm-up',
  estimatedMinutes: 5,
}
