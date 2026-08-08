import type { Score } from '@core/notation/score.ts'

/** A short, playable teaching example — see `demoScores.ts`'s module doc. */
export type DemoScore = {
  /** Stable, kebab-case, content-derived. Referenced by `Lesson.demoScoreId`. */
  readonly id: string
  /** Shown to the learner above the engraving. */
  readonly title: string
  /** One or two sentences: what this demonstration is FOR. */
  readonly description: string
  readonly score: Score
}
