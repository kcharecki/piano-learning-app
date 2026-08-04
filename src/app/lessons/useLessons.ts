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
import { useMemo, useState } from 'react'
import { useScoreStore } from '@app/state/scoreStore.ts'
import { CURRICULUM } from '@content/curriculum/curriculum.ts'
import { demoScoreById } from '@content/scores/demoScores.ts'
import {
  lessonById,
  lessonMinutes,
  lessonsForLevel,
  nextLesson,
} from '@core/curriculum/model.ts'
import type { Lesson } from '@core/curriculum/types.ts'
import { writeMusicXml } from '@core/notation/musicxmlwriter.ts'

export type UseLessonsResult = {
  readonly level: number
  readonly levels: readonly number[]
  setLevel(level: number): void
  /** Lessons of `level`, in `lessonsForLevel` order. */
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

  const [level, setLevelRaw] = useState<number>(() => CURRICULUM_LEVELS[0] ?? 1)
  const [selectedLessonId, setSelectedLessonId] = useState<string | undefined>(undefined)

  const lessons = useMemo(() => lessonsForLevel(CURRICULUM, level), [level])

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
    lessons,
    selected,
    selectLesson,
    selectedMinutes,
    next,
    goToNext,
    openDemoScore,
  }
}
