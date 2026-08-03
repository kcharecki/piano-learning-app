/**
 * Proves `CURRICULUM` (roadmap 3.7/4.9) is not just typed correctly but
 * actually valid content: `validateCurriculum` passes, the REQ-5.2 volume
 * and REQ-3.1.2 track-coverage bars are met, every id a lesson or exit
 * criterion names (a demo score, a technique drill, a diagram) actually
 * resolves, and the model's own navigation functions walk the real content
 * correctly — those functions have only ever been exercised against test
 * fixtures before this.
 */
import { describe, expect, it } from 'vitest'
import { lessonsForLevel, lessonsForTrack, nextLesson, validateCurriculum } from '@core/curriculum/model.ts'
import type { Lesson } from '@core/curriculum/types.ts'
import { PIANO_HIGHEST_MIDI, PIANO_LOWEST_MIDI } from '@core/shared/units.ts'
import { CURRICULUM } from '@content/curriculum/curriculum.ts'
import { LESSON_DIAGRAMS, lessonDiagramById } from '@content/curriculum/diagrams.ts'
import { demoScoreById } from '@content/scores/demoScores.ts'
import { techniqueDrillById } from '@core/technique/library.ts'

const DIAGRAM_REF = /^\[diagram:([a-z0-9-]+)\]$/
const BLACK_KEY_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])

/** Every `[diagram:<id>]` reference on its own line in a lesson's markdown. */
function diagramRefsIn(lesson: Lesson): readonly string[] {
  const refs: string[] = []
  for (const rawLine of lesson.explanation.split('\n')) {
    const match = DIAGRAM_REF.exec(rawLine.trim())
    const id = match?.[1]
    if (id !== undefined) refs.push(id)
  }
  return refs
}

describe('CURRICULUM structural validity', () => {
  it('passes validateCurriculum', () => {
    const result = validateCurriculum(CURRICULUM)
    if (!result.ok) {
      throw new Error(`validateCurriculum failed:\n${result.error.join('\n')}`)
    }
    expect(result.ok).toBe(true)
  })
})

describe('CURRICULUM content bars (REQ-3.1.2, REQ-5.2)', () => {
  it('has at least 30 lessons across levels 1 and 2 combined', () => {
    const level1 = lessonsForLevel(CURRICULUM, 1)
    const level2 = lessonsForLevel(CURRICULUM, 2)
    expect(level1.length + level2.length).toBeGreaterThanOrEqual(30)
  })

  it('has theory-track lessons at every level 1-3', () => {
    for (const levelNumber of [1, 2, 3]) {
      const theoryLessons = lessonsForTrack(CURRICULUM, levelNumber, 'theory')
      expect(theoryLessons.length, `level ${levelNumber} theory lessons`).toBeGreaterThan(0)
    }
  })
})

