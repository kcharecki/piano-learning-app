/**
 * Level 2 (Elementary) lessons — requirements.md §2: simple pieces hands
 * together with legato/staccato and basic dynamics; one-octave range each
 * hand, eighth notes and 0-1 sharp/flat key signatures for sight reading;
 * major scales C/G/F, tonic and dominant chords, intervals up to a fifth for
 * theory (roadmap 3.7, REQ-3.1.1-3.1.3).
 *
 * `unitId` values here are the level-2 unit ids authored in
 * `@content/curriculum/curriculum.ts`, which owns the units and wires each
 * lesson id into exactly one of them.
 *
 * `theoryQuizEx` takes its `drillKind` explicitly (roadmap 3.11, REQ-3.5.2) —
 * see `lessonsLevel1.ts`'s module comment for the rationale and the gap-topic
 * convention (no matching deck -> `'staff-to-key'` + a generic title).
 */
import type { Exercise, Lesson } from '@core/curriculum/types.ts'
import { demoScoreById } from '@content/scores/demoScores.ts'
import { techniqueDrillById } from '@core/technique/library.ts'
import type { FlashcardKind } from '@core/drills/flashcards.ts'

// ---------------------------------------------------------------------------
// exercise helpers — see lessonsLevel1.ts for rationale.
// ---------------------------------------------------------------------------

function demo(id: string): string {
  if (demoScoreById(id) === undefined) {
    throw new Error(`lessonsLevel2: unknown demo score '${id}'`)
  }
  return id
}

function techniqueEx(id: string, drillId: string, minutes = 6): Exercise {
  const d = techniqueDrillById(drillId)
  if (d === undefined) throw new Error(`lessonsLevel2: unknown technique drill '${drillId}'`)
  return {
    id,
    kind: 'technique',
    title: `Technique: ${d.title}`,
    estimatedMinutes: minutes,
    params: { drillId: d.id, targetBpm: d.targetBpm },
  }
}

function theoryQuizEx(
  id: string,
  title: string,
  drillKind: FlashcardKind,
  minutes = 8,
  drillLevel?: number,
): Exercise {
  return {
    id,
    kind: 'theory-quiz',
    title,
    estimatedMinutes: minutes,
    params: drillLevel === undefined ? { drillKind } : { drillKind, drillLevel },
  }
}

function sightReadEx(id: string, level: number, minutes = 10): Exercise {
  return {
    id,
    kind: 'sight-read',
    title: `Sight-reading practice, level ${level}`,
    estimatedMinutes: minutes,
    params: { level },
  }
}

function playEx(id: string, title: string, minutes = 8): Exercise {
  return { id, kind: 'play', title, estimatedMinutes: minutes }
}

const U_EXPRESSION = 'l2-u1-expression'
const U_SCALES = 'l2-u2-one-octave-scales'
const U_CHORDS = 'l2-u3-tonic-dominant-chords'
const U_INTERVALS = 'l2-u4-intervals'
const U_SIGHT = 'l2-u5-sight-one-octave'
const U_KEYS = 'l2-u6-key-signatures'

