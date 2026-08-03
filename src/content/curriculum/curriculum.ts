/**
 * The shipped curriculum: levels 1-3 (roadmap 3.7/4.9, REQ-3.1.1, REQ-3.1.2,
 * REQ-3.1.3, REQ-2.2, REQ-5.2). Validated by `curriculum.test.ts` against
 * `validateCurriculum` — until this module existed, that validator had never
 * run against real content.
 *
 * Lesson content lives in the sibling `lessonsLevel{1,2,3}.ts` modules; this
 * file owns the structure around it — units (grouping each level's lessons)
 * and exit criteria (REQ-2.2's measurable per-track advancement checks) —
 * and assembles the whole `Curriculum` value.
 *
 * Units are built from the lessons themselves (`groupLessonIdsByUnit`)
 * rather than each `lessonIds` array being typed out by hand a second time,
 * so a unit's membership can only ever agree with what each lesson's
 * `unitId` actually says.
 *
 * Not consumed yet: the lesson screen that renders a `Curriculum` value is
 * the scheduled follow-on task to roadmap 3.7/4.9. `knip.jsonc`'s ignore
 * entry for `@core/curriculum/model.ts` (comment: "delete when 4.9 lands")
 * must STAY until that lesson screen imports `CURRICULUM` — the only
 * current importer of `model.ts` outside this file is
 * `curriculum.test.ts`, and `--production` mode excludes tests, so
 * `validateCurriculum` is still reached from a test only. Under
 * `--production`, `knip` now also reports every file in this directory
 * (`diagrams.ts`, `lessonsLevel{1,2,3}.ts`, `curriculum.ts`, plus the
 * pre-existing `src/content/scores/demoScores.ts`) as unused, for the same
 * reason: nothing outside tests imports them yet. `knip.jsonc` needs a
 * task-tagged ignore entry for `src/content/curriculum/*` (same pattern as
 * the existing `gradedPieces.ts` entry) before `verify:full` will pass with
 * this module in the tree — this file is owned by this task, not
 * `knip.jsonc`, so that edit is left to the main thread.
 */
import type { Curriculum, CurriculumLevel, ExitCriterion, Lesson, Unit } from '@core/curriculum/types.ts'
import { techniqueDrillById } from '@core/technique/library.ts'
import { LEVEL_1_LESSONS } from '@content/curriculum/lessonsLevel1.ts'
import { LEVEL_2_LESSONS } from '@content/curriculum/lessonsLevel2.ts'
import { LEVEL_3_LESSONS } from '@content/curriculum/lessonsLevel3.ts'

// ---------------------------------------------------------------------------
// units — grouped from the authored lessons, not typed out a second time
// ---------------------------------------------------------------------------

type UnitSpec = { readonly id: string; readonly title: string }

function groupLessonIdsByUnit(lessons: readonly Lesson[]): ReadonlyMap<string, readonly string[]> {
  const map = new Map<string, string[]>()
  for (const lesson of lessons) {
    const list = map.get(lesson.unitId)
    if (list === undefined) {
      map.set(lesson.unitId, [lesson.id])
    } else {
      list.push(lesson.id)
    }
  }
  return map
}

function buildUnits(
  levelNumber: number,
  specs: readonly UnitSpec[],
  lessons: readonly Lesson[],
): readonly Unit[] {
  const grouped = groupLessonIdsByUnit(lessons)
  return specs.map(({ id, title }) => {
    const lessonIds = grouped.get(id)
    if (lessonIds === undefined || lessonIds.length === 0) {
      throw new Error(`curriculum: unit '${id}' has no lessons`)
    }
    return { id, levelNumber, title, lessonIds }
  })
}

// ---------------------------------------------------------------------------
// exit criteria helper — fails fast on an unknown technique drill id, the
// same discipline the lesson modules use for demo scores and drill ids.
// ---------------------------------------------------------------------------

