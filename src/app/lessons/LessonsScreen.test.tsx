/**
 * `LessonsScreen`'s own wiring (roadmap 4.9b, REQ-3.1.1/3.1.2/3.1.3): picking
 * a level shows that level's lessons, selecting one shows its explanation and
 * exercises, and — the gap this task closes — opening a `play` exercise
 * loads THAT lesson's own demonstration into `scoreStore` first, not
 * whatever was loaded before. `useLessons` and `LessonBody` have their own
 * suites; this only asserts they are wired together correctly here.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScoreStore } from '@app/state/scoreStore.ts'
import { CURRICULUM } from '@content/curriculum/curriculum.ts'
import { demoScoreById } from '@content/scores/demoScores.ts'
import { lessonMinutes, lessonsForLevel, nextLesson } from '@core/curriculum/model.ts'
import type { Exercise } from '@core/curriculum/types.ts'
import { makeScore } from '@core/notation/score.ts'
import { LessonsScreen } from './LessonsScreen.tsx'

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

describe('LessonsScreen', () => {
  it('shows level 1\'s lessons and the first one selected by default, with its explanation', () => {
    render(<LessonsScreen onOpen={vi.fn()} onOpenDemo={vi.fn()} />)

    const expected = lessonsForLevel(CURRICULUM, 1)
    const list = screen.getByRole('list', { name: 'Lessons' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.length).toBe(expected.length)

    const firstLesson = expected[0]
    if (firstLesson === undefined) throw new Error('expected level 1 to have lessons')
    expect(screen.getByRole('heading', { name: firstLesson.title })).toBeVisible()
    // The explanation's first paragraph is on screen, not just the title.
    const firstParagraph = firstLesson.explanation.split(/\n\s*\n/)[0]
    if (firstParagraph !== undefined) {
      expect(screen.getByText(firstParagraph)).toBeInTheDocument()
    }
    expect(screen.getByTestId(`lesson-minutes-${firstLesson.id}`)).toHaveTextContent(
      `${lessonMinutes(firstLesson)} min`,
    )
    const totalMinutes = firstLesson.exercises.reduce((sum, e) => sum + e.estimatedMinutes, 0)
    expect(screen.getByTestId('lessons-selected-minutes')).toHaveTextContent(
      `${totalMinutes} min total`,
    )
  })

  it('picking a level shows that level\'s own lessons, and selecting one shows its exercises', async () => {
    const user = userEvent.setup()
    render(<LessonsScreen onOpen={vi.fn()} onOpenDemo={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Level 2' }))

    const level2 = lessonsForLevel(CURRICULUM, 2)
    const list = screen.getByRole('list', { name: 'Lessons' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.length).toBe(level2.length)

    const target = level2[1]
    if (target === undefined) throw new Error('expected level 2 to have at least 2 lessons')
    await user.click(within(list).getByRole('button', { name: target.title }))

    expect(screen.getByRole('heading', { name: target.title })).toBeVisible()
    for (const exercise of target.exercises) {
      expect(screen.getByRole('button', { name: `Open ${exercise.title}` })).toBeInTheDocument()
    }
  })

  it('clicking the "Next lesson" button moves the selection to the independently-computed next lesson', async () => {
    const user = userEvent.setup()
    render(<LessonsScreen onOpen={vi.fn()} onOpenDemo={vi.fn()} />)

    const firstLesson = lessonsForLevel(CURRICULUM, 1)[0]
    if (firstLesson === undefined) throw new Error('expected level 1 to have lessons')
    const expectedNext = nextLesson(CURRICULUM, firstLesson.id)
    if (expectedNext === undefined) throw new Error('expected a lesson after the first')

    await user.click(screen.getByRole('button', { name: `Next lesson: ${expectedNext.title}` }))

    expect(screen.getByRole('heading', { name: expectedNext.title })).toBeVisible()
  })

  it('opening a play exercise loads THAT lesson\'s own demo score, replacing whatever was loaded before', async () => {
    const user = userEvent.setup()

    // A different score is loaded first, so "the demo loaded" cannot be
    // satisfied by "nothing changed".
    useScoreStore.getState().loadScore({
      score: makeScore({ id: 'previous-score', measures: [{}], notes: [], tempos: [{ tick: 0, bpm: 120 }] }),
      sourceName: 'Previous Score',
      musicXml: undefined,
    })

    const onOpen = vi.fn<(exercise: Exercise) => void>()
    render(<LessonsScreen onOpen={onOpen} onOpenDemo={vi.fn()} />)

    // Select a lesson OTHER than the default (first) selection, whose demo
    // differs from the default's — otherwise an implementation that always
    // loads the first lesson's demo would pass this test too.
    const level1Lessons = lessonsForLevel(CURRICULUM, 1)
    const firstLesson = level1Lessons[0]
    const targetLesson = level1Lessons.find(
      (l) => l.demoScoreId !== undefined && l.demoScoreId !== firstLesson?.demoScoreId,
    )
    if (targetLesson === undefined) {
      throw new Error('expected a level-1 lesson whose demoScoreId differs from the default')
    }
    const playExercise = targetLesson.exercises.find((e) => e.kind === 'play')
    if (playExercise === undefined) {
      throw new Error(`expected lesson ${targetLesson.id} to have a play exercise`)
    }
    if (targetLesson.demoScoreId === undefined) {
      throw new Error(`expected lesson ${targetLesson.id} to have a demoScoreId`)
    }
    const demo = demoScoreById(targetLesson.demoScoreId)
    if (demo === undefined) {
      throw new Error(`expected demo score '${targetLesson.demoScoreId}' to resolve`)
    }

    const list = screen.getByRole('list', { name: 'Lessons' })
    await user.click(within(list).getByRole('button', { name: targetLesson.title }))
    await user.click(screen.getByRole('button', { name: `Open ${playExercise.title}` }))

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(playExercise)

    const loaded = useScoreStore.getState().loaded
    expect(loaded).toBeDefined()
    expect(loaded?.score).toBe(demo.score)
    expect(loaded?.sourceName).not.toBe('Previous Score')
    expect(loaded?.sourceName).toContain(targetLesson.title)
  })

  it('"Open demonstration" loads the selected lesson\'s demo score and tells the shell to navigate, without opening any exercise', async () => {
    const user = userEvent.setup()
    const onOpenDemo = vi.fn()
    render(<LessonsScreen onOpen={vi.fn()} onOpenDemo={onOpenDemo} />)

    const firstLesson = lessonsForLevel(CURRICULUM, 1)[0]
    if (firstLesson === undefined || firstLesson.demoScoreId === undefined) {
      throw new Error('expected level 1\'s first lesson to have a demoScoreId')
    }
    const demo = demoScoreById(firstLesson.demoScoreId)
    if (demo === undefined) throw new Error('expected the demo score to resolve')

    expect(screen.getByText(`Demonstration: ${demo.title}`)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open demonstration' }))

    expect(useScoreStore.getState().loaded?.score).toBe(demo.score)
    // The bug this closes (roadmap 5.9b): the control loaded the score but
    // never told the shell to navigate, so pressing it appeared to do nothing.
    expect(onOpenDemo).toHaveBeenCalledTimes(1)
  })

  it('an exercise that does not open the practice screen does not touch scoreStore', async () => {
    const user = userEvent.setup()
    render(<LessonsScreen onOpen={() => {}} onOpenDemo={vi.fn()} />)

    const firstLesson = lessonsForLevel(CURRICULUM, 1)[0]
    if (firstLesson === undefined) throw new Error('expected level 1 to have lessons')
    const nonPlayExercise = firstLesson.exercises.find((e) => e.kind !== 'play' && e.kind !== 'repertoire')
    if (nonPlayExercise === undefined) {
      throw new Error(`expected lesson ${firstLesson.id} to have a non-play exercise`)
    }

    await user.click(screen.getByRole('button', { name: `Open ${nonPlayExercise.title}` }))

    expect(useScoreStore.getState().loaded).toBeUndefined()
  })
})
