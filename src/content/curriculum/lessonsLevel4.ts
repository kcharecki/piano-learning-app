/**
 * Level 4 (Intermediate) lessons — roadmap 3.24, REQ-3.5.1: the first three of
 * the six harmony topics that had no authored lesson at any level (seventh
 * chords, cadences, the common progressions I-IV-V-I / ii-V-I / I-vi-IV-V, the
 * minor scale forms, secondary dominants, modulation to closely related keys —
 * see `lessonsLevel5.ts` for the remaining three).
 *
 * This is authoring work over content `@core/theory/harmony.ts` (diatonic
 * function, roman numerals, cadences) and `@core/drills/theory.ts`
 * (keyboard-answered quiz items) already model — nothing here restates music
 * theory the core already encodes. Every quiz below opens a REAL
 * `TheoryQuizKind` deck at a level whose pool genuinely contains what the
 * title promises (roadmap 3.11/3.12's discipline, continued here); see each
 * exercise's comment for which table widens at that level.
 *
 * roadmap 5.10's lesson-quality audit found the original demos here — a
 * triad-inversion cycle standing in for a seventh chord, a bare V-I standing
 * in for all four cadence types, one progression standing in for three — were
 * on-topic but not on-topic ENOUGH: a beginner opening "Open demonstration"
 * would not hear what the lesson's own prose promised. `harmonyDemoScores.ts`
 * now carries a real demo for each; see its own module comment for the full
 * list of what was closed. Every lesson carries a STAFF diagram (roadmap
 * 3.25 built the diagram kind these six lessons exist to use), never
 * keyboard-only.
 */
import type { Exercise, Lesson } from '@core/curriculum/types.ts'
import { demoScoreById } from '@content/scores/demoScores.ts'
import type { TheoryQuizKind } from '@core/drills/theory.ts'

function demo(id: string): string {
  if (demoScoreById(id) === undefined) {
    throw new Error(`lessonsLevel4: unknown demo score '${id}'`)
  }
  return id
}

function theoryQuizEx(
  id: string,
  title: string,
  drillKind: TheoryQuizKind,
  drillLevel: number,
  minutes = 8,
): Exercise {
  return { id, kind: 'theory-quiz', title, estimatedMinutes: minutes, params: { drillKind, drillLevel } }
}

function playEx(id: string, title: string, minutes = 8): Exercise {
  return { id, kind: 'play', title, estimatedMinutes: minutes }
}

const U_HARMONY = 'l4-u1-sevenths-cadences-progressions'