function techniqueCriterion(
  id: string,
  description: string,
  drillId: string,
  minBpm: number,
): ExitCriterion {
  const drill = techniqueDrillById(drillId)
  if (drill === undefined) throw new Error(`curriculum: unknown technique drill '${drillId}'`)
  if (minBpm > drill.targetBpm) {
    throw new Error(
      `curriculum: exit criterion '${id}' requires ${minBpm} bpm, above drill '${drillId}'s own target of ${drill.targetBpm}`,
    )
  }
  return { id, track: 'playing', description, check: { kind: 'technique', drillId, minBpm } }
}

// ---------------------------------------------------------------------------
// level 1 — Beginner
// ---------------------------------------------------------------------------

const LEVEL_1_UNIT_SPECS: readonly UnitSpec[] = [
  { id: 'l1-u1-getting-started', title: 'Getting Started at the Keyboard' },
  { id: 'l1-u2-staff-and-clefs', title: 'Reading the Staff' },
  { id: 'l1-u3-rhythm-basics', title: 'Rhythm Basics' },
  { id: 'l1-u4-steps-skips-melodies', title: 'Steps, Skips and Simple Melodies' },
  { id: 'l1-u5-hands-together', title: 'Hands Together' },
]

const LEVEL_1_EXIT_CRITERIA: readonly ExitCriterion[] = [
  {
    id: 'l1-exit-assessment',
    track: 'playing',
    description: 'Play a simple hands-together piece at 75% note and rhythm accuracy or better.',
    // 75%, not a stricter figure: this is the FIRST assessment a learner ever
    // takes, on a beginner piece — the bar exists to confirm hands-together
    // coordination is present at all, not to gatekeep polish.
    check: { kind: 'assessment', minAccuracy: 0.75, pieceId: 'demo-lh-root-rh-melody-simple-piece' },
  },
  techniqueCriterion(
    'l1-exit-technique',
    'Play the C major five-finger pattern, right hand, cleanly at or near its target tempo.',
    'five-finger-c-major-hands-right',
    // 56 of a 60 bpm target: close enough to demonstrate the pattern is
    // secure, without demanding metronome-perfect precision from a first
    // technique exit check.
    56,
  ),
  {
    id: 'l1-exit-sight-reading',
    track: 'sight-reading',
    description: 'Sight-read level 1 material (note names around middle C) at 80% accuracy or better.',
    // 80%: the low end of REQ-3.4.6's target adaptive band (~80-90%), so this
    // exit check is consistent with the same accuracy the trainer itself aims for.
    check: { kind: 'sight-reading', minLevel: 1, minAccuracy: 0.8 },
  },
  {
    id: 'l1-exit-theory',
    track: 'theory',
    description: 'Retain staff, note-name and basic rhythm-value facts at 70% or better on review.',
    // 70%: SRS review is ongoing, not a one-shot test — a lower bar here is
    // honest about facts still being consolidated, not yet mastered.
    check: { kind: 'theory-quiz', minRetention: 0.7 },
  },
]

const LEVEL_1: CurriculumLevel = {
  number: 1,
  title: 'Level 1 — Beginner',
  units: buildUnits(1, LEVEL_1_UNIT_SPECS, LEVEL_1_LESSONS),
  exitCriteria: LEVEL_1_EXIT_CRITERIA,
}

// ---------------------------------------------------------------------------
// level 2 — Elementary
// ---------------------------------------------------------------------------

const LEVEL_2_UNIT_SPECS: readonly UnitSpec[] = [
  { id: 'l2-u1-expression', title: 'Musical Expression: Dynamics and Articulation' },
  { id: 'l2-u2-one-octave-scales', title: 'One-Octave Scales: C, G, F' },
  { id: 'l2-u3-tonic-dominant-chords', title: 'Chords: Tonic and Dominant' },
  { id: 'l2-u4-intervals', title: 'Intervals up to a Fifth' },
  { id: 'l2-u5-sight-one-octave', title: 'Sight Reading: One Octave and Eighth Notes' },
  { id: 'l2-u6-key-signatures', title: 'Key Signatures: 0-1 Sharps/Flats' },
]

