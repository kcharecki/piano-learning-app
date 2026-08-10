/**
 * Wires the authored curriculum (`@content/curriculum/curriculum.ts`) to the
 * lesson screen (roadmap 4.9b, REQ-3.1.1/3.1.2/3.1.3). Every piece of
 * navigation — the lessons of a level, the lesson after this one, a lesson's
 * total estimated minutes — is delegated to the EXISTING functions in
 * `@core/curriculum/model.ts` rather than re-derived here: this hook is
 * wiring, not a second implementation of curriculum lookup.
 *
 * `level` and `selected` are kept in sync deliberately: `selected` is only
 * ever a lesson that actually belongs to `level` (checked by scanning
 * `lessonsForLevel` for every level this hook knows about, the same function
 * `lessons` itself is built from — no second source of "which level is this
 * lesson in"). Choosing a lesson that lives in a different level (via
 * `selectLesson` or `goToNext` crossing a level boundary) therefore moves
 * `level` to follow it, so the picker and the lesson list the learner is
 * looking at never disagree with what is selected. An id that names no
 * lesson at all (`selectLesson` with a typo, a stale link) is ignored rather
 * than leaving `selected` pointing at nothing — the previous, still-valid
 * selection is kept.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createBrowserClock } from '@app/practice/clock.ts'
import { usePracticeLog } from '@app/practice/usePracticeLog.ts'
import { useScoreStore } from '@app/state/scoreStore.ts'
import { CURRICULUM } from '@content/curriculum/curriculum.ts'
import { demoScoreById } from '@content/scores/demoScores.ts'
import {
  lessonById,
  lessonMinutes,
  lessonsForLevel,
  lessonsForTrack,
  nextLesson,
} from '@core/curriculum/model.ts'
import { TRACKS, type Lesson, type Track } from '@core/curriculum/types.ts'
import { writeMusicXml } from '@core/notation/musicxmlwriter.ts'

export type UseLessonsResult = {
  readonly level: number
  readonly levels: readonly number[]
  setLevel(level: number): void
  /**
   * Which track the list is filtered to, or `undefined` for all three. Level 1
   * alone ships 16 lessons across three tracks, so an unfiltered list buries
   * the theory thread REQ-3.1.2 cares about among the playing lessons.
   */
  readonly track: Track | undefined
  setTrack(track: Track | undefined): void
  readonly tracks: readonly Track[]
  /** Lessons of `level`, in `lessonsForLevel` order, narrowed by `track` via `lessonsForTrack`. */
  readonly lessons: readonly Lesson[]
  /** `undefined` when `lessons` is empty. */
  readonly selected: Lesson | undefined
  selectLesson(lessonId: string): void
  /** Total estimated minutes of `selected`'s exercises, via `lessonMinutes`. */
  readonly selectedMinutes: number
  /** The next lesson after `selected`, via `nextLesson`; `undefined` at the end. */
  readonly next: Lesson | undefined
  goToNext(): void
  /** Loads `selected`'s `demoScoreId` into `scoreStore`. No-op if it does not resolve. */
  readonly openDemoScore: () => void
}

const CURRICULUM_LEVELS: readonly number[] = CURRICULUM.levels.map((l) => l.number)

/** Which of `CURRICULUM_LEVELS` holds `lessonId`, found the same way `lessons`
 * itself is built — by asking `lessonsForLevel`, not a second lookup path. */
function levelOfLesson(lessonId: string): number | undefined {
  for (const levelNumber of CURRICULUM_LEVELS) {
    if (lessonsForLevel(CURRICULUM, levelNumber).some((l) => l.id === lessonId)) {
      return levelNumber
    }
  }
  return undefined
}

