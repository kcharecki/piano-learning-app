/**
 * `useLessons`'s own wiring (roadmap 4.9b): the lesson list for a level
 * matches `lessonsForLevel` independently called, selection moves through
 * `nextLesson` (including crossing a level boundary), and an unknown lesson
 * id degrades honestly instead of leaving `selected` pointing at nothing.
 * `openDemoScore`'s effect on `scoreStore` is proved through
 * `LessonsScreen.test.tsx`, which is where it is actually reachable from a
 * click — this file is the hook's own contract.
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CURRICULUM } from '@content/curriculum/curriculum.ts'
import { lessonsForLevel, lessonsForTrack, nextLesson } from '@core/curriculum/model.ts'
import { useScoreStore } from '@app/state/scoreStore.ts'
import { useLessons } from './useLessons.ts'

function resetScoreStore(): void {
  useScoreStore.setState({
    loaded: undefined,
    importError: undefined,
    availableMidiDevices: [],
    selectedMidiDeviceId: null,
    settings: {
      tempoScale: 1,
      activeHands: ['left', 'right'],
      metronomeEnabled: false,
      loop: undefined,
    },
  })
}

beforeEach(resetScoreStore)
afterEach(() => {
  cleanup()
  resetScoreStore()
})

describe('useLessons', () => {
  it('lists level 1 by default, matching lessonsForLevel independently, and selects its first lesson', () => {
    const { result } = renderHook(() => useLessons())

    const expected = lessonsForLevel(CURRICULUM, 1)
    expect(result.current.level).toBe(1)
    expect(result.current.lessons.map((l) => l.id)).toEqual(expected.map((l) => l.id))
    expect(result.current.selected?.id).toBe(expected[0]?.id)
  })

  it('setLevel switches to that level\'s own lessons, matching lessonsForLevel for that level', () => {
    const { result } = renderHook(() => useLessons())

    act(() => result.current.setLevel(2))

    const expected = lessonsForLevel(CURRICULUM, 2)
    expect(result.current.level).toBe(2)
    expect(result.current.lessons.map((l) => l.id)).toEqual(expected.map((l) => l.id))
    expect(result.current.selected?.id).toBe(expected[0]?.id)
  })

  it('selectLesson moves the selection and, when the lesson lives in a different level, the level too', () => {
    const { result } = renderHook(() => useLessons())

    const level2Lessons = lessonsForLevel(CURRICULUM, 2)
    const target = level2Lessons[2]
    if (target === undefined) throw new Error('expected level 2 to have at least 3 lessons')

    act(() => result.current.selectLesson(target.id))

    expect(result.current.selected?.id).toBe(target.id)
    expect(result.current.level).toBe(2)
  })

  it('goToNext moves selection exactly the way nextLesson says, including across a level boundary', () => {
    const { result } = renderHook(() => useLessons())

    // Walk to the last lesson of level 1's own list first, independently
    // computed, so the boundary crossing below is deliberate, not incidental.
    const level1Lessons = lessonsForLevel(CURRICULUM, 1)
    const lastOfLevel1 = level1Lessons[level1Lessons.length - 1]
    if (lastOfLevel1 === undefined) throw new Error('expected level 1 to have lessons')

    act(() => result.current.selectLesson(lastOfLevel1.id))
    expect(result.current.selected?.id).toBe(lastOfLevel1.id)

    const expectedNext = nextLesson(CURRICULUM, lastOfLevel1.id)
    expect(expectedNext).toBeDefined()

    act(() => result.current.goToNext())

    expect(result.current.selected?.id).toBe(expectedNext?.id)
    // The independently-computed next lesson after level 1's last lesson is
    // in level 2 (curriculum.ts's own level ordering) — goToNext must have
    // followed it there, not left `level` behind at 1.
    expect(result.current.level).not.toBe(1)
  })

  it('an unknown lesson id degrades honestly: selection stays on the previous valid lesson', () => {
    const { result } = renderHook(() => useLessons())

    const before = result.current.selected?.id
    expect(before).toBeDefined()

    act(() => result.current.selectLesson('no-such-lesson-id'))

    expect(result.current.selected?.id).toBe(before)
    expect(result.current.level).toBe(1)
  })

  it('changing level after selecting a lesson moves selection to the new level\'s first lesson', () => {
    const { result } = renderHook(() => useLessons())

    const level1Lessons = lessonsForLevel(CURRICULUM, 1)
    const nonFirst = level1Lessons[1]
    if (nonFirst === undefined) throw new Error('expected level 1 to have at least 2 lessons')

    act(() => result.current.selectLesson(nonFirst.id))
    expect(result.current.selected?.id).toBe(nonFirst.id)

    act(() => result.current.setLevel(2))

    const expected = lessonsForLevel(CURRICULUM, 2)
    expect(result.current.selected?.id).toBe(expected[0]?.id)
  })

  it('selectedMinutes matches lessonMinutes-summed exercise minutes for the selected lesson', () => {
    const { result } = renderHook(() => useLessons())

    const selected = result.current.selected
    if (selected === undefined) throw new Error('expected a default selection')
    const expected = selected.exercises.reduce((sum, e) => sum + e.estimatedMinutes, 0)
    expect(result.current.selectedMinutes).toBe(expected)
  })

  it('setTrack narrows the list to that track, and All tracks restores it', () => {
    const { result } = renderHook(() => useLessons())

    const all = result.current.lessons
    // The filter is only worth testing where it actually removes something —
    // a level whose lessons are all one track would pass a no-op filter too.
    expect(new Set(all.map((l) => l.track)).size).toBeGreaterThan(1)

    act(() => result.current.setTrack('theory'))
    const theory = result.current.lessons
    expect(theory.length).toBeGreaterThan(0)
    expect(theory.length).toBeLessThan(all.length)
    expect(theory.every((l) => l.track === 'theory')).toBe(true)
    // Derived from the model, not from the hook's own output: a filter that
    // returned the wrong subset would still satisfy `every(track === theory)`.
    expect(theory.map((l) => l.id)).toEqual(
      lessonsForTrack(CURRICULUM, result.current.level, 'theory').map((l) => l.id),
    )

    act(() => result.current.setTrack(undefined))
    expect(result.current.lessons.map((l) => l.id)).toEqual(all.map((l) => l.id))
  })
})
