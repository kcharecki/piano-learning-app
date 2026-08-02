/**
 * `annotationStore` (roadmap 4.8) — state only, keyed by score id.
 */
import type { ScoreAnnotations } from '@core/notation/annotations.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { useAnnotationStore } from './annotationStore.ts'

function resetStore(): void {
  useAnnotationStore.setState({ byScoreId: {} })
}

afterEach(resetStore)

const SCORE_A_ANNOTATIONS: ScoreAnnotations = {
  scoreId: 'score-a',
  items: [{ kind: 'fingering', noteId: 'n1', finger: 3 }],
}

describe('useAnnotationStore', () => {
  it('starts empty', () => {
    expect(useAnnotationStore.getState().byScoreId).toEqual({})
  })

  it('setAnnotations adds a new score entry', () => {
    useAnnotationStore.getState().setAnnotations('score-a', SCORE_A_ANNOTATIONS)
    expect(useAnnotationStore.getState().byScoreId['score-a']).toEqual(SCORE_A_ANNOTATIONS)
  })

  it('setAnnotations replaces one score, leaving other scores untouched', () => {
    const scoreB: ScoreAnnotations = { scoreId: 'score-b', items: [] }
    useAnnotationStore.getState().setAnnotations('score-a', SCORE_A_ANNOTATIONS)
    useAnnotationStore.getState().setAnnotations('score-b', scoreB)

    const updatedA: ScoreAnnotations = {
      scoreId: 'score-a',
      items: [{ kind: 'fingering', noteId: 'n1', finger: 5 }],
    }
    useAnnotationStore.getState().setAnnotations('score-a', updatedA)

    expect(useAnnotationStore.getState().byScoreId['score-a']).toEqual(updatedA)
    expect(useAnnotationStore.getState().byScoreId['score-b']).toEqual(scoreB)
  })

  // Kills a mutant that has `hydrate` merge into the existing map instead of
  // replacing it — this is a wholesale replace, used by `persistence.ts`'s
  // restore step to apply previously-saved annotations.
  it('hydrate replaces byScoreId wholesale, not merge', () => {
    useAnnotationStore.getState().setAnnotations('score-a', SCORE_A_ANNOTATIONS)
    const scoreB: ScoreAnnotations = { scoreId: 'score-b', items: [] }

    useAnnotationStore.getState().hydrate({ 'score-b': scoreB })

    expect(useAnnotationStore.getState().byScoreId).toEqual({ 'score-b': scoreB })
  })
})