const LEVEL_2_EXIT_CRITERIA: readonly ExitCriterion[] = [
  {
    id: 'l2-exit-assessment',
    track: 'playing',
    description: 'Play a hands-together piece with dynamics and articulation at 78% accuracy or better.',
    // No pieceId: level 2 draws on whichever lesson piece the learner most
    // recently practiced, not one fixed assessment — the repertoire library
    // that would pin this to a specific graded piece ships as a later task.
    check: { kind: 'assessment', minAccuracy: 0.78 },
  },
  techniqueCriterion(
    'l2-exit-technique',
    'Play the C major scale, one octave, right hand, cleanly at or near its target tempo.',
    'scale-c-major-1oct-hands-right',
    // 66 of a 72 bpm target, the same "close to target, not razor-exact"
    // reasoning as the level 1 technique check.
    66,
  ),
  {
    id: 'l2-exit-sight-reading',
    track: 'sight-reading',
    description: 'Sight-read level 2 material (one-octave range, eighth notes) at 80% accuracy or better.',
    check: { kind: 'sight-reading', minLevel: 2, minAccuracy: 0.8 },
  },
  {
    id: 'l2-exit-theory',
    track: 'theory',
    description: 'Retain major-scale, tonic/dominant-chord and interval facts at 75% or better on review.',
    // 75%: one step up from level 1's 70% — retention should be improving
    // with practice, but this is still an ongoing SRS review, not a final exam.
    check: { kind: 'theory-quiz', minRetention: 0.75 },
  },
]

const LEVEL_2: CurriculumLevel = {
  number: 2,
  title: 'Level 2 — Elementary',
  units: buildUnits(2, LEVEL_2_UNIT_SPECS, LEVEL_2_LESSONS),
  exitCriteria: LEVEL_2_EXIT_CRITERIA,
}

// ---------------------------------------------------------------------------
// level 3 — Late Elementary
// ---------------------------------------------------------------------------

const LEVEL_3_UNIT_SPECS: readonly UnitSpec[] = [
  { id: 'l3-u1-two-octave-technique', title: 'Two-Octave Scales and Broken Chords' },
  { id: 'l3-u2-circle-relative-minors', title: 'Circle of Fifths and Relative Minors' },
  { id: 'l3-u3-sight-two-sharps-flats', title: 'Sight Reading: Two Sharps/Flats and Dotted Rhythms' },
]

const LEVEL_3_EXIT_CRITERIA: readonly ExitCriterion[] = [
  {
    id: 'l3-exit-assessment',
    track: 'playing',
    description: 'Play a two-hand piece with pedal at 80% accuracy or better.',
    check: { kind: 'assessment', minAccuracy: 0.8 },
  },
  techniqueCriterion(
    'l3-exit-technique',
    'Play the C major scale, two octaves, hands together, cleanly at or near its target tempo.',
    'scale-c-major-2oct-hands-together',
    // 76 of an 84 bpm target — same margin-below-target reasoning as levels 1-2.
    76,
  ),
  {
    id: 'l3-exit-sight-reading',
    track: 'sight-reading',
    description: 'Sight-read level 3 material (keys to 2 sharps/flats, dotted rhythms) at 80% accuracy or better.',
    check: { kind: 'sight-reading', minLevel: 3, minAccuracy: 0.8 },
  },
  {
    id: 'l3-exit-theory',
    track: 'theory',
    description: 'Retain interval, triad-inversion, circle-of-fifths and relative-minor facts at 75% or better on review.',
    check: { kind: 'theory-quiz', minRetention: 0.75 },
  },
]

const LEVEL_3: CurriculumLevel = {
  number: 3,
  title: 'Level 3 — Late Elementary',
  units: buildUnits(3, LEVEL_3_UNIT_SPECS, LEVEL_3_LESSONS),
  exitCriteria: LEVEL_3_EXIT_CRITERIA,
}

// ---------------------------------------------------------------------------
// the curriculum
// ---------------------------------------------------------------------------

/** The shipped curriculum: levels 1-3. Validated by curriculum.test.ts. */
export const CURRICULUM: Curriculum = {
  levels: [LEVEL_1, LEVEL_2, LEVEL_3],
  lessons: [...LEVEL_1_LESSONS, ...LEVEL_2_LESSONS, ...LEVEL_3_LESSONS],
}