export function useLessons(): UseLessonsResult {
  const loadScore = useScoreStore((s) => s.loadScore)

  // REQ-3.9.5 (roadmap 5.14): no `Clock`/`DateSource` is threaded through
  // this hook's public options today — both are synthesized here purely to
  // give `usePracticeLog` what `PracticeTimer`'s constructor needs.
  const [clock] = useState(() => createBrowserClock())
  const [date] = useState(() => ({ epochMillis: () => Date.now() }))
  const practiceLog = usePracticeLog({ clock, date })
  const practiceLogRef = useRef(practiceLog)
  practiceLogRef.current = practiceLog

  const [level, setLevelRaw] = useState<number>(() => CURRICULUM_LEVELS[0] ?? 1)
  const [track, setTrack] = useState<Track | undefined>(undefined)
  const [selectedLessonId, setSelectedLessonId] = useState<string | undefined>(undefined)

  const lessons = useMemo(
    () =>
      track === undefined
        ? lessonsForLevel(CURRICULUM, level)
        : lessonsForTrack(CURRICULUM, level, track),
    [level, track],
  )

  // `selected` is derived, not stored directly: it is `selectedLessonId`'s
  // lesson ONLY when that lesson actually lives in the current `level`,
  // otherwise it falls back to `lessons[0]`. This is what makes plain
  // `setLevel` calls (the level picker) land on a sensible default without
  // any extra reset logic, and what makes an unresolved `selectLesson` id
  // degrade to "keep the existing default" instead of a blank screen.
  const selected = useMemo<Lesson | undefined>(() => {
    if (selectedLessonId !== undefined) {
      const lesson = lessonById(CURRICULUM, selectedLessonId)
      if (lesson !== undefined && levelOfLesson(selectedLessonId) === level) return lesson
    }
    return lessons[0]
  }, [selectedLessonId, level, lessons])

  // REQ-3.9.5 (roadmap 5.14): time spent reading a lesson's body is worth
  // logging even though the lesson itself has no phase machine — the
  // natural boundary is "which lesson is `selected`", one entry per lesson
  // viewed, closed and reopened whenever `selected` changes; the unmount
  // safety net in `usePracticeLog` closes the final one. Opening a demo or
  // exercise navigates to another screen that logs its own kind — this
  // only ever covers time spent on THIS screen.
  //
  // The start() itself is deferred by a macrotask and cancelled in cleanup
  // — see `useFlashcardDrill.ts`'s identical effect for why: React 18
  // StrictMode's synchronous mount->cleanup->remount double-invoke would
  // otherwise open and immediately close a real, stored, near-zero-duration
  // session on every fresh mount, since a `PracticeTimer` session is not an
  // idempotent resource the way a subscription is.
  const selectedId = selected?.id
  useEffect(() => {
    const timer = setTimeout(() => {
      practiceLogRef.current.stop()
      if (selectedId === undefined) return
      const title = lessonById(CURRICULUM, selectedId)?.title ?? selectedId
      practiceLogRef.current.start('lesson', title)
    }, 0)
    return () => {
      clearTimeout(timer)
      practiceLogRef.current.stop()
    }
  }, [selectedId])

  function setLevel(nextLevel: number): void {
    setLevelRaw(nextLevel)
  }

  /** Selects `lessonId` and moves `level` to wherever it actually lives.
   * An id that names no real lesson is ignored — see the module comment. */
  function selectLesson(lessonId: string): void {
    const targetLevel = levelOfLesson(lessonId)
    if (targetLevel === undefined) return
    setSelectedLessonId(lessonId)
    setLevelRaw(targetLevel)
  }

  const selectedMinutes = selected === undefined ? 0 : lessonMinutes(selected)

  const next = selected === undefined ? undefined : nextLesson(CURRICULUM, selected.id)

  function goToNext(): void {
    if (next === undefined) return
    selectLesson(next.id)
  }

  function openDemoScore(): void {
    if (selected === undefined) return
    const demoScoreId = selected.demoScoreId
    if (demoScoreId === undefined) return
    const demo = demoScoreById(demoScoreId)
    if (demo === undefined) return
    loadScore({
      score: demo.score,
      sourceName: `Demonstration: ${selected.title}`,
      musicXml: writeMusicXml(demo.score),
    })
  }

  return {
    level,
    levels: CURRICULUM_LEVELS,
    setLevel,
    track,
    setTrack,
    tracks: TRACKS,
    lessons,
    selected,
    selectLesson,
    selectedMinutes,
    next,
    goToNext,
    openDemoScore,
  }
}
