/**
 * The curriculum model (REQ-3.1.1, REQ-2.2): structural validation, lookup and
 * navigation over the levels -> units -> lessons -> exercises shape declared
 * in `@core/curriculum/types.ts`.
 *
 * `validateCurriculum` is the single gate authored content must pass before
 * anything else in the app (session building, progress tracking) trusts the
 * shape of a `Curriculum` value. It collects every problem rather than
 * stopping at the first, because authored content is fixed by hand and a
 * single-error report means fixing it one round-trip at a time.
 */

import { err, ok, type Result } from '@core/shared/result.ts'
import {
  MAX_LEVEL,
  MIN_LEVEL,
  type Curriculum,
  type CurriculumLevel,
  type Exercise,
  type ExitCriterion,
  type Lesson,
  type Track,
  type Unit,
} from '@core/curriculum/types.ts'

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

/** Structural validation of an authored curriculum. Returns every problem, not just the first. */
export function validateCurriculum(curriculum: Curriculum): Result<Curriculum, readonly string[]> {
  const messages: string[] = []

  validateLevelNumbers(curriculum.levels, messages)
  validateDuplicateIds('level', curriculum.levels.map((l) => String(l.number)), messages)

  const allUnits = curriculum.levels.flatMap((level) => level.units)
  validateDuplicateIds('unit', allUnits.map((u) => u.id), messages)
  validateDuplicateIds('lesson', curriculum.lessons.map((l) => l.id), messages)

  const allExercises = curriculum.lessons.flatMap((l) => l.exercises)
  validateDuplicateIds('exercise', allExercises.map((e) => e.id), messages)

  const unitMap = new Map(allUnits.map((u) => [u.id, u]))
  const lessonMap = new Map(curriculum.lessons.map((l) => [l.id, l]))

  validateLevels(curriculum.levels, messages)
  validateUnits(curriculum.levels, lessonMap, messages)
  validateLessons(curriculum.lessons, unitMap, messages)
  validateOrphanLessons(curriculum.lessons, allUnits, messages)
  validateExercises(curriculum.lessons, messages)

  return messages.length > 0 ? err(messages) : ok(curriculum)
}

function validateLevelNumbers(levels: readonly CurriculumLevel[], messages: string[]): void {
  if (levels.length === 0) {
    messages.push('curriculum: has no levels')
  }
  const numbers = levels.map((l) => l.number)
  for (const n of numbers) {
    if (n < MIN_LEVEL || n > MAX_LEVEL) {
      messages.push(`level ${n}: number is outside ${MIN_LEVEL}..${MAX_LEVEL}`)
    }
  }
  const sorted = [...new Set(numbers)].sort((a, b) => a - b)
  const expected = Array.from({ length: sorted.length }, (_, i) => MIN_LEVEL + i)
  const isContiguousFromMin = sorted.every((n, i) => n === expected[i])
  if (!isContiguousFromMin) {
    messages.push(
      `levels: numbers [${numbers.join(', ')}] are not contiguous starting at ${MIN_LEVEL}`,
    )
  }
}

function validateDuplicateIds(kind: string, ids: readonly string[], messages: string[]): void {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id)
    seen.add(id)
  }
  for (const id of duplicates) {
    messages.push(`${kind} ${id}: duplicate id`)
  }
}

function validateLevels(levels: readonly CurriculumLevel[], messages: string[]): void {
  for (const level of levels) {
    if (level.units.length === 0) {
      messages.push(`level ${level.number}: has no units`)
    }
    if (level.exitCriteria.length === 0) {
      messages.push(`level ${level.number}: has no exit criteria`)
    }
    validateDuplicateIds(
      `level ${level.number} exit criterion`,
      level.exitCriteria.map((c) => c.id),
      messages,
    )
    for (const criterion of level.exitCriteria) {
      validateExitCriterion(level.number, criterion, messages)
    }
  }
}

function validateExitCriterion(
  levelNumber: number,
  criterion: ExitCriterion,
  messages: string[],
): void {
  const label = `level ${levelNumber} exit criterion ${criterion.id}`
  const check = criterion.check
  switch (check.kind) {
    case 'assessment':
      if (!isUnitInterval(check.minAccuracy)) {
        messages.push(`${label}: minAccuracy ${check.minAccuracy} is outside 0..1`)
      }
      break
    case 'sight-reading':
      if (!isLevelNumber(check.minLevel)) {
        messages.push(`${label}: minLevel ${check.minLevel} is outside ${MIN_LEVEL}..${MAX_LEVEL}`)
      }
      if (!isUnitInterval(check.minAccuracy)) {
        messages.push(`${label}: minAccuracy ${check.minAccuracy} is outside 0..1`)
      }
      break
    case 'theory-quiz':
      if (!isUnitInterval(check.minRetention)) {
        messages.push(`${label}: minRetention ${check.minRetention} is outside 0..1`)
      }
      break
    case 'ear-training':
      if (!isLevelNumber(check.minLevel)) {
        messages.push(`${label}: minLevel ${check.minLevel} is outside ${MIN_LEVEL}..${MAX_LEVEL}`)
      }
      break
    case 'technique':
      if (!(check.minBpm > 0)) {
        messages.push(`${label}: minBpm ${check.minBpm} is not positive`)
      }
      break
    default:
      // Exhaustiveness is enforced by the discriminated union; an unknown kind
      // here would be a type error at compile time, so there is nothing to do
      // at runtime beyond leaving it unflagged.
      break
  }
}

function isUnitInterval(value: number): boolean {
  return value >= 0 && value <= 1
}

function isLevelNumber(value: number): boolean {
  return value >= MIN_LEVEL && value <= MAX_LEVEL
}

