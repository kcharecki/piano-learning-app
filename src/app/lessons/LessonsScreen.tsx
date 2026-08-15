/**
 * The Lessons destination (roadmap 4.9b, REQ-3.1.1/3.1.2/3.1.3; redesigned
 * UI-20, 2026-08-12 UI audit — see `docs/ui-audit/lessons--desktop--dark.png`):
 * a master-detail layout. `useLessons` owns all the curriculum lookup; this
 * screen only renders it and forwards which exercise the learner opened —
 * the same shape as `SessionPlanScreen`'s `onOpen` prop.
 *
 * THE DEFECT THIS REDESIGN CLOSES: the old layout stacked sixteen full-width
 * lesson buttons ABOVE the selected lesson's body, so reading a lesson meant
 * scrolling past the entire catalogue first. Now the catalogue is a
 * persistent left column (`.lessons-list-pane`) and the selected lesson's
 * body is a right column (`.lessons-body-pane`) that never moves when a
 * different row is picked — see `feature-lessons.css` for the >=1024px
 * two-column grid and the <1024px collapse to one pane at a time, switched
 * by `mobileView` below (a pure presentation toggle: CSS decides whether it
 * has any visible effect, since above 1024px both panes render
 * unconditionally regardless of this state).
 *
 * COMPLETION STATE: the brief for this task asked for a `check` icon on
 * completed rows IF real completion data exists. It does not — grepped
 * `useLessons`, `progressStore` (assessments/recordings/practiceEntries) and
 * every curriculum/progress module in `src/core` for a per-lesson "done"
 * signal and found none; `practiceEntries` records time spent on a lesson
 * title, not a completion boolean, and inferring "completed" from "was
 * visited" would be inventing a signal the product does not have. So no
 * completion indicator renders here — see this task's build report.
 *
 * THE GAP THIS SCREEN ALSO CLOSES (unchanged from before the redesign): a
 * `play` (or `repertoire`) exercise carries no `params`, and the shell routes
 * both kinds to the practice screen, which renders whatever score already
 * sits in `scoreStore` — not the lesson's own demonstration. So before
 * forwarding one of those exercises to `onOpen`, this screen loads the
 * selected lesson's demo score first (`useLessons().openDemoScore`), and
 * offers the same action as its own explicit "Open demonstration" control for
 * opening the demo with no exercise involved.
 *
 * FILTER MERGE (UI-30): the level tabs (5 buttons) and track chips (4
 * buttons) used to sit side by side as two always-visible axes — nine
 * buttons of filter, more controls than the list they filter has rows on a
 * narrow level. Level stays a `.seg-control` exactly as it was (several
 * protected e2e specs click `getByRole('button', { name: 'Level 3' })`
 * directly — see this task's build report for the exact files/lines); track
 * is now a `<details>` disclosure closed by default, its `<summary>` stating
 * the active track in words so collapsing it never hides why the list below
 * is short (screen rules 6/7). See `feature-lessons.css`'s
 * `.lessons-track-filter` for the visual side of the merge.
 */
import { lessonMinutes } from '@core/curriculum/model.ts'
import type { Exercise, ExerciseKind, Track } from '@core/curriculum/types.ts'
import { demoScoreById } from '@content/scores/demoScores.ts'
import { Icon } from '@app/ui/Icon.tsx'
import type { IconName } from '../../design-system/icons/icons.ts'
import { useState } from 'react'
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

/** One glance should say what a row or a filter chip is, before reading its
 * label (rule 4 of the nine screen rules). */
const TRACK_ICONS: Readonly<Record<Track, IconName>> = {
  playing: 'keyboard',
  'sight-reading': 'book',
  theory: 'cards',
}

const TRACK_LABELS: Readonly<Record<Track, string>> = {
  playing: 'Playing',
  'sight-reading': 'Sight-reading',
  theory: 'Theory',
}