describe('CURRICULUM id references all resolve', () => {
  it('every demoScoreId resolves through demoScoreById (REQ-3.1.3)', () => {
    for (const lesson of CURRICULUM.lessons) {
      expect(lesson.demoScoreId, `lesson ${lesson.id} has a demoScoreId`).toBeDefined()
      if (lesson.demoScoreId !== undefined) {
        expect(
          demoScoreById(lesson.demoScoreId),
          `lesson ${lesson.id} demoScoreId '${lesson.demoScoreId}'`,
        ).toBeDefined()
      }
    }
  })

  it('every technique exercise drillId resolves through techniqueDrillById', () => {
    for (const lesson of CURRICULUM.lessons) {
      for (const exercise of lesson.exercises) {
        if (exercise.kind !== 'technique') continue
        const drillId = exercise.params?.['drillId']
        expect(typeof drillId, `exercise ${exercise.id} params.drillId`).toBe('string')
        if (typeof drillId === 'string') {
          expect(techniqueDrillById(drillId), `exercise ${exercise.id} drillId '${drillId}'`).toBeDefined()
        }
      }
    }
  })

  it('every LessonDiagram is renderable by KeyboardDiagram (in range, low is a white key, valid pitch classes)', () => {
    for (const diagram of LESSON_DIAGRAMS) {
      expect(diagram.low, `diagram ${diagram.id} low >= PIANO_LOWEST_MIDI`).toBeGreaterThanOrEqual(
        PIANO_LOWEST_MIDI,
      )
      expect(diagram.low, `diagram ${diagram.id} low < high`).toBeLessThan(diagram.high)
      expect(diagram.high, `diagram ${diagram.id} high <= PIANO_HIGHEST_MIDI`).toBeLessThanOrEqual(
        PIANO_HIGHEST_MIDI,
      )
      expect(
        BLACK_KEY_PITCH_CLASSES.has(((diagram.low % 12) + 12) % 12),
        `diagram ${diagram.id} low (${diagram.low}) is a black key`,
      ).toBe(false)
      for (const pc of diagram.highlightedPitchClasses) {
        expect(Number.isInteger(pc), `diagram ${diagram.id} highlighted pitch class ${pc} is an integer`).toBe(true)
        expect(pc, `diagram ${diagram.id} highlighted pitch class ${pc} in 0..11`).toBeGreaterThanOrEqual(0)
        expect(pc, `diagram ${diagram.id} highlighted pitch class ${pc} in 0..11`).toBeLessThanOrEqual(11)
      }
      if (diagram.rootPitchClass !== undefined) {
        expect(
          diagram.rootPitchClass,
          `diagram ${diagram.id} rootPitchClass 0..11`,
        ).toBeGreaterThanOrEqual(0)
        expect(diagram.rootPitchClass, `diagram ${diagram.id} rootPitchClass 0..11`).toBeLessThanOrEqual(11)
        expect(
          diagram.highlightedPitchClasses.includes(diagram.rootPitchClass),
          `diagram ${diagram.id} rootPitchClass is a member of highlightedPitchClasses`,
        ).toBe(true)
      }
    }
  })

  it('every [diagram:...] reference in every lesson resolves to a registry entry', () => {
    for (const lesson of CURRICULUM.lessons) {
      for (const ref of diagramRefsIn(lesson)) {
        expect(lessonDiagramById(ref), `lesson ${lesson.id} references diagram '${ref}'`).toBeDefined()
      }
    }
  })

  it('every registry diagram is referenced by at least one lesson', () => {
    const referenced = new Set(CURRICULUM.lessons.flatMap((lesson) => diagramRefsIn(lesson)))
    for (const diagram of LESSON_DIAGRAMS) {
      expect(referenced.has(diagram.id), `diagram '${diagram.id}' is never referenced by a lesson`).toBe(true)
    }
  })

  it("every level's exit criteria are non-empty, with technique minBpm strictly below target (REQ-2.2)", () => {
    // techniqueCriterion() already throws at module load for an unknown
    // drillId or minBpm > target, so those two invariants can never reach
    // this test with a bad value — this asserts something that helper does
    // NOT enforce: that the exit bar leaves genuine headroom below the
    // drill's own target tempo, rather than merely being <=.
    for (const level of CURRICULUM.levels) {
      expect(level.exitCriteria.length, `level ${level.number} exit criteria`).toBeGreaterThan(0)
      for (const criterion of level.exitCriteria) {
        const check = criterion.check
        if (check.kind === 'technique') {
          const drill = techniqueDrillById(check.drillId)
          if (drill !== undefined) {
            expect(
              check.minBpm,
              `level ${level.number} criterion ${criterion.id} minBpm should leave headroom below drill target ${drill.targetBpm}`,
            ).toBeLessThan(drill.targetBpm)
          }
        }
        if (check.kind === 'assessment' && check.pieceId !== undefined) {
          expect(
            demoScoreById(check.pieceId),
            `level ${level.number} criterion ${criterion.id} pieceId '${check.pieceId}'`,
          ).toBeDefined()
        }
      }
    }
  })
})

describe('curriculum model navigation over real content', () => {
  it('lessonsForLevel returns lessons in the order authored in the source LEVEL_n_LESSONS arrays', () => {
    // Deliberately does NOT compare against level.units.flatMap(lessonIds):
    // those arrays are themselves derived from this same lesson list by
    // groupLessonIdsByUnit, so that comparison could never fail on a
    // mis-ordered source file. This instead re-derives the expected order
    // directly from CURRICULUM.lessons (the flattened authored arrays) and
    // checks lessonsForLevel doesn't silently reorder or drop anything.
    for (const level of CURRICULUM.levels) {
      const lessons = lessonsForLevel(CURRICULUM, level.number)
      const expectedIds = CURRICULUM.lessons
        .filter((lesson) => level.units.some((unit) => unit.id === lesson.unitId))
        .map((lesson) => lesson.id)
      expect(lessons.map((lesson) => lesson.id)).toEqual(expectedIds)
    }
  })

  it('lessonsForTrack filters level 1 to only theory lessons', () => {
    const theoryLessons = lessonsForTrack(CURRICULUM, 1, 'theory')
    expect(theoryLessons.length).toBeGreaterThan(0)
    expect(theoryLessons.every((lesson) => lesson.track === 'theory')).toBe(true)
  })

  it('nextLesson walks from the first lesson of level 1 to the last lesson of level 3', () => {
    const level1Lessons = lessonsForLevel(CURRICULUM, 1)
    const level2Lessons = lessonsForLevel(CURRICULUM, 2)
    const level3Lessons = lessonsForLevel(CURRICULUM, 3)
    const first = level1Lessons[0]
    const last = level3Lessons[level3Lessons.length - 1]
    const lastOfLevel1 = level1Lessons[level1Lessons.length - 1]
    const firstOfLevel2 = level2Lessons[0]
    expect(first).toBeDefined()
    expect(last).toBeDefined()
    expect(lastOfLevel1).toBeDefined()
    expect(firstOfLevel2).toBeDefined()
    if (first === undefined || last === undefined) return

    const visited: string[] = [first.id]
    let current: Lesson | undefined = first
    let guard = 0
    while (current !== undefined && current.id !== last.id && guard < 200) {
      current = nextLesson(CURRICULUM, current.id)
      if (current !== undefined) visited.push(current.id)
      guard += 1
    }

    expect(current?.id).toBe(last.id)
    if (lastOfLevel1 !== undefined) expect(visited).toContain(lastOfLevel1.id)
    if (firstOfLevel2 !== undefined) expect(visited).toContain(firstOfLevel2.id)
    expect(nextLesson(CURRICULUM, last.id)).toBeUndefined()
  })
})
