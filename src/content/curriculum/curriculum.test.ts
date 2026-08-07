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
import type { Exercise, Lesson } from '@core/curriculum/types.ts'
import { PIANO_HIGHEST_MIDI, PIANO_LOWEST_MIDI } from '@core/shared/units.ts'
import { CURRICULUM } from '@content/curriculum/curriculum.ts'
import { LESSON_DIAGRAMS, lessonDiagramById } from '@content/curriculum/diagrams.ts'
import { demoScoreById } from '@content/scores/demoScores.ts'
import { techniqueDrillById } from '@core/technique/library.ts'
import type { FlashcardKind } from '@core/drills/flashcards.ts'
import { ALL_THEORY_KINDS, buildTheoryQuiz, type TheoryQuizKind } from '@core/drills/theory.ts'
import { seededRng } from '@core/ports/rng.ts'

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

/** The four real flashcard decks `FlashcardScreen` can open. */
const FLASHCARD_KINDS: readonly FlashcardKind[] = [
  'staff-to-key',
  'interval-on-staff',
  'note-name',
  'key-signature',
]

/** The `theory-quiz` exercise's `drillKind` for a lesson, or `undefined` if
 *  the lesson has no theory-quiz exercise or its `drillKind` is not one of
 *  the four flashcard decks OR the five `TheoryDrillPanel` kinds (roadmap
 *  3.12, REQ-3.5.2) — the only two things `params.drillKind` is ever allowed
 *  to name. */
function theoryQuizDrillKind(lessonId: string): FlashcardKind | TheoryQuizKind | undefined {
  const lesson = CURRICULUM.lessons.find((l) => l.id === lessonId)
  const quiz = lesson?.exercises.find((ex: Exercise) => ex.kind === 'theory-quiz')
  const kind = quiz?.params?.['drillKind']
  const flashcardKind = FLASHCARD_KINDS.find((k) => k === kind)
  if (flashcardKind !== undefined) return flashcardKind
  return ALL_THEORY_KINDS.find((k) => k === kind)
}

