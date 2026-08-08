/**
 * The Lessons destination (roadmap 4.9b, REQ-3.1.1/3.1.2/3.1.3): a level
 * picker, the lesson list for that level, and the selected lesson's body,
 * demonstration and exercises. `useLessons` owns all the curriculum lookup;
 * this screen only renders it and forwards which exercise the learner opened
 * — the same shape as `SessionPlanScreen`'s `onOpen` prop.
 *
 * THE GAP THIS SCREEN CLOSES: a `play` (or `repertoire`) exercise carries no
 * `params`, and the shell routes both kinds to the practice screen, which
 * renders whatever score already sits in `scoreStore` — not the lesson's own
 * demonstration. So before forwarding one of those exercises to `onOpen`,
 * this screen loads the selected lesson's demo score first
 * (`useLessons().openDemoScore`), and offers the same action as its own
 * explicit "Open demonstration" control for opening the demo with no
 * exercise involved.
 */
import { lessonMinutes } from '@core/curriculum/model.ts'
import type { Exercise } from '@core/curriculum/types.ts'
import { demoScoreById } from '@content/scores/demoScores.ts'
import { LessonBody } from './LessonBody.tsx'
import { useLessons } from './useLessons.ts'

export type LessonsScreenProps = {
  /** Called when the learner opens an exercise; the shell routes it, exactly as
   *  `SessionPlanScreen` already does. The demo score is loaded FIRST for
   *  practice-screen destinations. */
  readonly onOpen: (exercise: Exercise) => void
  /** Called after "Open demonstration" loads the demo score into `scoreStore`,
   *  so the shell can navigate to Practice — the control used to load the
   *  score and leave the learner on the Lessons screen with no visible change
   *  (roadmap 5.9b). */
  readonly onOpenDemo: () => void
}

/** The two exercise kinds the shell routes to the practice screen, per
 * `Shell.tsx`'s `destinationFor` — duplicated here only as a check of
 * "does this exercise need the lesson's demo score loaded first", not as a
 * second router. */
function opensPracticeScreen(exercise: Exercise): boolean {
  return exercise.kind === 'play' || exercise.kind === 'repertoire'
}

export function LessonsScreen({ onOpen, onOpenDemo }: LessonsScreenProps) {
  const {
    level,
    levels,
    setLevel,
    lessons,
    track,
    setTrack,
    tracks,
    selected,
    selectLesson,
    selectedMinutes,
    next,
    goToNext,
    openDemoScore,
  } = useLessons()

  function handleOpenExercise(exercise: Exercise): void {
    if (opensPracticeScreen(exercise)) openDemoScore()
    onOpen(exercise)
  }

  function handleOpenDemo(): void {
    openDemoScore()
    onOpenDemo()
  }

  const demo = selected?.demoScoreId === undefined ? undefined : demoScoreById(selected.demoScoreId)

  return (
    <div className="lessons-screen">
      <h2>Lessons</h2>

      <div role="group" aria-label="Level">
        {levels.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={level === n}
            onClick={() => setLevel(n)}
          >
            Level {n}
          </button>
        ))}
      </div>

      {/* Level 1 alone ships 16 lessons across three tracks, so the theory
          thread REQ-3.1.2 cares about is otherwise buried among the playing
          lessons. Filtering runs through `lessonsForTrack`, not a local
          `.filter`, so the screen and the model agree on what a track is. */}
      <div role="group" aria-label="Track">
        <button type="button" aria-pressed={track === undefined} onClick={() => setTrack(undefined)}>
          All tracks
        </button>
        {tracks.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={track === t}
            data-testid={`lessons-track-${t}`}
            onClick={() => setTrack(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <ul className="list" aria-label="Lessons">
        {lessons.map((lesson) => (
          <li key={lesson.id}>
            <button
              type="button"
              aria-pressed={selected?.id === lesson.id}
              onClick={() => selectLesson(lesson.id)}
            >
              {lesson.title}
            </button>
            <span>
              {' — '}
              {lesson.track}
              {' — '}
              <span data-testid={`lesson-minutes-${lesson.id}`}>{lessonMinutes(lesson)} min</span>
            </span>
          </li>
        ))}
      </ul>

      {selected === undefined && <p role="status">No lessons for this level.</p>}

      {selected !== undefined && (
        <section aria-label="Lesson">
          <h3>{selected.title}</h3>
          <p data-testid="lessons-selected-minutes">{selectedMinutes} min total</p>

          <LessonBody explanation={selected.explanation} />

          <button type="button" onClick={handleOpenDemo}>
            Open demonstration
          </button>
          {demo !== undefined && <p>Demonstration: {demo.title}</p>}

          <ul className="list" aria-label="Exercises">
            {selected.exercises.map((exercise) => (
              <li key={exercise.id}>
                <span>{exercise.title}</span>
                {' — '}
                <span>{exercise.estimatedMinutes} min</span>{' '}
                <button
                  type="button"
                  aria-label={`Open ${exercise.title}`}
                  onClick={() => handleOpenExercise(exercise)}
                >
                  Open
                </button>
              </li>
            ))}
          </ul>

          {next !== undefined && (
            <button type="button" onClick={goToNext}>
              Next lesson: {next.title}
            </button>
          )}
        </section>
      )}
    </div>
  )
}
