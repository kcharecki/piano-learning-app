/**
 * `useAnnotations` (roadmap 4.8, REQ-3.2.6). The two behaviours REQ-3.2.6
 * actually cares about: an edited fingering must show up in the score the
 * viewer renders (`annotatedScore`), and a written measure note must come
 * back out (`notesForMeasure`) — not just "the hook renders".
 */
import { makeScore, type Score } from '@core/notation/score.ts'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useAnnotationStore } from '@app/state/annotationStore.ts'
import { useScoreStore } from '@app/state/scoreStore.ts'
import { useAnnotations } from './useAnnotations.ts'

function buildScore(id: string): Score {
  return makeScore({
    id,
    measures: [{}, {}],
    notes: [
      { midi: 60, startTick: 0, durationTicks: 240, hand: 'right' },
      { midi: 64, startTick: 240, durationTicks: 240, hand: 'right' },
      { midi: 48, startTick: 0, durationTicks: 480, hand: 'left' },
    ],
  })
}

function loadScore(score: Score): void {
  useScoreStore.getState().loadScore({ score, sourceName: 'test.musicxml', musicXml: undefined })
}

function resetStores(): void {
  useScoreStore.setState({ loaded: undefined })
  useAnnotationStore.setState({ byScoreId: {} })
}

afterEach(() => {
  cleanup()
  resetStores()
})

describe('useAnnotations', () => {
  it('setFingering makes the annotated score — the one the viewer renders — carry the finger', () => {
    const score = buildScore('score-1')
    loadScore(score)
    const noteId = score.notes[0]?.id
    if (noteId === undefined) throw new Error('fixture has no notes')

    const { result } = renderHook(() => useAnnotations())
    expect(result.current.annotatedScore?.notes[0]?.fingering).toBeUndefined()

    act(() => result.current.setFingering(noteId, 3))

    expect(result.current.annotatedScore?.notes[0]?.fingering).toBe(3)
    // Every other note is untouched.
    expect(result.current.annotatedScore?.notes[1]?.fingering).toBeUndefined()
  })

  it('removeFingering clears it back out of the annotated score', () => {
    const score = buildScore('score-1')
    loadScore(score)
    const noteId = score.notes[0]?.id
    if (noteId === undefined) throw new Error('fixture has no notes')

    const { result } = renderHook(() => useAnnotations())
    act(() => result.current.setFingering(noteId, 3))
    expect(result.current.fingeringFor(noteId)).toBe(3)

    act(() => result.current.removeFingering(noteId))

    expect(result.current.fingeringFor(noteId)).toBeUndefined()
    expect(result.current.annotatedScore?.notes[0]?.fingering).toBeUndefined()
  })

  it('addMeasureNote writes a note that comes back out of notesForMeasure', () => {
    loadScore(buildScore('score-1'))
    const { result } = renderHook(() => useAnnotations())

    act(() => result.current.addMeasureNote(0, 'watch the pedal'))

    expect(result.current.notesForMeasure(0)).toEqual(['watch the pedal'])
  })

  it('measure notes accumulate rather than replace', () => {
    loadScore(buildScore('score-1'))
    const { result } = renderHook(() => useAnnotations())

    act(() => result.current.addMeasureNote(0, 'first'))
    act(() => result.current.addMeasureNote(0, 'second'))

    expect(result.current.notesForMeasure(0)).toEqual(['first', 'second'])
  })

  it('setHighlight / highlightFor / removeHighlight round-trip a colour', () => {
    const score = buildScore('score-1')
    loadScore(score)
    const noteId = score.notes[0]?.id
    if (noteId === undefined) throw new Error('fixture has no notes')

    const { result } = renderHook(() => useAnnotations())
    expect(result.current.highlightFor(noteId)).toBeUndefined()

    act(() => result.current.setHighlight(noteId, '#ff0000'))
    expect(result.current.highlightFor(noteId)).toBe('#ff0000')

    act(() => result.current.removeHighlight(noteId))
    expect(result.current.highlightFor(noteId)).toBeUndefined()
  })

  it('keeps each score id its own annotations', () => {
    const scoreA = buildScore('score-a')
    const scoreB = buildScore('score-b')
    const noteA = scoreA.notes[0]?.id
    if (noteA === undefined) throw new Error('fixture has no notes')

    loadScore(scoreA)
    const { result, rerender } = renderHook(() => useAnnotations())
    act(() => result.current.setFingering(noteA, 2))
    expect(result.current.fingeringFor(noteA)).toBe(2)

    act(() => {
      loadScore(scoreB)
      rerender()
    })
    expect(result.current.annotations.items).toEqual([])

    act(() => {
      loadScore(scoreA)
      rerender()
    })
    expect(result.current.fingeringFor(noteA)).toBe(2)
  })

  it('two setters called in one batched update both take effect (no lost update)', () => {
    const score = buildScore('score-1')
    loadScore(score)
    const noteId = score.notes[0]?.id
    if (noteId === undefined) throw new Error('fixture has no notes')

    const { result } = renderHook(() => useAnnotations())

    act(() => {
      result.current.setFingering(noteId, 3)
      result.current.setHighlight(noteId, 'red')
    })

    expect(result.current.fingeringFor(noteId)).toBe(3)
    expect(result.current.highlightFor(noteId)).toBe('red')
  })

  it('setFingering rejects an out-of-range value, leaving prior state untouched', () => {
    const score = buildScore('score-1')
    loadScore(score)
    const noteId = score.notes[0]?.id
    if (noteId === undefined) throw new Error('fixture has no notes')

    const { result } = renderHook(() => useAnnotations())
    act(() => result.current.setFingering(noteId, 3))

    act(() => result.current.setFingering(noteId, 0))
    act(() => result.current.setFingering(noteId, 9))
    act(() => result.current.setFingering(noteId, 2.5))

    expect(result.current.fingeringFor(noteId)).toBe(3)
  })

  it('setters are a no-op when no score is loaded', () => {
    const { result } = renderHook(() => useAnnotations())
    expect(result.current.scoreId).toBeUndefined()
    expect(result.current.annotatedScore).toBeUndefined()

    act(() => result.current.setFingering('n1', 3))

    expect(useAnnotationStore.getState().byScoreId).toEqual({})
  })
})