describe('theory-quiz exercises open the deck their title promises (roadmap 3.11, REQ-3.5.2)', () => {
  // Before roadmap 3.11, `theoryQuizEx` hardcoded `params.drillKind:
  // 'staff-to-key'` in every lessons file, so every assertion below would
  // have failed against the pre-3.11 content: "the circle of fifths and key
  // signatures", "identify root position, first and second inversion" and
  // "spelling the C major triad" all opened the same note-naming-by-keyboard
  // deck. Pinning specific, differently-themed lessons to specific decks
  // catches a regression that collapses them back onto one deck, or swaps
  // two, not just "some deck is set".
  it('the circle of fifths lesson opens the key-signature deck', () => {
    expect(theoryQuizDrillKind('l3-circle-of-fifths')).toBe('key-signature')
  })

  it('the relative minors lesson opens the key-signature deck (both tonics, exactly what it teaches)', () => {
    expect(theoryQuizDrillKind('l3-relative-minors')).toBe('key-signature')
  })

  it('the G major scale lesson opens the key-signature deck', () => {
    expect(theoryQuizDrillKind('l2-g-major-scale')).toBe('key-signature')
  })

  it('the level-3 sixths/sevenths/octaves lesson opens the interval-on-staff deck', () => {
    expect(theoryQuizDrillKind('l3-intervals-extended')).toBe('interval-on-staff')
  })

  it('the seconds-and-thirds interval lesson opens the interval-on-staff deck', () => {
    expect(theoryQuizDrillKind('l2-intervals-second-third')).toBe('interval-on-staff')
  })

  it('the steps-and-skips lesson opens the interval-on-staff deck', () => {
    expect(theoryQuizDrillKind('l1-steps-and-skips')).toBe('interval-on-staff')
  })

  it('the treble note-naming lesson opens the note-name deck', () => {
    expect(theoryQuizDrillKind('l1-note-names-treble')).toBe('note-name')
  })

  it('the bass note-naming lesson opens the note-name deck', () => {
    expect(theoryQuizDrillKind('l1-note-names-bass')).toBe('note-name')
  })

  // Finding 7: the two `not.toBe` pair tests that used to sit here were
  // trivially implied by the `toBe` assertions above them (if A is
  // 'key-signature' and B is 'note-name', A !== B always follows) and killed
  // no mutant those didn't already kill. Deleted, not kept.

  it('all four flashcard decks are named by at least one lesson', () => {
    // Not `toEqual` against exactly the four flashcard kinds any more: since
    // roadmap 3.12 retargeted four lessons onto TheoryDrillPanel's
    // 'build-chord'/'build-cadence' kinds, the full set of named kinds is a
    // proper superset of the four flashcard decks — this only checks that
    // every flashcard deck is STILL named by at least one lesson.
    const kinds = new Set(
      CURRICULUM.lessons.map((lesson) => theoryQuizDrillKind(lesson.id)).filter((k) => k !== undefined),
    )
    for (const flashcardKind of FLASHCARD_KINDS) {
      expect(kinds.has(flashcardKind), `flashcard deck '${flashcardKind}' named by at least one lesson`).toBe(
        true,
      )
    }
  })

  it('every lesson still on staff-to-key is a documented topic with no matching deck OR drill', () => {
    // roadmap 3.11's gap list was rhythm/duration, time signatures,
    // chord/triad spelling, and triad inversions — none of which had a
    // flashcard deck. Roadmap 3.12 closed the chord/triad half of that gap by
    // retargeting the four chord/cadence lessons onto TheoryDrillPanel's
    // MIDI-answered 'build-chord'/'build-cadence' kinds (see the pinned-kind
    // tests below), so only the genuinely undrillable rhythm/time-signature
    // topics remain on the generic staff-to-key placeholder.
    //
    // (l2-c-major-scale moved off this list under finding 5: unlike triad
    // spelling, C major's key signature — 0 fifths — IS in the key-signature
    // deck, so it now gets the same key-signature-deck treatment as the G/F
    // major scale lessons.)
    //
    // Finding 9: this test can only catch DRIFT away from this specific,
    // hand-picked id list — e.g. a future edit that quietly moves one of
    // these lessons off 'staff-to-key' without updating the set here, or that
    // adds a new gap-topic lesson without adding its id here, fails loudly.
    // It does NOT verify that staying on 'staff-to-key' is the right call for
    // any of these — that judgement was made by hand and is only re-checked
    // for accidental drift, not re-validated, every time this test runs.
    const gapTopics = new Set(['l1-note-values', 'l1-time-signature-4-4', 'l1-time-signature-3-4'])
    const unexpectedlyOnStaffToKey = CURRICULUM.lessons
      .filter((lesson) => theoryQuizDrillKind(lesson.id) === 'staff-to-key')
      .map((lesson) => lesson.id)
      .filter((id) => !gapTopics.has(id))
    expect(unexpectedlyOnStaffToKey).toEqual([])
  })
})