export const LEVEL_4_LESSONS: readonly Lesson[] = [
  {
    id: 'l4-seventh-chords',
    unitId: U_HARMONY,
    track: 'theory',
    title: 'Seventh Chords',
    explanation:
      'Stack one more third on top of a triad and you get a seventh chord: four notes instead of ' +
      'three, named for the interval between its root and its top note. The most common is the ' +
      'dominant seventh — a major triad plus a minor third on top (G-B-D-F in the key of C) — whose ' +
      "extra note sharpens the pull the plain dominant triad already has back toward the tonic.\n\n" +
      'Play the G major triad, then add the F on top to make it G7, and listen for how much more ' +
      "urgently it wants to resolve to C than the bare triad did — that extra pull is a seventh " +
      "chord's whole purpose in a progression.\n\n" +
      '[diagram:staff-seventh-chord]',
    // roadmap 5.10: plays exactly what the prose describes — the G major
    // triad, then G7 (see harmonyDemoScores.ts).
    demoScoreId: demo('demo-g-major-to-g-dominant-seventh'),
    exercises: [
      // CHORD_QUALITIES_BY_LEVEL[2] (level 3) is the tier where
      // dominant7/major7/minor7 FIRST join the major/minor/diminished/
      // augmented triads already drawable at lower levels — the first level
      // at which this quiz can actually draw a seventh chord. Titled to
      // name the whole pool a level-3 draw can produce, not only the sevenths.
      theoryQuizEx(
        'l4-seventh-chords-ex1',
        'Quiz: build a triad or seventh chord (major, minor, diminished, augmented, dominant 7th, major 7th or minor 7th)',
        'build-chord',
        3,
      ),
      playEx('l4-seventh-chords-ex2', 'Play G major, then G dominant seventh, and compare their pull toward C', 6),
    ],
  },
  {
    id: 'l4-cadences',
    unitId: U_HARMONY,
    track: 'theory',
    title: 'Cadences: Authentic, Half, Plagal and Deceptive',
    explanation:
      'A cadence is the two-chord punctuation mark that ends a musical phrase. A perfect authentic ' +
      'cadence (V-I, root position, melody landing on the tonic) is the strongest full stop; a half ' +
      'cadence (ending ON V) reads like a comma; a plagal cadence (IV-I, the "Amen" cadence) is a ' +
      "softer close than the authentic; and a deceptive cadence (V resolving to vi instead of I) is " +
      'a written-out surprise, promising resolution and then withholding it.\n\n' +
      'Play all four back to back from the same I chord and listen for how differently each one ' +
      'feels: full stop, comma, gentle close, surprise — the same harmonic vocabulary used four ' +
      'different ways.\n\n' +
      '[diagram:staff-authentic-cadence]',
    // roadmap 5.10: the prior demo (a bare V-I) showed only one of the four
    // cadence types this lesson names. Now plays all four, each starting
    // from the same I chord, exactly as the prose describes.
    demoScoreId: demo('demo-four-cadence-types-c-major'),
    exercises: [
      // CADENCES_BY_LEVEL[3] (level 4) is the first tier that includes all
      // four cadence types this lesson names — DECEPTIVE only joins at
      // level 4 (see core/drills/theory.ts). Matches the lesson's own title
      // exactly.
      theoryQuizEx(
        'l4-cadences-ex1',
        'Quiz: build a perfect authentic, plagal, half or deceptive cadence',
        'build-cadence',
        4,
      ),
      playEx('l4-cadences-ex2', 'Play all four cadence types in C major, back to back', 6),
    ],
  },
  {
    id: 'l4-common-progressions',
    unitId: U_HARMONY,
    track: 'theory',
    title: 'Common Progressions: I-IV-V-I, ii-V-I and I-vi-IV-V',
    explanation:
      'Three chord progressions account for an enormous share of tonal music. I-IV-V-I is the ' +
      'primary-chords progression you already know from levels 2-3, now named as a unit. ii-V-I ' +
      'replaces the plain V with ii-V — a gentler two-step approach to the same authentic cadence, ' +
      'and the single most common progression in jazz. I-vi-IV-V (the "50s progression") swaps the ' +
      'tonic\'s second appearance for its relative minor, vi, before continuing on to IV and V — the ' +
      "backbone of countless pop and doo-wop songs.\n\n" +
      'Play all three progressions in C major and notice what they share: every one of them is built ' +
      'entirely from the seven diatonic triads you already know, just visited in a different order.\n\n' +
      '[diagram:staff-i-iv-v-i-progression]',
    // roadmap 5.10: the prior demo played only I-IV-V-I, one of the three
    // progressions this lesson names. Now plays all three back to back.
    demoScoreId: demo('demo-common-progressions-c-major'),
    exercises: [
      // No quiz kind builds a whole multi-chord progression as one item —
      // `build-cadence`'s two-chord recipes are the closest keyboard-
      // answered drill, and every one of these three progressions RESOLVES
      // with the same authentic, plagal or half cadence CADENCES_BY_LEVEL[2]
      // (level 3) can already draw. Titled honestly as testing the
      // resolution, not the whole progression (finding-1/finding-4 gap-topic
      // convention from lessonsLevel1.ts).
      theoryQuizEx(
        'l4-common-progressions-ex1',
        'Quiz: build the cadence each progression resolves with (perfect authentic, plagal or half)',
        'build-cadence',
        3,
      ),
      playEx('l4-common-progressions-ex2', 'Play I-IV-V-I, then ii-V-I, then I-vi-IV-V, in C major', 8),
    ],
  },
]