function validateUnits(
  levels: readonly CurriculumLevel[],
  lessonMap: Map<string, Lesson>,
  messages: string[],
): void {
  const allLessonIdEntries: string[] = []
  for (const level of levels) {
    for (const unit of level.units) {
      if (unit.levelNumber !== level.number) {
        messages.push(
          `unit ${unit.id}: levelNumber ${unit.levelNumber} does not match holding level ${level.number}`,
        )
      }
      for (const lessonId of unit.lessonIds) {
        allLessonIdEntries.push(lessonId)
        const lesson = lessonMap.get(lessonId)
        if (lesson === undefined) {
          messages.push(`unit ${unit.id}: lessonIds entry ${lessonId} has no lesson`)
        } else if (lesson.unitId !== unit.id) {
          messages.push(
            `unit ${unit.id}: lesson ${lessonId} is listed here but its unitId is ${lesson.unitId}`,
          )
        }
      }
    }
  }
  validateDuplicateIds('unit lessonIds entry', allLessonIdEntries, messages)
}

function validateLessons(
  lessons: readonly Lesson[],
  unitMap: Map<string, Unit>,
  messages: string[],
): void {
  for (const lesson of lessons) {
    if (!unitMap.has(lesson.unitId)) {
      messages.push(`lesson ${lesson.id}: unitId ${lesson.unitId} names no unit`)
    }
    if (lesson.exercises.length === 0) {
      messages.push(`lesson ${lesson.id}: has no exercises`)
    }
    if (lesson.demoScoreId === undefined || lesson.demoScoreId.trim().length === 0) {
      messages.push(`lesson ${lesson.id}: has no demonstration (REQ-3.1.3)`)
    }
    if (lesson.explanation.trim().length === 0) {
      messages.push(`lesson ${lesson.id}: explanation is empty`)
    }
    if (
      lesson.track === 'theory' &&
      !lesson.exercises.some(
        (e) => e.kind === 'play' || e.kind === 'technique' || e.kind === 'repertoire',
      )
    ) {
      messages.push(`lesson ${lesson.id}: theory lesson has no playing task (REQ-3.1.2)`)
    }
  }
}

function validateOrphanLessons(
  lessons: readonly Lesson[],
  units: readonly Unit[],
  messages: string[],
): void {
  const listedLessonIds = new Set(units.flatMap((u) => u.lessonIds))
  for (const lesson of lessons) {
    if (!listedLessonIds.has(lesson.id)) {
      messages.push(`lesson ${lesson.id}: no unit lists it`)
    }
  }
}

function validateExercises(lessons: readonly Lesson[], messages: string[]): void {
  for (const lesson of lessons) {
    for (const exercise of lesson.exercises) {
      if (!(exercise.estimatedMinutes > 0)) {
        messages.push(
          `exercise ${exercise.id}: estimatedMinutes ${exercise.estimatedMinutes} is not positive`,
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// lookup
// ---------------------------------------------------------------------------

export function levelAt(curriculum: Curriculum, levelNumber: number): CurriculumLevel | undefined {
  return curriculum.levels.find((l) => l.number === levelNumber)
}

export function lessonById(curriculum: Curriculum, lessonId: string): Lesson | undefined {
  return curriculum.lessons.find((l) => l.id === lessonId)
}

export function unitById(curriculum: Curriculum, unitId: string): Unit | undefined {
  for (const level of curriculum.levels) {
    const found = level.units.find((u) => u.id === unitId)
    if (found !== undefined) return found
  }
  return undefined
}

/** Every lesson of a level, in unit order then lesson order. */
export function lessonsForLevel(curriculum: Curriculum, levelNumber: number): readonly Lesson[] {
  const level = levelAt(curriculum, levelNumber)
  if (level === undefined) return []
  const result: Lesson[] = []
  for (const unit of level.units) {
    for (const lessonId of unit.lessonIds) {
      const lesson = lessonById(curriculum, lessonId)
      if (lesson !== undefined) result.push(lesson)
    }
  }
  return result
}

export function lessonsForTrack(
  curriculum: Curriculum,
  levelNumber: number,
  track: Track,
): readonly Lesson[] {
  return lessonsForLevel(curriculum, levelNumber).filter((l) => l.track === track)
}

/** The lesson after `lessonId` in the same level, or the first of the next level. */
export function nextLesson(curriculum: Curriculum, lessonId: string): Lesson | undefined {
  const lesson = lessonById(curriculum, lessonId)
  if (lesson === undefined) return undefined
  const unit = unitById(curriculum, lesson.unitId)
  if (unit === undefined) return undefined
  const level = levelAt(curriculum, unit.levelNumber)
  if (level === undefined) return undefined

  const levelLessons = lessonsForLevel(curriculum, level.number)
  const index = levelLessons.findIndex((l) => l.id === lessonId)
  if (index === -1) return undefined

  const withinLevel = levelLessons[index + 1]
  if (withinLevel !== undefined) return withinLevel

  const sortedLevels = [...curriculum.levels].sort((a, b) => a.number - b.number)
  const levelIndex = sortedLevels.findIndex((l) => l.number === level.number)
  if (levelIndex === -1) return undefined

  for (let i = levelIndex + 1; i < sortedLevels.length; i += 1) {
    const nextLevel = sortedLevels[i]
    if (nextLevel === undefined) continue
    const nextLevelLessons = lessonsForLevel(curriculum, nextLevel.number)
    const first = nextLevelLessons[0]
    if (first !== undefined) return first
  }
  return undefined
}

/** Total estimated minutes of a lesson's exercises. */
export function lessonMinutes(lesson: Lesson): number {
  return lesson.exercises.reduce((total, exercise: Exercise) => total + exercise.estimatedMinutes, 0)
}