const EXERCISE_ICONS: Readonly<Record<ExerciseKind, IconName>> = {
  play: 'keyboard',
  repertoire: 'keyboard',
  'sight-read': 'book',
  'theory-quiz': 'cards',
  'ear-training': 'ear',
  technique: 'hand',
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

  // Which pane is on screen below the 1024px collapse (feature-lessons.css).
  // Has no visible effect at >=1024px, where both panes render together —
  // see the module doc above.
  const [mobileView, setMobileView] = useState<'list' | 'body'>('list')

  function handleSelectLesson(lessonId: string): void {
    selectLesson(lessonId)
    setMobileView('body')
  }

  function handleOpenExercise(exercise: Exercise): void {
    if (opensPracticeScreen(exercise)) openDemoScore()
    onOpen(exercise)
  }

  function handleOpenDemo(): void {
    openDemoScore()
    onOpenDemo()
  }

  const demo = selected?.demoScoreId === undefined ? undefined : demoScoreById(selected.demoScoreId)

  // DEFECT FOUND AND FIXED HERE (screen-level only, `useLessons` untouched —
  // see this task's build report): `useLessons`'s own `selected` is valid for
  // the current LEVEL only (its own module doc says so), not the current
  // TRACK filter, so narrowing the track filter past the already-selected
  // lesson used to leave `.lessons-body-pane` showing that stale, no-longer-
  // listed lesson while the list beside it now teaches "no lessons here" —
  // two panes visibly disagreeing about what is selected. Rather than change
  // `selected`'s own semantics (risky: `goToNext` deliberately walks to the
  // next lesson regardless of the CURRENT track filter, and making `selected`
  // require track membership would silently jump it to some other lesson
  // instead), this is a presentation-only guard: render the body pane only
  // when `selected` is actually one of the rows `lessons` (level+track
  // filtered) is showing right now.
  const selectedVisible = selected !== undefined && lessons.some((l) => l.id === selected.id)

  return (
    <div className="page page--wide lessons-screen" data-mobile-view={mobileView}>
      <header className="page-header">
        <h1>Lessons</h1>
      </header>

      <div className="lessons-layout">
        <div className="lessons-list-pane">
          <div className="lessons-filters">
            <div className="seg-control lessons-level-control" role="group" aria-label="Level">
              {levels.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={level === n}
                  className={level === n ? 'selected' : undefined}
                  onClick={() => setLevel(n)}
                >
                  Level {n}
                </button>
              ))}
            </div>

            {/* Level 1 alone ships 16 lessons across three tracks, so the theory
                thread REQ-3.1.2 cares about is otherwise buried among the playing
                lessons. Filtering runs through `lessonsForTrack`, not a local
                `.filter`, so the screen and the model agree on what a track is.

                UI-30: the track axis used to be four always-visible chips sitting
                right under the five level tabs — nine buttons of filter before a
                single lesson was on screen, competing with the list they filter
                (rule 2/4). It is now ONE disclosure: closed by default (matching
                the default `track === undefined` state, i.e. nothing to disclose),
                its `<summary>` doubling as the "stated in words" readout of
                whichever track is active (rule 6/7) so collapsing it never hides
                *why* the list is short. The four buttons inside are the exact
                buttons that were here before — same `data-testid`s, same
                `setTrack` calls — only their container changed, so every
                level+track combination the old layout reached is still reachable
                the same way, just one click further behind the summary toggle. */}
            <details className="lessons-track-filter">
              <summary>
                <Icon name="chevron-down" />
                {/* Prefixed "Track:" even in the unfiltered case, deliberately
                    distinct wording from the "All tracks" button one line down
                    — the summary is a STATEMENT ("Track: all tracks"), the
                    button is a COMMAND ("All tracks"), so the two never read
                    as the same control once the disclosure is open. */}
                Track: {track === undefined ? 'all tracks' : TRACK_LABELS[track]}
              </summary>
              <div className="lessons-track-chips" role="group" aria-label="Track">
                <button
                  type="button"
                  aria-pressed={track === undefined}
                  className={track === undefined ? 'selected' : undefined}
                  onClick={() => setTrack(undefined)}
                >
                  All tracks
                </button>
                {tracks.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={track === t}
                    data-testid={`lessons-track-${t}`}
                    className={track === t ? 'selected' : undefined}
                    onClick={() => setTrack(t)}
                  >
                    <Icon name={TRACK_ICONS[t]} />
                    {TRACK_LABELS[t]}
                  </button>
                ))}
              </div>
            </details>

            {/* The words that say why the list below is the length it is (rule
                6/7) — level and track together, not split across two controls
                the learner has to reconcile themselves. Not interactive, so it
                does not add to the screen's control count. */}
            <p className="lessons-filter-summary">
              {lessons.length} lesson{lessons.length === 1 ? '' : 's'} · Level {level} ·{' '}
              {track === undefined ? 'all tracks' : TRACK_LABELS[track]}
            </p>
          </div>

          <ul className="list lessons-list" aria-label="Lessons">
            {lessons.map((lesson) => (
              <li key={lesson.id}>
                <button
                  type="button"
                  className="lessons-row"
                  aria-current={selected?.id === lesson.id ? 'true' : undefined}
                  aria-label={lesson.title}
                  onClick={() => handleSelectLesson(lesson.id)}
                >
                  <span className="lessons-row-title">{lesson.title}</span>
                  <span className="lessons-row-meta">
                    <span className="badge lessons-row-track">{TRACK_LABELS[lesson.track]}</span>
                    <span data-testid={`lesson-minutes-${lesson.id}`}>{lessonMinutes(lesson)} min</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {/* Rule 6: an empty result teaches — say what would match instead of a
              bare "no items", and offer the one action that gets the learner
              back to something (only the TRACK filter narrows past zero; level
              alone never does, since every level ships at least one lesson). */}
          {lessons.length === 0 && (
            <div className="lessons-empty" role="status">
              <p>
                No {track === undefined ? '' : `${TRACK_LABELS[track].toLowerCase()} `}
                lessons in Level {level} yet.
              </p>
              {track !== undefined && (
                <button type="button" className="btn-ghost" onClick={() => setTrack(undefined)}>
                  Show every track
                </button>
              )}
            </div>
          )}
        </div>

        {selectedVisible && selected !== undefined && (
          <div className="lessons-body-pane">
            <button type="button" className="btn-ghost lessons-back" onClick={() => setMobileView('list')}>
              <Icon name="chevron-right" />
              Back to lessons
            </button>

            <section className="card lessons-body-card" aria-label="Lesson">
              <h2>{selected.title}</h2>
              <p className="lessons-body-duration" data-testid="lessons-selected-minutes">
                {selectedMinutes} min total
              </p>

              <LessonBody explanation={selected.explanation} />

              <button type="button" className="btn-ghost lessons-open-demo" onClick={handleOpenDemo}>
                <Icon name="play" />
                Open demonstration
              </button>
              {demo !== undefined && <p className="lessons-demo-note">Demonstration: {demo.title}</p>}

              <ul className="list lessons-exercises" aria-label="Exercises">
                {selected.exercises.map((exercise) => (
                  <li key={exercise.id}>
                    <button
                      type="button"
                      className="card--sunken lessons-exercise-item"
                      aria-label={`Open ${exercise.title}`}
                      onClick={() => handleOpenExercise(exercise)}
                    >
                      <Icon name={EXERCISE_ICONS[exercise.kind]} />
                      <span className="lessons-exercise-title">{exercise.title}</span>
                      <span className="badge lessons-exercise-duration">{exercise.estimatedMinutes} min</span>
                      <Icon name="chevron-right" />
                    </button>
                  </li>
                ))}
              </ul>

              {next !== undefined && (
                <button type="button" className="btn-primary lessons-next-footer" onClick={goToNext}>
                  Next lesson: {next.title}
                </button>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
