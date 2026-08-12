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
 * Consumed for real, which the note this replaces denied for two roadmap items
 * after it stopped being true (2026-08-12 M4 acceptance, finding F.3): the
 * lesson screen it was waiting on landed as roadmap 4.9b, and `CURRICULUM` is
 * now read by `@app/lessons/**`, by `@app/session/candidates.ts` when planning
 * a day, and by the per-track exit criteria on the dashboard. `knip --production`
 * reports nothing here, so no ignore entry is owed either.
 */
import type { Curriculum, CurriculumLevel, ExitCriterion, Lesson, Unit } from '@core/curriculum/types.ts'
import { validateCurriculum } from '@core/curriculum/model.ts'
import { invariant } from '@core/shared/invariant.ts'
import { techniqueDrillById } from '@core/technique/library.ts'
import { LEVEL_1_LESSONS } from '@content/curriculum/lessonsLevel1.ts'
import { LEVEL_2_LESSONS } from '@content/curriculum/lessonsLevel2.ts'
import { LEVEL_3_LESSONS } from '@content/curriculum/lessonsLevel3.ts'
import { LEVEL_4_LESSONS } from '@content/curriculum/lessonsLevel4.ts'
import { LEVEL_5_LESSONS } from '@content/curriculum/lessonsLevel5.ts'

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
    description:
      'Play a simple hands-separate piece (each hand alone) at 75% note and rhythm accuracy or better.',
    // Hands-SEPARATE, not hands-together (roadmap 5.46): Faber's My First
    // Piano Adventure and Alfred's Basic Piano Library both spend the bulk of
    // their first book on hands-alone playing and introduce genuine
    // hands-together coordination only entering the second book — gating
    // LEVEL 1 on a hands-together piece stalls a beginner at the first wall,
    // demanding a skill neither method expects this early. `l2-exit-assessment`
    // below already carries the hands-together gate, which is where both
    // methods put it. 75% stays the same: this is still the FIRST assessment
    // a learner ever takes, and the bar exists to confirm the notes and
    // rhythm are secure, not to gatekeep polish.
    check: {
      kind: 'assessment',
      minAccuracy: 0.75,
      pieceId: 'demo-five-finger-c-major-hands-separately',
    },
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
    description: 'Sight-read level 2 material (hands together, quarter notes, no accidentals) at 80% accuracy or better.',
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
    description: 'Sight-read level 3 material (keys to 1 sharp, eighth notes, hands together) at 80% accuracy or better.',
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
// level 4 — Intermediate (roadmap 3.24, REQ-3.5.1: seventh chords, cadences,
// the common progressions — see lessonsLevel4.ts)
// ---------------------------------------------------------------------------

const LEVEL_4_UNIT_SPECS: readonly UnitSpec[] = [
  {
    id: 'l4-u1-sevenths-cadences-progressions',
    title: 'Seventh Chords, Cadences and Common Progressions',
  },
]

const LEVEL_4_EXIT_CRITERIA: readonly ExitCriterion[] = [
  {
    id: 'l4-exit-theory',
    track: 'theory',
    description:
      'Retain seventh-chord, cadence-type and common-progression facts at 75% or better on review.',
    check: { kind: 'theory-quiz', minRetention: 0.75 },
  },
]

const LEVEL_4: CurriculumLevel = {
  number: 4,
  title: 'Level 4 — Intermediate',
  units: buildUnits(4, LEVEL_4_UNIT_SPECS, LEVEL_4_LESSONS),
  exitCriteria: LEVEL_4_EXIT_CRITERIA,
}

// ---------------------------------------------------------------------------
// level 5 — Early Advanced (roadmap 3.24, REQ-3.5.1: minor scale forms,
// secondary dominants, modulation to closely related keys — see
// lessonsLevel5.ts)
// ---------------------------------------------------------------------------

const LEVEL_5_UNIT_SPECS: readonly UnitSpec[] = [
  {
    id: 'l5-u1-minor-forms-secondary-modulation',
    title: 'Minor Scale Forms, Secondary Dominants and Modulation',
  },
]

const LEVEL_5_EXIT_CRITERIA: readonly ExitCriterion[] = [
  {
    id: 'l5-exit-theory',
    track: 'theory',
    description:
      'Retain minor-scale-form, secondary-dominant and modulation facts at 75% or better on review.',
    check: { kind: 'theory-quiz', minRetention: 0.75 },
  },
]

const LEVEL_5: CurriculumLevel = {
  number: 5,
  title: 'Level 5 — Early Advanced',
  units: buildUnits(5, LEVEL_5_UNIT_SPECS, LEVEL_5_LESSONS),
  exitCriteria: LEVEL_5_EXIT_CRITERIA,
}

// ---------------------------------------------------------------------------
// the curriculum
// ---------------------------------------------------------------------------

const AUTHORED: Curriculum = {
  levels: [LEVEL_1, LEVEL_2, LEVEL_3, LEVEL_4, LEVEL_5],
  lessons: [
    ...LEVEL_1_LESSONS,
    ...LEVEL_2_LESSONS,
    ...LEVEL_3_LESSONS,
    ...LEVEL_4_LESSONS,
    ...LEVEL_5_LESSONS,
  ],
}

/**
 * The shipped curriculum: levels 1-3, validated at module load.
 *
 * The validation runs in PRODUCTION, not only in `curriculum.test.ts`. This
 * content is authored by hand, so a broken cross-reference — a unit naming a
 * lesson that does not exist, a lesson no unit lists, a duplicate id — is
 * programmer error, and the project's rule for programmer error is to throw.
 * Failing at load is what makes it loud: the alternative is a lesson screen
 * that silently renders a shorter list than the author wrote, which is exactly
 * the class of quiet content rot this codebase keeps paying for.
 *
 * It is also what keeps `validateCurriculum` honest. Called only from a test,
 * it was an export nothing in the running app reached — `knip --production`
 * said so — and a validator that never runs where the data is actually used is
 * not a gate, it is a comment.
 */
const validated = validateCurriculum(AUTHORED)
invariant(
  validated.ok,
  `curriculum: authored content is invalid — ${validated.ok ? '' : validated.error.join('; ')}`,
)

export const CURRICULUM: Curriculum = AUTHORED
