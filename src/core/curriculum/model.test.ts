import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { at } from '@core/shared/invariant.ts'
import {
  MAX_LEVEL,
  MIN_LEVEL,
  TRACKS,
  type Curriculum,
  type CurriculumLevel,
  type Exercise,
  type ExitCriterion,
  type Lesson,
  type Track,
  type Unit,
} from '@core/curriculum/types.ts'
import {
  lessonById,
  lessonMinutes,
  lessonsForLevel,
  lessonsForTrack,
  levelAt,
  nextLesson,
  unitById,
  validateCurriculum,
} from './model.ts'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

/**
 * A small, deliberately varied valid curriculum: two levels, three units,
 * four lessons across all three tracks, five exercises. Big enough to exercise
 * ordering, filtering and cross-boundary navigation without being unwieldy.
 */
const validCurriculum: Curriculum = {
  levels: [
    {
      number: 1,
      title: 'Level 1',
      units: [
        {
          id: 'unit-1a',
          levelNumber: 1,
          title: 'Unit 1a',
          lessonIds: ['lesson-1a1', 'lesson-1a2'],
        },
        {
          id: 'unit-1b',
          levelNumber: 1,
          title: 'Unit 1b',
          lessonIds: ['lesson-1b1'],
        },
      ],
      exitCriteria: [
        {
          id: 'exit-1',
          track: 'playing',
          description: 'Play grade 1 pieces at tempo.',
          check: { kind: 'assessment', minAccuracy: 0.8 },
        },
        {
          id: 'exit-1-theory',
          track: 'theory',
          description: 'Retain grade 1 theory.',
          check: { kind: 'theory-quiz', minRetention: 0 },
        },
        {
          id: 'exit-1-ear',
          track: 'playing',
          description: 'Recognise grade 1 intervals by ear.',
          check: { kind: 'ear-training', minLevel: MIN_LEVEL },
        },
        {
          id: 'exit-1-technique',
          track: 'playing',
          description: 'Play scales at tempo.',
          check: { kind: 'technique', drillId: 'd1', minBpm: 1 },
        },
      ],
    },
    {
      number: 2,
      title: 'Level 2',
      units: [
        {
          id: 'unit-2a',
          levelNumber: 2,
          title: 'Unit 2a',
          lessonIds: ['lesson-2a1'],
        },
      ],
      exitCriteria: [
        {
          id: 'exit-2',
          track: 'sight-reading',
          description: 'Sight-read at level 2.',
          check: { kind: 'sight-reading', minLevel: 2, minAccuracy: 0.7 },
        },
      ],
    },
  ],
  lessons: [
    {
      id: 'lesson-1a1',
      unitId: 'unit-1a',
      track: 'playing',
      title: 'Lesson 1a1',
      explanation: 'Explanation 1a1.',
      demoScoreId: 'score-1a1',
      exercises: [
        { id: 'ex-1a1a', kind: 'play', title: 'Ex 1a1a', estimatedMinutes: 5 },
        { id: 'ex-1a1b', kind: 'technique', title: 'Ex 1a1b', estimatedMinutes: 3 },
      ],
    },
    {
      id: 'lesson-1a2',
      unitId: 'unit-1a',
      track: 'theory',
      title: 'Lesson 1a2',
      explanation: 'Explanation 1a2.',
      demoScoreId: 'score-1a2',
      exercises: [
        { id: 'ex-1a2a', kind: 'theory-quiz', title: 'Ex 1a2a', estimatedMinutes: 4 },
        { id: 'ex-1a2b', kind: 'play', title: 'Ex 1a2b', estimatedMinutes: 3 },
      ],
    },
    {
      id: 'lesson-1b1',
      unitId: 'unit-1b',
      track: 'sight-reading',
      title: 'Lesson 1b1',
      explanation: 'Explanation 1b1.',
      demoScoreId: 'score-1b1',
      exercises: [{ id: 'ex-1b1a', kind: 'sight-read', title: 'Ex 1b1a', estimatedMinutes: 6 }],
    },
    {
      id: 'lesson-2a1',
      unitId: 'unit-2a',
      track: 'playing',
      title: 'Lesson 2a1',
      explanation: 'Explanation 2a1.',
      demoScoreId: 'score-2a1',
      exercises: [{ id: 'ex-2a1a', kind: 'play', title: 'Ex 2a1a', estimatedMinutes: 5 }],
    },
  ],
}