describe('quizzes retargeted onto the MIDI theory drill (roadmap 3.12, REQ-3.5.2)', () => {
  // Before roadmap 3.12, these four lessons promised a chord/cadence topic no
  // flashcard deck could test and were all retargeted at 'staff-to-key' (the
  // note-naming deck) instead — "Quiz: find the notes on the keyboard (triad
  // inversions)" opened a note-naming drill. `TheoryDrillPanel` covers them
  // via 'build-chord'/'build-cadence'. Each assertion below pins the id to
  // its new kind BY ID, so a future silent retarget back to a flashcard deck
  // fails here rather than only showing up as a vague vibe check.
  it('the C major triad quiz opens build-chord', () => {
    expect(theoryQuizDrillKind('l2-c-major-triad')).toBe('build-chord')
  })

  it('the dominant chord / I-V-I quiz opens build-cadence', () => {
    expect(theoryQuizDrillKind('l2-dominant-chord-and-i-v-i')).toBe('build-cadence')
  })

  // 'build-cadence', not 'build-chord': at 'build-chord' level 1 this quiz was
  // byte-identical to the C major triad quiz above — same title, same kind,
  // same level — on a lesson about IV, and never asked for a subdominant.
  // Level 2 is where CADENCES_BY_LEVEL adds PLAGAL (IV-I).
  it('the subdominant (IV) quiz opens build-cadence, and is not a duplicate of the triad quiz', () => {
    expect(theoryQuizDrillKind('l2-i-iv-v-i-progression')).toBe('build-cadence')
    expect(theoryQuizDrillKind('l2-i-iv-v-i-progression')).not.toBe(
      theoryQuizDrillKind('l2-c-major-triad'),
    )
  })

  it('the triad inversions quiz opens build-chord', () => {
    expect(theoryQuizDrillKind('l3-triad-inversions')).toBe('build-chord')
  })

  // Finding 2: the drillLevel each retargeted lesson picks was previously
  // unpinned by any test — a mutant that deleted the level entirely still
  // passed 33/33 because the three prompt-regex tests below drove
  // `buildTheoryQuiz` from a hardcoded level literal, proving a fact about
  // core's tables rather than about this content. Pinning the id -> level
  // here, and driving the regex loops from these ids' own levels, makes the
  // proof about the content the lessons actually name.
  it('the C major triad quiz opens at level 1', () => {
    expect(theoryQuizDrillLevel('l2-c-major-triad')).toBe(1)
  })

  it('the dominant chord / I-V-I quiz opens at level 1', () => {
    expect(theoryQuizDrillLevel('l2-dominant-chord-and-i-v-i')).toBe(1)
  })

  it('the subdominant (IV) quiz opens at level 2, the tier that has the plagal cadence', () => {
    expect(theoryQuizDrillLevel('l2-i-iv-v-i-progression')).toBe(2)
  })

  it('the triad inversions quiz opens at level 2', () => {
    expect(theoryQuizDrillLevel('l3-triad-inversions')).toBe(2)
  })

  /** Every `theoryQuizDrillLevel`-resolved level this describe block uses,
   *  probed against several rng seeds rather than just one draw — proves the
   *  LEVEL, not merely the kind, actually stays inside what each lesson's
   *  title promises for every draw `buildTheoryQuiz` can make at that level,
   *  not merely the one draw a single seed happens to produce. */
  const SEEDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

  it("level 1 'build-chord' only ever draws a major or minor triad in root position (l2-c-major-triad)", () => {
    const PROMPT = /^Play a [A-G](#{1,2}|b{1,2})? (major|minor) chord, root position\.$/
    const level = theoryQuizDrillLevel('l2-c-major-triad')
    for (const seed of SEEDS) {
      const item = buildTheoryQuiz('build-chord', level ?? 1, seededRng(seed))
      expect(item.prompt, `seed ${seed}: '${item.prompt}'`).toMatch(PROMPT)
    }
  })

  // The point of level 2 for this lesson: the tier must be able to draw the
  // PLAGAL (IV-I) cadence its title promises, and level 1 cannot — so a test
  // that only checked "it is some cadence" would pass against the level-1
  // regression this quiz was moved off. Both cadences must be reachable.
  it("level 2 'build-cadence' can draw the plagal (IV-I) cadence its title promises (l2-i-iv-v-i-progression)", () => {
    const PROMPT = /^Play a (perfect authentic|plagal) cadence in .+\.$/
    const level = theoryQuizDrillLevel('l2-i-iv-v-i-progression')
    const drawn = new Set<string>()
    for (const seed of SEEDS) {
      const item = buildTheoryQuiz('build-cadence', level ?? 2, seededRng(seed))
      expect(item.prompt, `seed ${seed}: '${item.prompt}'`).toMatch(PROMPT)
      drawn.add(item.prompt.includes('plagal') ? 'plagal' : 'perfect authentic')
    }
    expect(drawn).toEqual(new Set(['perfect authentic', 'plagal']))
  })

  it("level 1 'build-cadence' only ever draws a perfect authentic (V-I) cadence (l2-dominant-chord-and-i-v-i)", () => {
    const PROMPT = /^Play a perfect authentic cadence in .+\.$/
    const level = theoryQuizDrillLevel('l2-dominant-chord-and-i-v-i')
    for (const seed of SEEDS) {
      const item = buildTheoryQuiz('build-cadence', level ?? 1, seededRng(seed))
      expect(item.prompt, `seed ${seed}: '${item.prompt}'`).toMatch(PROMPT)
    }
  })

  it("level 2 'build-chord' only ever draws a triad in root position or first inversion, never a 7th chord or second inversion (l3-triad-inversions)", () => {
    const PROMPT = /^Play a [A-G](#{1,2}|b{1,2})? (major|minor|diminished|augmented) chord, (root position|first inversion)\.$/
    const level = theoryQuizDrillLevel('l3-triad-inversions')
    for (const seed of SEEDS) {
      const item = buildTheoryQuiz('build-chord', level ?? 1, seededRng(seed))
      expect(item.prompt, `seed ${seed}: '${item.prompt}'`).toMatch(PROMPT)
    }
  })
})

/** A lesson's `theory-quiz` `params.drillLevel`, or `undefined` if absent or
 *  not a number. */
function theoryQuizDrillLevel(lessonId: string): number | undefined {
  const lesson = CURRICULUM.lessons.find((l) => l.id === lessonId)
  const quiz = lesson?.exercises.find((ex: Exercise) => ex.kind === 'theory-quiz')
  const level = quiz?.params?.['drillLevel']
  return typeof level === 'number' ? level : undefined
}

describe('theory-quiz drillLevel opens a deck that can actually contain the title (finding 1)', () => {
  // Before finding 1, every quiz below defaulted to FlashcardScreen's level
  // 1 regardless of what its title promised, so each assertion here fails
  // against that default: `buildDeck('interval-on-staff', 1)` only offers
  // 2nds/3rds (no 4ths/5ths, no 6ths/7ths/octaves), and
  // `buildDeck('key-signature', 1)` only offers fifths -1..1 (not the whole
  // circle).
  it('the fourths/fifths interval lesson opens interval-on-staff at level 2 (where 4ths/5ths first appear)', () => {
    expect(theoryQuizDrillLevel('l2-intervals-fourth-fifth')).toBe(2)
  })

  it('the sixths/sevenths/octave lesson opens interval-on-staff at level 4 (where the full 2..8 set first appears)', () => {
    expect(theoryQuizDrillLevel('l3-intervals-extended')).toBe(4)
  })

  it('the circle-of-fifths lesson opens key-signature at level 7 (the full ±7 writable circle)', () => {
    expect(theoryQuizDrillLevel('l3-circle-of-fifths')).toBe(7)
  })

  it('every theory-quiz drillLevel, where set, is a whole number within [1, 7]', () => {
    // 1 and 7 restate FlashcardScreen.tsx's MIN_DRILL_LEVEL/MAX_DRILL_LEVEL
    // rather than importing them: that file is JSX under the 'ui' vitest
    // project (happy-dom + the React plugin), and this test runs under the
    // 'core' project (plain node, no JSX transform), so importing it here
    // would fail to load.
    const MIN_DRILL_LEVEL = 1
    const MAX_DRILL_LEVEL = 7
    for (const lesson of CURRICULUM.lessons) {
      for (const exercise of lesson.exercises) {
        if (exercise.kind !== 'theory-quiz') continue
        const level = exercise.params?.['drillLevel']
        if (level === undefined) continue
        expect(typeof level, `${exercise.id} drillLevel is a number`).toBe('number')
        if (typeof level !== 'number') continue
        expect(Number.isInteger(level), `${exercise.id} drillLevel is a whole number`).toBe(true)
        expect(level, `${exercise.id} drillLevel >= MIN_DRILL_LEVEL`).toBeGreaterThanOrEqual(
          MIN_DRILL_LEVEL,
        )
        expect(level, `${exercise.id} drillLevel <= MAX_DRILL_LEVEL`).toBeLessThanOrEqual(
          MAX_DRILL_LEVEL,
        )
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