export const LEVEL_2_LESSONS: readonly Lesson[] = [
  // ---- Musical Expression: Dynamics and Articulation (playing) ------------
  {
    id: 'l2-dynamics-forte-piano',
    unitId: U_EXPRESSION,
    track: 'playing',
    title: 'Dynamics: Forte and Piano',
    explanation:
      'Dynamics are how loud or soft you play, marked on the score with letters: *f* (forte) for ' +
      'loud, *p* (piano) for soft, with *mf* and *mp* for the shades in between. Dynamics come ' +
      "from arm weight and key speed, not from tension — a tense hand cannot control volume finely.\n\n" +
      'Play the same short phrase twice, once forte and once piano, and notice how differently the ' +
      'same notes can feel depending only on how they are struck.',
    demoScoreId: demo('demo-five-finger-c-major-hands-separately'),
    exercises: [
      playEx('l2-dynamics-forte-piano-ex1', 'Play the five-finger pattern forte, then piano', 6),
      techniqueEx('l2-dynamics-forte-piano-ex2', 'scale-c-major-1oct-hands-right', 6),
    ],
  },
  {
    id: 'l2-articulation-legato-staccato',
    unitId: U_EXPRESSION,
    track: 'playing',
    title: 'Articulation: Legato and Staccato',
    explanation:
      'Legato means smoothly connected — one finger holds its key until the very instant the next ' +
      'finger presses, with no gap and no overlap. Staccato means short and detached — the key is ' +
      "released well before its full written value, leaving audible space between notes.\n\n" +
      'Play the same short passage legato, then staccato, and listen for the difference: legato ' +
      'should sound like one continuous line, staccato like separate, bouncing points.',
    demoScoreId: demo('demo-steps-vs-skips'),
    exercises: [
      playEx('l2-articulation-legato-staccato-ex1', 'Play the demonstration legato, then staccato', 6),
      techniqueEx('l2-articulation-legato-staccato-ex2', 'scale-c-major-1oct-hands-left', 6),
    ],
  },
  {
    id: 'l2-simple-piece-hands-together',
    unitId: U_EXPRESSION,
    track: 'playing',
    title: 'Putting It Together: A Simple Piece, Hands Together',
    explanation:
      'With dynamics and articulation available, a simple hands-together piece stops being just ' +
      "\"correct notes\" and starts becoming music: try shaping a phrase with a gentle swell, or " +
      "playing the melody legato over a light staccato accompaniment.\n\n" +
      'Work out the notes and rhythm hands-separately first if anything feels unstable, then bring ' +
      'the expressive choices back in once the hands-together mechanics are secure.',
    demoScoreId: demo('demo-lh-root-rh-melody-simple-piece'),
    exercises: [
      playEx('l2-simple-piece-hands-together-ex1', 'Play the piece hands together with dynamics', 8),
      techniqueEx('l2-simple-piece-hands-together-ex2', 'scale-c-major-1oct-hands-right', 6),
    ],
  },

  // ---- One-Octave Scales: C, G, F (theory) ---------------------------------
  {
    id: 'l2-c-major-scale',
    unitId: U_SCALES,
    track: 'theory',
    title: 'The C Major Scale',
    explanation:
      'A major scale is built from a fixed pattern of whole and half steps: whole-whole-half-whole-' +
      'whole-whole-half. Starting on C, every one of those steps lands on a white key, which is why ' +
      'C major — the only major scale with no sharps or flats — is the natural place to start.\n\n' +
      'Play the scale slowly, one octave, right hand, using the standard fingering (thumb tucks ' +
      'under after the third finger); the sound of that pattern is worth memorising by ear as well as by name.\n\n' +
      '[diagram:c-major-scale]',
    demoScoreId: demo('demo-c-major-scale-one-octave-rh'),
    exercises: [
      // Finding 5: G major and F major below were retitled onto the
      // key-signature deck (naming the scale's key signature, not its
      // whole/half-step construction, which no deck tests); C major (0
      // fifths) is equally in the level-1 key-signature deck and gets the
      // same treatment for consistency, rather than being left on the
      // generic staff-to-key gap-topic title.
      theoryQuizEx('l2-c-major-scale-ex1', 'Quiz: the key signature of C major', 'key-signature'),
      techniqueEx('l2-c-major-scale-ex2', 'scale-c-major-1oct-hands-right', 6),
    ],
  },
  {
    id: 'l2-g-major-scale',
    unitId: U_SCALES,
    track: 'theory',
    title: 'The G Major Scale',
    explanation:
      'Starting the same whole-whole-half-whole-whole-whole-half pattern on G instead of C lands on ' +
      'one black key: F#. That single sharp becomes G major\'s key signature, written once at the ' +
      "start of every staff rather than marked note by note.\n\n" +
      'Every major scale uses this same pattern shifted to a new starting note — learning to hear ' +
      'and build it from any key is more valuable than memorising each scale as a separate fact.\n\n' +
      '[diagram:g-major-scale]',
    demoScoreId: demo('demo-c-major-scale-one-octave-rh'),
    exercises: [
      // The key-signature deck tests naming G major (1 sharp) and its
      // relative minor, but not the scale's whole/half-step pattern — the
      // title is narrowed to only what the quiz actually drills.
      theoryQuizEx('l2-g-major-scale-ex1', 'Quiz: the key signature of G major', 'key-signature'),
      techniqueEx('l2-g-major-scale-ex2', 'scale-g-major-1oct-hands-right', 6),
    ],
  },
  {
    id: 'l2-f-major-scale',
    unitId: U_SCALES,
    track: 'theory',
    title: 'The F Major Scale',
    explanation:
      'Starting the major-scale pattern on F requires one flat, Bb, to keep the whole-whole-half-' +
      'whole-whole-whole-half spacing intact — without it, the half step would fall between the ' +
      "fourth and fifth notes instead of the third and fourth, one step too late. That single flat " +
      "is F major's key signature.\n\n" +
      'Between C, G and F, you now have three major scales built from the same recipe applied to ' +
      'three different starting notes — a good moment to compare all three side by side, by ear.\n\n' +
      '[diagram:f-major-scale]',
    demoScoreId: demo('demo-c-major-scale-one-octave-rh'),
    exercises: [
      // Same narrowing as the G major scale quiz above.
      theoryQuizEx('l2-f-major-scale-ex1', 'Quiz: the key signature of F major', 'key-signature'),
      techniqueEx('l2-f-major-scale-ex2', 'scale-f-major-1oct-hands-right', 6),
    ],
  },

  // ---- Chords: Tonic and Dominant (theory) ---------------------------------
  {
    id: 'l2-c-major-triad',
    unitId: U_CHORDS,
    track: 'theory',
    title: 'The C Major Triad (Tonic Chord)',
    explanation:
      'A triad is a three-note chord built by stacking two thirds: a root, a note a third above it, ' +
      'and another note a third above that. The C major triad — C, E, G — is the tonic chord of the ' +
      'key of C, the chord a piece in C major almost always starts and ends on.\n\n' +
      'Play the three notes one at a time (broken), then all together (blocked), and listen for how ' +
      "stable and \"at rest\" the blocked chord sounds — that stability is exactly what \"tonic\" means.\n\n" +
      '[diagram:c-major-triad]',
    // demo-c-major-triad-blocked cycles root position -> first inversion ->
    // second inversion -> root; inversions are level-3 material
    // (l3-triad-inversions). No root-position-only blocked-triad demo score
    // exists yet, so the exercise below asks for root position specifically
    // rather than leaning on the inversion-cycling demo as level-2 content.
    demoScoreId: demo('demo-c-major-triad-blocked'),
    exercises: [
      // No deck tests triad spelling — a gap topic (see
      // lessonsLevel1.ts's module comment). Parenthetical distinguishes this
      // from the other gap-topic quizzes (finding 4).
      theoryQuizEx(
        'l2-c-major-triad-ex1',
        'Quiz: find the notes on the keyboard (the C major triad)',
        'staff-to-key',
      ),
      playEx('l2-c-major-triad-ex2', 'Play the C major triad, root position, blocked and broken', 6),
    ],
  },
  {
    id: 'l2-dominant-chord-and-i-v-i',
    unitId: U_CHORDS,
    track: 'theory',
    title: 'The Dominant Chord and I-V-I',
    explanation:
      'Build a triad on the fifth degree of the C major scale — G, B, D — and you get the dominant ' +
      'chord, labelled V. Where the tonic (I) sounds settled, the dominant sounds like it wants to ' +
      'resolve back home; playing I then V then I is the smallest possible harmonic story, tension ' +
      'and release.\n\n' +
      "This is theory you can hear immediately: play the progression and notice the pull the V chord " +
      'exerts back toward I, even before you know a single Roman numeral.\n\n' +
      '[diagram:g-major-triad]',
    demoScoreId: demo('demo-i-v-i-c-major'),
    exercises: [
      // No deck tests chords/progressions — a gap topic (see
      // lessonsLevel1.ts's module comment). Parenthetical distinguishes this
      // from the other gap-topic quizzes (finding 4).
      theoryQuizEx(
        'l2-dominant-chord-and-i-v-i-ex1',
        'Quiz: find the notes on the keyboard (the dominant chord)',
        'staff-to-key',
      ),
      playEx('l2-dominant-chord-and-i-v-i-ex2', 'Play the I-V-I progression in C major', 6),
    ],
  },
  {
    id: 'l2-i-iv-v-i-progression',
    unitId: U_CHORDS,
    track: 'theory',
    title: 'The Subdominant Chord (IV)',
    // Level 2 stops at naming IV — the full I-IV-V-I progression as a
    // playing/theory outcome belongs to level 4 per requirements.md §2
    // ("primary progressions"), which scopes level 2 to "tonic and dominant
    // chords" only. This lesson introduces IV by ear without presenting the
    // progression itself as something level 2 certifies.
    explanation:
      'Build a triad on the fourth degree of the C major scale — F, A, C — and you get the ' +
      'subdominant chord, labelled IV. Where the dominant (V) pulls hard toward home, IV sits as a ' +
      'gentler departure from it, a different colour of "away from the tonic".\n\n' +
      'For now, just listen for IV: play I, then IV, then back to I, and notice that it sounds like ' +
      'a step away without the same pull to resolve that V has. Combining IV with V into a full ' +
      'progression comes later.',
    demoScoreId: demo('demo-i-iv-v-i-c-major'),
    exercises: [
      // No deck tests chords — a gap topic (see lessonsLevel1.ts's module
      // comment). Parenthetical distinguishes this from the other gap-topic
      // quizzes (finding 4).
      theoryQuizEx(
        'l2-i-iv-v-i-progression-ex1',
        'Quiz: find the notes on the keyboard (the subdominant chord)',
        'staff-to-key',
      ),
      playEx('l2-i-iv-v-i-progression-ex2', 'Play I, then IV, then back to I', 6),
    ],
  },

  // ---- Intervals up to a Fifth (theory) ------------------------------------
  {
    id: 'l2-intervals-second-third',
    unitId: U_INTERVALS,
    track: 'theory',
    title: 'Intervals: Seconds and Thirds',
    explanation:
      'An interval is the distance between two notes, named by counting letter names inclusively: C ' +
      'to D is a second (two letter names), C to E is a third (three letter names). A second is a ' +
      'step on the staff; a third is a skip.\n\n' +
      'Play a second and a third from several different starting notes and compare the sound of ' +
      'each — with practice, an interval\'s size becomes recognisable by ear, not just by counting.\n\n' +
      '[diagram:interval-second]\n' +
      '[diagram:interval-third]',
    demoScoreId: demo('demo-steps-vs-skips'),
    exercises: [
      theoryQuizEx(
        'l2-intervals-second-third-ex1',
        'Quiz: identify seconds and thirds',
        'interval-on-staff',
      ),
      playEx('l2-intervals-second-third-ex2', 'Play seconds and thirds from several starting notes', 6),
    ],
  },
  {
    id: 'l2-intervals-fourth-fifth',
    unitId: U_INTERVALS,
    track: 'theory',
    title: 'Intervals: Fourths and Fifths',
    explanation:
      'Continuing the same counting rule, C to F is a fourth (four letter names) and C to G is a ' +
      'fifth (five letter names). The fifth has a particularly open, stable sound — it is the ' +
      'interval between the root and fifth of any major or minor triad, which is why triads sound ' +
      "\"solid\" the way single seconds do not.\n\n" +
      'Comparing a fifth against a second directly (played one after the other) makes the difference ' +
      'in stability easy to hear.\n\n' +
      '[diagram:interval-fourth]\n' +
      '[diagram:interval-fifth]',
    demoScoreId: demo('demo-c-major-triad-broken'),
    exercises: [
      // Finding 1: `INTERVAL_NUMBERS_BY_LEVEL[0]` (level 1) is `[2, 3]` —
      // fourths and fifths first appear at level 2 (`[2, 3, 4, 5]`), so the
      // quiz must open the deck at level 2, not the default level 1, or it
      // can never draw the interval this lesson is about.
      theoryQuizEx(
        'l2-intervals-fourth-fifth-ex1',
        'Quiz: identify fourths and fifths',
        'interval-on-staff',
        8,
        2,
      ),
      playEx('l2-intervals-fourth-fifth-ex2', 'Play fourths and fifths from several starting notes', 6),
    ],
  },

  // ---- Sight Reading: One Octave & Eighth Notes ----------------------------
  {
    id: 'l2-sight-reading-one-octave-range',
    unitId: U_SIGHT,
    track: 'sight-reading',
    title: 'Sight Reading: One-Octave Range Each Hand',
    explanation:
      'Level 2 sight reading widens each hand\'s range from a five-finger span to a full octave — ' +
      'you will need to shift position within a phrase rather than staying planted in one spot. ' +
      "Scan the piece's overall shape before playing: where does the melody go highest, where lowest?\n\n" +
      'As always, read the material once at a steady tempo without stopping to fix mistakes — that ' +
      'discipline is the whole point of the exercise.',
    demoScoreId: demo('demo-c-major-scale-one-octave-rh'),
    exercises: [
      sightReadEx('l2-sight-reading-one-octave-range-ex1', 2, 10),
      playEx('l2-sight-reading-one-octave-range-ex2', 'Play the one-octave scale demonstration at sight', 5),
    ],
  },
  {
    id: 'l2-eighth-notes',
    unitId: U_SIGHT,
    track: 'sight-reading',
    title: 'Sight Reading: Eighth Notes',
    explanation:
      'An eighth note is half the length of a quarter note — two eighth notes fill the same time as ' +
      'one quarter note, and are usually beamed together in pairs so the beat stays visually clear. ' +
      "Counting \"1-and-2-and\" out loud, with \"and\" landing exactly between the beats, is the " +
      'standard way to keep eighth-note rhythms even.\n\n' +
      'Practise counting the rhythm alone before adding pitches, the same approach as the level-1 rhythm lessons, now at a finer subdivision.',
    demoScoreId: demo('demo-rhythm-reading-4-4'),
    exercises: [
      sightReadEx('l2-eighth-notes-ex1', 2, 10),
      playEx('l2-eighth-notes-ex2', 'Play the rhythm demonstration counting "1-and-2-and"', 5),
    ],
  },

  // ---- Key Signatures: 0-1 Sharps/Flats -------------------------------------
  {
    id: 'l2-key-signatures-g-f',
    unitId: U_KEYS,
    track: 'sight-reading',
    title: 'Sight Reading: Key Signatures with One Sharp or Flat',
    explanation:
      'A key signature is a set of sharps or flats written once at the start of every staff, ' +
      'applying to every occurrence of that letter name for the whole piece unless cancelled by an ' +
      'accidental. Recognising a signature of one sharp (F#, the key of G) or one flat (Bb, the key ' +
      'of F) before you start reading tells you which notes to expect raised or lowered throughout.\n\n' +
      'Practise scanning the key signature first, silently naming which notes it affects, before you ever play a note — that habit prevents the most common beginner sight-reading error.',
    demoScoreId: demo('demo-waltz-rhythm-3-4'),
    exercises: [
      sightReadEx('l2-key-signatures-g-f-ex1', 2, 10),
      playEx('l2-key-signatures-g-f-ex2', "Play the waltz demonstration, then name what C major's empty key signature means", 5),
    ],
  },
]