// ---------------------------------------------------------------------------
// validateCurriculum: examples
// ---------------------------------------------------------------------------

describe('validateCurriculum', () => {
  it('accepts a well-formed curriculum', () => {
    const result = validateCurriculum(validCurriculum)
    expect(result.ok).toBe(true)
  })

  it('reports every problem, not just the first', () => {
    const broken: Curriculum = {
      levels: [
        {
          number: 1,
          title: 'L1',
          // levelNumber mismatch: unit says 2, holding level is 1.
          units: [{ id: 'u1', levelNumber: 2, title: 'U1', lessonIds: ['l1'] }],
          exitCriteria: [
            {
              id: 'ec1',
              track: 'playing',
              description: 'd',
              check: { kind: 'assessment', minAccuracy: 0.8 },
            },
          ],
        },
        {
          // not contiguous: level 2 is missing, jumps to 3.
          number: 3,
          title: 'L3',
          units: [{ id: 'u2', levelNumber: 3, title: 'U2', lessonIds: ['l2'] }],
          exitCriteria: [
            {
              id: 'ec2',
              track: 'playing',
              description: 'd',
              check: { kind: 'assessment', minAccuracy: 0.8 },
            },
          ],
        },
      ],
      lessons: [
        {
          id: 'l1',
          unitId: 'u1',
          track: 'playing',
          title: 'Lesson 1',
          explanation: 'exp',
          demoScoreId: 'score-l1',
          exercises: [], // no exercises
        },
        {
          id: 'l2',
          unitId: 'u2',
          track: 'playing',
          title: 'Lesson 2',
          explanation: 'exp',
          demoScoreId: 'score-l2',
          exercises: [{ id: 'e1', kind: 'play', title: 'Ex', estimatedMinutes: 5 }],
        },
      ],
    }

    const result = validateCurriculum(broken)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toHaveLength(3)
    expect(result.error.some((m) => m.includes('not contiguous'))).toBe(true)
    expect(result.error.some((m) => m.includes('u1: levelNumber 2 does not match'))).toBe(true)
    expect(result.error.some((m) => m.includes('l1: has no exercises'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// corruption helpers: build a new Curriculum with exactly one field changed
// ---------------------------------------------------------------------------

function replaceAt<T>(array: readonly T[], index: number, item: T): T[] {
  return array.map((x, i) => (i === index ? item : x))
}

function withLevelAt(
  curriculum: Curriculum,
  levelIndex: number,
  patch: Partial<CurriculumLevel>,
): Curriculum {
  const level = at(curriculum.levels, levelIndex)
  const levels = replaceAt(curriculum.levels, levelIndex, { ...level, ...patch })
  return { ...curriculum, levels }
}

function withUnitAt(
  curriculum: Curriculum,
  levelIndex: number,
  unitIndex: number,
  patch: Partial<Unit>,
): Curriculum {
  const level = at(curriculum.levels, levelIndex)
  const unit = at(level.units, unitIndex)
  const units = replaceAt(level.units, unitIndex, { ...unit, ...patch })
  return withLevelAt(curriculum, levelIndex, { units })
}

function withExitCriterionAt(
  curriculum: Curriculum,
  levelIndex: number,
  criterionIndex: number,
  criterion: ExitCriterion,
): Curriculum {
  const level = at(curriculum.levels, levelIndex)
  const exitCriteria = replaceAt(level.exitCriteria, criterionIndex, criterion)
  return withLevelAt(curriculum, levelIndex, { exitCriteria })
}

function withLessonAt(curriculum: Curriculum, lessonIndex: number, patch: Partial<Lesson>): Curriculum {
  const lesson = at(curriculum.lessons, lessonIndex)
  const lessons = replaceAt(curriculum.lessons, lessonIndex, { ...lesson, ...patch })
  return { ...curriculum, lessons }
}

function withExerciseAt(
  curriculum: Curriculum,
  lessonIndex: number,
  exerciseIndex: number,
  patch: Partial<Exercise>,
): Curriculum {
  const lesson = at(curriculum.lessons, lessonIndex)
  const exercise = at(lesson.exercises, exerciseIndex)
  const exercises = replaceAt(lesson.exercises, exerciseIndex, { ...exercise, ...patch })
  return withLessonAt(curriculum, lessonIndex, { exercises })
}

type Corruption = {
  readonly name: string
  readonly needle: string
  readonly curriculum: Curriculum
}

const corruptions: readonly Corruption[] = [
  {
    name: 'level number out of range',
    needle: 'level 99: number is outside',
    curriculum: withLevelAt(validCurriculum, 0, { number: 99 }),
  },
  {
    name: 'level number one above MAX_LEVEL in an otherwise contiguous run',
    needle: `level ${MAX_LEVEL + 1}: number is outside`,
    curriculum: (() => {
      const levels: CurriculumLevel[] = []
      for (let n = MIN_LEVEL; n <= MAX_LEVEL + 1; n += 1) {
        levels.push({
          number: n,
          title: `Level ${n}`,
          units: [{ id: `u-${n}`, levelNumber: n, title: `U${n}`, lessonIds: [`l-${n}`] }],
          exitCriteria: [
            {
              id: `exit-${n}`,
              track: 'playing',
              description: 'd',
              check: { kind: 'assessment', minAccuracy: 0.8 },
            },
          ],
        })
      }
      const lessons: Lesson[] = []
      for (let n = MIN_LEVEL; n <= MAX_LEVEL + 1; n += 1) {
        lessons.push({
          id: `l-${n}`,
          unitId: `u-${n}`,
          track: 'playing',
          title: `Lesson ${n}`,
          explanation: 'exp',
          demoScoreId: `score-${n}`,
          exercises: [{ id: `e-${n}`, kind: 'play', title: 'Ex', estimatedMinutes: 5 }],
        })
      }
      return { levels, lessons }
    })(),
  },
  {
    name: 'level number one below MIN_LEVEL',
    needle: `level ${MIN_LEVEL - 1}: number is outside`,
    curriculum: withLevelAt(validCurriculum, 0, { number: MIN_LEVEL - 1 }),
  },
  {
    name: 'duplicate level numbers',
    needle: 'level 1: duplicate id',
    curriculum: withLevelAt(validCurriculum, 1, { number: 1 }),
  },
  {
    name: 'unit levelNumber mismatch',
    needle: 'unit-1a: levelNumber 2 does not match holding level 1',
    curriculum: withUnitAt(validCurriculum, 0, 0, { levelNumber: 2 }),
  },
  {
    name: 'lessonIds entry with no lesson',
    needle: 'ghost-lesson',
    curriculum: withUnitAt(validCurriculum, 0, 0, {
      lessonIds: ['lesson-1a1', 'ghost-lesson'],
    }),
  },
  {
    name: 'lesson unitId names no unit',
    needle: 'lesson-1a1: unitId ghost-unit names no unit',
    curriculum: withLessonAt(validCurriculum, 0, { unitId: 'ghost-unit' }),
  },
  {
    name: 'lesson that no unit lists (orphan)',
    needle: 'lesson-1a1: no unit lists it',
    curriculum: withUnitAt(validCurriculum, 0, 0, { lessonIds: ['lesson-1a2'] }),
  },
  {
    name: 'duplicate unit id',
    needle: 'unit-1a: duplicate id',
    curriculum: withUnitAt(validCurriculum, 0, 1, { id: 'unit-1a' }),
  },
  {
    name: 'duplicate lesson id',
    needle: 'lesson-1a1: duplicate id',
    curriculum: withLessonAt(validCurriculum, 1, { id: 'lesson-1a1' }),
  },
  {
    name: 'duplicate exercise id across different lessons',
    needle: 'ex-1a1a: duplicate id',
    curriculum: withExerciseAt(validCurriculum, 1, 0, { id: 'ex-1a1a' }),
  },
  {
    name: 'lesson with no exercises',
    needle: 'lesson-1a1: has no exercises',
    curriculum: withLessonAt(validCurriculum, 0, { exercises: [] }),
  },
  {
    name: 'empty explanation',
    needle: 'lesson-1a1: explanation is empty',
    curriculum: withLessonAt(validCurriculum, 0, { explanation: '   ' }),
  },
  {
    name: 'non-positive estimatedMinutes',
    needle: 'ex-1a1a: estimatedMinutes 0 is not positive',
    curriculum: withExerciseAt(validCurriculum, 0, 0, { estimatedMinutes: 0 }),
  },
  {
    name: 'level with no units',
    needle: 'level 1: has no units',
    curriculum: withLevelAt(validCurriculum, 0, { units: [] }),
  },
  {
    name: 'level with no exit criteria',
    needle: 'level 1: has no exit criteria',
    curriculum: withLevelAt(validCurriculum, 0, { exitCriteria: [] }),
  },
  {
    name: 'assessment minAccuracy out of range',
    needle: 'exit-1: minAccuracy 1.5 is outside 0..1',
    curriculum: withExitCriterionAt(validCurriculum, 0, 0, {
      id: 'exit-1',
      track: 'playing',
      description: 'd',
      check: { kind: 'assessment', minAccuracy: 1.5 },
    }),
  },
  {
    name: 'sight-reading minLevel out of range',
    needle: 'exit-2: minLevel 9 is outside',
    curriculum: withExitCriterionAt(validCurriculum, 1, 0, {
      id: 'exit-2',
      track: 'sight-reading',
      description: 'd',
      check: { kind: 'sight-reading', minLevel: 9, minAccuracy: 0.7 },
    }),
  },
  {
    name: 'sight-reading minAccuracy out of range',
    needle: 'exit-2: minAccuracy 2 is outside 0..1',
    curriculum: withExitCriterionAt(validCurriculum, 1, 0, {
      id: 'exit-2',
      track: 'sight-reading',
      description: 'd',
      check: { kind: 'sight-reading', minLevel: 2, minAccuracy: 2 },
    }),
  },
  {
    name: 'theory-quiz minRetention out of range',
    needle: 'exit-1: minRetention 2 is outside 0..1',
    curriculum: withExitCriterionAt(validCurriculum, 0, 0, {
      id: 'exit-1',
      track: 'theory',
      description: 'd',
      check: { kind: 'theory-quiz', minRetention: 2 },
    }),
  },
  {
    name: 'technique minBpm not positive',
    needle: 'exit-1: minBpm -5 is not positive',
    curriculum: withExitCriterionAt(validCurriculum, 0, 0, {
      id: 'exit-1',
      track: 'playing',
      description: 'd',
      check: { kind: 'technique', drillId: 'd1', minBpm: -5 },
    }),
  },
  {
    name: 'ear-training minLevel out of range',
    needle: 'exit-1: minLevel 10 is outside',
    curriculum: withExitCriterionAt(validCurriculum, 0, 0, {
      id: 'exit-1',
      track: 'playing',
      description: 'd',
      check: { kind: 'ear-training', minLevel: 10 },
    }),
  },
]

describe('validateCurriculum: single-field corruptions', () => {
  it.each(corruptions.map((c) => [c.name, c] as const))('%s', (_name, corruption) => {
    const result = validateCurriculum(corruption.curriculum)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.some((m) => m.includes(corruption.needle))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// lookup and navigation: examples
// ---------------------------------------------------------------------------

describe('levelAt', () => {
  it('finds a level by number', () => {
    expect(levelAt(validCurriculum, 2)?.title).toBe('Level 2')
  })

  it('returns undefined for a missing level', () => {
    expect(levelAt(validCurriculum, 5)).toBeUndefined()
  })
})

describe('lessonById / unitById', () => {
  it('finds a lesson by id', () => {
    expect(lessonById(validCurriculum, 'lesson-1b1')?.title).toBe('Lesson 1b1')
  })

  it('finds a unit by id, searching across all levels', () => {
    expect(unitById(validCurriculum, 'unit-2a')?.title).toBe('Unit 2a')
  })

  it('returns undefined for unknown ids', () => {
    expect(lessonById(validCurriculum, 'nope')).toBeUndefined()
    expect(unitById(validCurriculum, 'nope')).toBeUndefined()
  })
})

describe('lessonsForLevel', () => {
  it('lists lessons in unit order then lesson order', () => {
    const ids = lessonsForLevel(validCurriculum, 1).map((l) => l.id)
    expect(ids).toEqual(['lesson-1a1', 'lesson-1a2', 'lesson-1b1'])
  })

  it('returns an empty array for a missing level', () => {
    expect(lessonsForLevel(validCurriculum, 5)).toEqual([])
  })
})

describe('lessonsForTrack', () => {
  it('filters lessons of a level down to one track', () => {
    const ids = lessonsForTrack(validCurriculum, 1, 'theory').map((l) => l.id)
    expect(ids).toEqual(['lesson-1a2'])
  })
})

describe('lessonMinutes', () => {
  it('sums estimatedMinutes across a lesson’s exercises', () => {
    const lesson = lessonById(validCurriculum, 'lesson-1a1')
    expect(lesson).toBeDefined()
    if (lesson === undefined) return
    expect(lessonMinutes(lesson)).toBe(8)
  })

  it('is zero-safe for a lesson with no exercises', () => {
    const lesson = lessonById(validCurriculum, 'lesson-2a1')
    expect(lesson).toBeDefined()
    if (lesson === undefined) return
    expect(lessonMinutes({ ...lesson, exercises: [] })).toBe(0)
  })
})

describe('nextLesson', () => {
  it('walks within a unit, across units, and across a level boundary', () => {
    expect(nextLesson(validCurriculum, 'lesson-1a1')?.id).toBe('lesson-1a2')
    expect(nextLesson(validCurriculum, 'lesson-1a2')?.id).toBe('lesson-1b1')
    expect(nextLesson(validCurriculum, 'lesson-1b1')?.id).toBe('lesson-2a1')
  })

  it('returns undefined after the last lesson of the last level', () => {
    expect(nextLesson(validCurriculum, 'lesson-2a1')).toBeUndefined()
  })

  it('returns undefined for an unknown lesson id', () => {
    expect(nextLesson(validCurriculum, 'nope')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// property tests: generated well-formed curricula
// ---------------------------------------------------------------------------

type Shape = {
  readonly numLevels: number
  readonly unitsPerLevel: readonly number[]
  readonly lessonsPerUnit: readonly number[]
  readonly exercisesPerLesson: readonly number[]
}

/**
 * Generates the *counts* of a well-formed curriculum tree (how many units per
 * level, lessons per unit, exercises per lesson) rather than the tree itself,
 * so every generated shape is trivially assemblable into a valid curriculum.
 */
const arbShape: fc.Arbitrary<Shape> = fc
  .integer({ min: MIN_LEVEL, max: MAX_LEVEL })
  .chain((numLevels) =>
    fc
      .array(fc.integer({ min: 1, max: 3 }), { minLength: numLevels, maxLength: numLevels })
      .chain((unitsPerLevel) => {
        const totalUnits = unitsPerLevel.reduce((sum, n) => sum + n, 0)
        return fc
          .array(fc.integer({ min: 1, max: 3 }), { minLength: totalUnits, maxLength: totalUnits })
          .chain((lessonsPerUnit) => {
            const totalLessons = lessonsPerUnit.reduce((sum, n) => sum + n, 0)
            return fc
              .array(fc.integer({ min: 1, max: 3 }), {
                minLength: totalLessons,
                maxLength: totalLessons,
              })
              .map((exercisesPerLesson) => ({
                numLevels,
                unitsPerLevel,
                lessonsPerUnit,
                exercisesPerLesson,
              }))
          })
      }),
  )

/** Assembles a shape's counts into an actual well-formed `Curriculum`. */
function buildCurriculum(shape: Shape): Curriculum {
  let nextUnitN = 0
  let nextLessonN = 0
  let nextExerciseN = 0
  let unitPtr = 0
  let lessonPtr = 0
  const lessons: Lesson[] = []
  const levels: CurriculumLevel[] = []

  for (let levelIdx = 0; levelIdx < shape.numLevels; levelIdx += 1) {
    const levelNumber = levelIdx + 1
    const numUnits = at(shape.unitsPerLevel, levelIdx)
    const units: Unit[] = []
    for (let u = 0; u < numUnits; u += 1) {
      const unitId = `unit-${nextUnitN}`
      nextUnitN += 1
      const numLessons = at(shape.lessonsPerUnit, unitPtr)
      unitPtr += 1
      const lessonIds: string[] = []
      for (let l = 0; l < numLessons; l += 1) {
        const lessonId = `lesson-${nextLessonN}`
        const lessonSeq = nextLessonN
        nextLessonN += 1
        lessonPtr += 1
        lessonIds.push(lessonId)
        const numExercises = at(shape.exercisesPerLesson, lessonPtr - 1)
        const exercises: Exercise[] = []
        for (let e = 0; e < numExercises; e += 1) {
          const exerciseId = `exercise-${nextExerciseN}`
          nextExerciseN += 1
          exercises.push({
            id: exerciseId,
            kind: 'play',
            title: `Exercise ${exerciseId}`,
            estimatedMinutes: 5,
          })
        }
        const track: Track = at(TRACKS, lessonSeq % TRACKS.length)
        lessons.push({
          id: lessonId,
          unitId,
          track,
          title: `Lesson ${lessonId}`,
          explanation: `Explanation for ${lessonId}.`,
          demoScoreId: `score-${lessonId}`,
          exercises,
        })
      }
      units.push({ id: unitId, levelNumber, title: `Unit ${unitId}`, lessonIds })
    }
    levels.push({
      number: levelNumber,
      title: `Level ${levelNumber}`,
      units,
      exitCriteria: [
        {
          id: `exit-${levelNumber}`,
          track: 'playing',
          description: `Reach fluency for level ${levelNumber}.`,
          check: { kind: 'assessment', minAccuracy: 0.8 },
        },
      ],
    })
  }
  return { levels, lessons }
}

describe('validateCurriculum: generated well-formed curricula', () => {
  it('accepts any shape built within the rules', () => {
    fc.assert(
      fc.property(arbShape, (shape) => {
        const curriculum = buildCurriculum(shape)
        const result = validateCurriculum(curriculum)
        expect(result.ok).toBe(true)
      }),
    )
  })
})

describe('validateCurriculum: generated curriculum corruptions', () => {
  it('rejects a lesson listed by two different units', () => {
    fc.assert(
      fc.property(arbShape, fc.integer({ min: 0, max: 0x7fffffff }), (shape, seed) => {
        const curriculum = buildCurriculum(shape)
        const allUnits = curriculum.levels.flatMap((l) => l.units)
        // Need at least two units to move a lesson id between them.
        if (allUnits.length < 2) return

        const fromUnitIndex = seed % allUnits.length
        let toUnitIndex = (seed + 1) % allUnits.length
        if (toUnitIndex === fromUnitIndex) toUnitIndex = (toUnitIndex + 1) % allUnits.length
        const fromUnit = at(allUnits, fromUnitIndex)
        const toUnit = at(allUnits, toUnitIndex)
        if (fromUnit.lessonIds.length === 0) return
        const movedLessonId = at(fromUnit.lessonIds, 0)

        const corruptedLevels = curriculum.levels.map((level) => ({
          ...level,
          units: level.units.map((unit) =>
            unit.id === toUnit.id
              ? { ...unit, lessonIds: [...unit.lessonIds, movedLessonId] }
              : unit,
          ),
        }))
        const corrupted: Curriculum = { ...curriculum, levels: corruptedLevels }

        const result = validateCurriculum(corrupted)
        expect(result.ok).toBe(false)
      }),
    )
  })

  it('rejects a lesson whose unitId disagrees with the unit that lists it', () => {
    fc.assert(
      fc.property(arbShape, fc.integer({ min: 0, max: 0x7fffffff }), (shape, seed) => {
        const curriculum = buildCurriculum(shape)
        const allUnits = curriculum.levels.flatMap((l) => l.units)
        if (allUnits.length < 2 || curriculum.lessons.length === 0) return

        const lessonIndex = seed % curriculum.lessons.length
        const lesson = at(curriculum.lessons, lessonIndex)
        const otherUnit = allUnits.find((u) => u.id !== lesson.unitId)
        if (otherUnit === undefined) return

        const corruptedLessons = curriculum.lessons.map((l, i) =>
          i === lessonIndex ? { ...l, unitId: otherUnit.id } : l,
        )
        const corrupted: Curriculum = { ...curriculum, lessons: corruptedLessons }

        const result = validateCurriculum(corrupted)
        expect(result.ok).toBe(false)
      }),
    )
  })
})

describe('nextLesson: generated curricula', () => {
  it('walks every lesson of the curriculum exactly once and terminates', () => {
    fc.assert(
      fc.property(arbShape, (shape) => {
        const curriculum = buildCurriculum(shape)
        expect(validateCurriculum(curriculum).ok).toBe(true)

        const canonical = curriculum.levels
          .slice()
          .sort((a, b) => a.number - b.number)
          .flatMap((level) => lessonsForLevel(curriculum, level.number).map((l) => l.id))

        const visited: string[] = []
        let current: string | undefined = at(canonical, 0)
        let steps = 0
        const maxSteps = canonical.length + 1
        while (current !== undefined && steps <= maxSteps) {
          visited.push(current)
          const next = nextLesson(curriculum, current)
          current = next?.id
          steps += 1
        }

        expect(steps).toBeLessThanOrEqual(maxSteps)
        expect(visited).toEqual(canonical)
        expect(new Set(visited).size).toBe(canonical.length)
      }),
    )
  })
})
