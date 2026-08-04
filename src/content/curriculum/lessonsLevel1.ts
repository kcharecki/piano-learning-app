/**
 * Level 1 (Beginner) lessons — requirements.md §2: five-finger positions
 * hands separately and simple hands-together playing; note names in
 * treble/bass around middle C with quarter/half/whole notes for sight
 * reading; staff, note names, basic rhythm values and 4/4 / 3/4 time
 * signatures for theory (roadmap 3.7, REQ-3.1.1-3.1.3).
 *
 * `unitId` values here are the level-1 unit ids authored in
 * `@content/curriculum/curriculum.ts`, which owns the units and wires each
 * lesson id into exactly one of them. Not consumed yet — the lesson screen
 * that renders this content is the scheduled follow-on task (roadmap
 * 3.7/4.9's next item).
 *
 * `theoryQuizEx` takes its `drillKind` explicitly (roadmap 3.11, REQ-3.5.2)
 * so each quiz opens the deck its title actually promises, rather than every
 * quiz opening `'staff-to-key'` regardless of topic. Some topics here have no
 * matching deck yet (note values, time signatures) — those stay on
 * `'staff-to-key'` as the best available practice and are titled generically
 * ("find the notes on the keyboard"), with the lesson's own topic named in a
 * parenthetical suffix so the several gap-topic quizzes read as distinct
 * lessons rather than one repeated title, rather than claiming to quiz
 * something the deck cannot test; a follow-up task routes them to the
 * MIDI-answered theory drill panel instead.
 *
 * `theoryQuizEx` also takes an optional `drillLevel` (finding 1): when a
 * title names something the deck only contains from a level above 1 (e.g.
 * "fourths and fifths" needs `interval-on-staff` level >= 2), the quiz must
 * say so explicitly, or the deck it opens at the default level 1 cannot
 * possibly contain what the title promises.
 *
 * Two known destination gaps remain for the lesson-screen follow-on task,
 * present in every lesson file (Level1/2/3), not just here:
 *  - `playEx` exercises carry no way to reach the lesson's own
 *    `demoScoreId`: `Shell.tsx` routes `'play'` to `<ScoreScreen />` with
 *    whatever happens to be in `scoreStore`, not the lesson's demo. Needs
 *    either `params: { scoreId }` on `play` exercises or the lesson screen
 *    passing `demoScoreId` when it opens one.
 *  - `sightReadEx`'s `params: { level }` is inert for the same reason:
 *    `SightReadingScreen` takes no props and reads its level from the store.
 *    Kept for forward compatibility only.
 */
import type { Exercise, Lesson } from '@core/curriculum/types.ts'
import { demoScoreById } from '@content/scores/demoScores.ts'
import { techniqueDrillById } from '@core/technique/library.ts'
import type { FlashcardKind } from '@core/drills/flashcards.ts'

// ---------------------------------------------------------------------------
// exercise helpers — fail fast at module load if an id is wrong, rather than
// authoring a lesson whose exercise silently opens nothing (see roadmap task
// brief: "do not invent params for a destination that cannot consume them").
// ---------------------------------------------------------------------------

function demo(id: string): string {
  if (demoScoreById(id) === undefined) {
    throw new Error(`lessonsLevel1: unknown demo score '${id}'`)
  }
  return id
}

function techniqueEx(id: string, drillId: string, minutes = 6): Exercise {
  const d = techniqueDrillById(drillId)
  if (d === undefined) throw new Error(`lessonsLevel1: unknown technique drill '${drillId}'`)
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

const U_START = 'l1-u1-getting-started'
const U_STAFF = 'l1-u2-staff-and-clefs'
const U_RHYTHM = 'l1-u3-rhythm-basics'
const U_MELODIES = 'l1-u4-steps-skips-melodies'
const U_TOGETHER = 'l1-u5-hands-together'

export const LEVEL_1_LESSONS: readonly Lesson[] = [
  // ---- Getting Started at the Keyboard (playing) --------------------------
  {
    id: 'l1-posture-and-landmarks',
    unitId: U_START,
    track: 'playing',
    title: 'Sitting at the Piano and Finding Middle C',
    explanation:
      'Sit centred on the bench with your elbows roughly level with the keys, feet flat on the ' +
      'floor or a footstool, and wrists neither drooping nor arched. Good posture is not fussy ' +
      "etiquette — it is what lets your fingers move freely instead of fighting your own arm's weight.\n\n" +
      'Before you can play anything, you need to find middle C without looking down the whole ' +
      "keyboard. The black keys come in repeating groups of two and three; middle C is the white " +
      "key just to the left of every group of two, near the centre of the instrument.\n\n" +
      '[diagram:black-key-groups]\n' +
      '[diagram:finding-middle-c]',
    demoScoreId: demo('demo-middle-c-position-rh'),
    exercises: [
      playEx('l1-posture-and-landmarks-ex1', 'Find middle C in every octave on the keyboard', 5),
      techniqueEx('l1-posture-and-landmarks-ex2', 'five-finger-c-major-hands-right', 6),
    ],
  },
  {
    id: 'l1-middle-c-position-rh',
    unitId: U_START,
    track: 'playing',
    title: 'Right Hand: The Middle C Position',
    explanation:
      'Place your right-hand thumb (finger 1) on middle C, and let fingers 2, 3, 4 and 5 rest on ' +
      'the next four white keys up: D, E, F and G. This is the "C position" — the home base most ' +
      'beginner pieces start from, because it keeps the hand relaxed over five neighbouring keys.\n\n' +
      "Practise pressing each finger down without moving the hand, then try the whole 1-2-3-4-5 " +
      'run followed by 5-4-3-2-1 back down. Keep your fingers curved, as if gently holding a small ball.\n\n' +
      '[diagram:c-position-right-hand]',
    demoScoreId: demo('demo-middle-c-position-rh'),
    exercises: [
      techniqueEx('l1-middle-c-position-rh-ex1', 'five-finger-c-major-hands-right', 6),
      playEx('l1-middle-c-position-rh-ex2', 'Play the C position run, right hand, five times', 6),
    ],
  },
  {
    id: 'l1-middle-c-position-lh',
    unitId: U_START,
    track: 'playing',
    title: 'Left Hand: The Middle C Position',
    explanation:
      'The left hand mirrors the right: pinky (finger 5) on the F below middle C, and fingers 4, ' +
      '3, 2, 1 stepping up through G, A, B to thumb on middle C itself. Because the left hand is ' +
      'the mirror image of the right, its finger numbers count down toward the thumb instead of up.\n\n' +
      'Play slowly at first — the left hand usually needs more repetitions before it feels as ' +
      'natural as the right, especially for a right-handed player.\n\n' +
      '[diagram:c-position-left-hand]',
    demoScoreId: demo('demo-middle-c-position-lh'),
    exercises: [
      techniqueEx('l1-middle-c-position-lh-ex1', 'five-finger-c-major-hands-left', 6),
      playEx('l1-middle-c-position-lh-ex2', 'Play the C position run, left hand, five times', 6),
    ],
  },

  // ---- Reading the Staff (theory) ------------------------------------------
  {
    id: 'l1-staff-and-clefs',
    unitId: U_STAFF,
    track: 'theory',
    title: 'The Staff, the Treble Clef and the Bass Clef',
    explanation:
      'Music is written on a staff of five lines and four spaces. Because a single staff cannot ' +
      "hold the full range of a piano, two staves are stacked together into a grand staff: a " +
      'treble clef (𝄞) for the higher, usually right-hand, notes, and a bass clef (𝄢) for the ' +
      'lower, usually left-hand, notes.\n\n' +
      'Middle C sits exactly between the two staves, on a short "ledger line" of its own — one ' +
      'note shared by both clefs, which is why it is such a useful landmark for beginning readers.',
    demoScoreId: demo('demo-middle-c-position-rh'),
    exercises: [
      // The note-name deck's level-1 range (MIDI 56-64) includes 4 black
      // keys (G#3, A#3, C#4, D#4) that this — the very first lesson in the
      // curriculum — never taught, and no deck/level offers a white-key-only
      // subset (finding 3). Retitled honestly to what the deck actually
      // drills rather than "staff lines and spaces", which it does not test.
      theoryQuizEx('l1-staff-and-clefs-ex1', 'Quiz: name notes around middle C', 'note-name'),
      techniqueEx('l1-staff-and-clefs-ex2', 'five-finger-c-major-hands-right', 6),
    ],
  },
  {
    id: 'l1-note-names-treble',
    unitId: U_STAFF,
    track: 'theory',
    title: 'Note Names in the Treble Clef',
    explanation:
      'On the treble staff, the lines from bottom to top spell E-G-B-D-F, and the spaces spell ' +
      'F-A-C-E. Many players learn these with a mnemonic ("Every Good Bird Does Fly" for the ' +
      'lines) or simply by counting up and down from middle C, which sits just below the staff on ' +
      'its own ledger line.\n\n' +
      'Naming notes quickly by sight, without counting every time, is what makes reading music at ' +
      'a normal tempo possible — it is worth drilling on its own before combining it with rhythm.',
    demoScoreId: demo('demo-middle-c-position-rh'),
    exercises: [
      // `buildNoteNameDeck` takes no clef parameter (finding 2): the treble
      // and bass lessons' quizzes were a byte-identical nine-card deck under
      // two different titles. Both retitled to the one honest description.
      theoryQuizEx('l1-note-names-treble-ex1', 'Quiz: name notes around middle C', 'note-name'),
      playEx('l1-note-names-treble-ex2', 'Play the C position run while naming each note aloud', 6),
    ],
  },
  {
    id: 'l1-note-names-bass',
    unitId: U_STAFF,
    track: 'theory',
    title: 'Note Names in the Bass Clef',
    explanation:
      'On the bass staff, the lines from bottom to top spell G-B-D-F-A, and the spaces spell ' +
      'A-C-E-G. The two clefs simply fix different reference pitches — the treble clef names its ' +
      'second line as the G above middle C, the bass clef names its fourth line as the F below it — ' +
      'which is why the same position on the page reads as a different pitch in each clef, a common ' +
      'early confusion worth naming explicitly.\n\n' +
      'As with the treble clef, middle C sits just above the bass staff on its own ledger line, ' +
      'the same shared landmark between the two clefs.',
    demoScoreId: demo('demo-middle-c-position-lh'),
    exercises: [
      // Same fix, same reason as l1-note-names-treble-ex1 above (finding 2).
      theoryQuizEx('l1-note-names-bass-ex1', 'Quiz: name notes around middle C', 'note-name'),
      playEx('l1-note-names-bass-ex2', 'Play the C position run while naming each note aloud', 6),
    ],
  },

  // ---- Rhythm Basics (theory) ----------------------------------------------
  {
    id: 'l1-note-values',
    unitId: U_RHYTHM,
    track: 'theory',
    title: 'Whole, Half and Quarter Notes',
    explanation:
      'A note\'s shape tells you how long to hold it, counted in beats: a whole note lasts four ' +
      'beats, a half note two, and a quarter note one. A whole note is a hollow oval with no stem; ' +
      'a half note is the same hollow oval with a stem; a quarter note fills the oval in solid.\n\n' +
      'Clap or tap each value while counting steadily out loud — "1-2-3-4" for a whole note, ' +
      '"1-2" for a half note — before trying it at the keyboard, so the rhythm is secure before ' +
      'the pitches are added on top.',
    demoScoreId: demo('demo-rhythm-reading-4-4'),
    exercises: [
      // No deck tests note duration (whole/half/quarter) — a gap topic (see
      // module comment). Kept on 'staff-to-key' as generic note-reading
      // practice, retitled so it no longer claims to quiz durations. The
      // parenthetical names this lesson's own topic so it reads as distinct
      // from the seven other gap-topic quizzes sharing the same base title
      // (finding 4), without promising the deck tests note values.
      theoryQuizEx(
        'l1-note-values-ex1',
        'Quiz: find the notes on the keyboard (whole/half/quarter notes)',
        'staff-to-key',
      ),
      playEx('l1-note-values-ex2', 'Clap, then play, the whole/half/quarter rhythm demonstration', 6),
    ],
  },
  {
    id: 'l1-time-signature-4-4',
    unitId: U_RHYTHM,
    track: 'theory',
    title: 'Time Signature: 4/4',
    explanation:
      'A time signature is two stacked numbers at the start of a piece. The top number says how ' +
      'many beats are in each measure; the bottom number says what kind of note counts as one ' +
      'beat. 4/4 — four beats per measure, a quarter note gets one beat — is by far the most ' +
      'common time signature, sometimes written as a large "C" for "common time".\n\n' +
      'Counting "1-2-3-4" steadily while a piece plays, and feeling where beat 1 falls at the ' +
      'start of each measure, is the foundation every later rhythm skill builds on.',
    demoScoreId: demo('demo-rhythm-reading-4-4'),
    exercises: [
      // No deck tests time signatures — a gap topic (see module comment).
      // Parenthetical distinguishes this from the other gap-topic quizzes
      // (finding 4) without claiming the deck tests 4/4 itself.
      theoryQuizEx(
        'l1-time-signature-4-4-ex1',
        'Quiz: find the notes on the keyboard (4/4 time)',
        'staff-to-key',
      ),
      playEx('l1-time-signature-4-4-ex2', 'Play along counting "1-2-3-4" out loud', 6),
    ],
  },
  {
    id: 'l1-time-signature-3-4',
    unitId: U_RHYTHM,
    track: 'theory',
    title: 'Time Signature: 3/4',
    explanation:
      'In 3/4 time there are three beats per measure, a quarter note still getting one beat. This ' +
      'is the classic "waltz" feel: a strong beat 1 followed by two lighter beats, often written ' +
      'as a left-hand root note on beat 1 under right-hand notes on beats 2 and 3 (an "oom-pah-pah" pattern).\n\n' +
      'Comparing 3/4 directly against 4/4 — clapping one, then switching to the other — makes the ' +
      'difference in feel obvious in a way that reading definitions alone does not.',
    demoScoreId: demo('demo-waltz-rhythm-3-4'),
    exercises: [
      // No deck tests time signatures — a gap topic (see module comment).
      // Same distinguishing-parenthetical fix as the 4/4 lesson above.
      theoryQuizEx(
        'l1-time-signature-3-4-ex1',
        'Quiz: find the notes on the keyboard (3/4 time)',
        'staff-to-key',
      ),
      playEx('l1-time-signature-3-4-ex2', 'Play the waltz-rhythm demonstration, counting "1-2-3"', 6),
    ],
  },

  // ---- Steps, Skips and Simple Melodies ------------------------------------
  {
    id: 'l1-steps-and-skips',
    unitId: U_MELODIES,
    track: 'theory',
    title: 'Steps vs Skips',
    explanation:
      'On the staff, a step moves from one line to the next space (or one space to the next ' +
      'line) — adjacent letter names, like C to D. A skip jumps over one letter name, landing on ' +
      'the next line-to-line or space-to-space position, like C to E.\n\n' +
      'Recognising steps and skips by the shape they make on the page, rather than working out ' +
      'each note name individually, is what lets a reader track a melody\'s shape at speed.',
    demoScoreId: demo('demo-steps-vs-skips'),
    exercises: [
      theoryQuizEx(
        'l1-steps-and-skips-ex1',
        'Quiz: identify steps and skips on the staff',
        'interval-on-staff',
      ),
      playEx('l1-steps-and-skips-ex2', 'Play the steps-vs-skips demonstration, hands separately', 6),
    ],
  },
  {
    id: 'l1-five-finger-melody-rh',
    unitId: U_MELODIES,
    track: 'playing',
    title: 'Simple Melodies in the Right-Hand C Position',
    explanation:
      'With the right hand settled in the C position, you can already play real melodies using ' +
      'only steps and skips within the five-finger span. Keep the wrist level and let each finger ' +
      'lift just enough to let go of its key before the next finger presses down.\n\n' +
      'Play through slowly enough that every note is deliberate — speed comes later, accuracy comes first.',
    demoScoreId: demo('demo-five-finger-c-major-hands-separately'),
    exercises: [
      techniqueEx('l1-five-finger-melody-rh-ex1', 'five-finger-c-major-hands-right', 6),
      playEx('l1-five-finger-melody-rh-ex2', 'Play the five-finger pattern, right hand, from memory', 6),
    ],
  },
  {
    id: 'l1-five-finger-melody-lh',
    unitId: U_MELODIES,
    track: 'playing',
    title: 'Simple Melodies in the Left-Hand C Position',
    explanation:
      'The same five-finger pattern now moves to the left hand. Because the left hand\'s fingers ' +
      'count down toward the thumb, the pattern feels like a mirror image of the right hand — ' +
      'expect it to take more repetitions to feel equally comfortable.\n\n' +
      'Once each hand is secure alone, playing the pattern hand-to-hand (right, then left, without ' +
      'a pause) is good preparation for playing both hands together later.',
    demoScoreId: demo('demo-five-finger-c-major-hands-separately'),
    exercises: [
      techniqueEx('l1-five-finger-melody-lh-ex1', 'five-finger-c-major-hands-left', 6),
      playEx('l1-five-finger-melody-lh-ex2', 'Play the five-finger pattern, left hand, from memory', 6),
    ],
  },
  {
    id: 'l1-sight-reading-treble-note-names',
    unitId: U_MELODIES,
    track: 'sight-reading',
    title: 'Sight Reading: Naming Notes in the Treble Staff',
    explanation:
      'Sight reading starts with speed of recognition, not speed of playing: shown a note on the ' +
      'treble staff, can you name it and find it on the keyboard without pausing to count lines? ' +
      'This lesson\'s drill presents notes one at a time around middle C and checks your response.\n\n' +
      'Every sight-reading item you read is retired afterwards rather than repeated — the point is ' +
      'reading something genuinely new, the way you would a piece you have never seen before.',
    demoScoreId: demo('demo-middle-c-position-rh'),
    exercises: [
      sightReadEx('l1-sight-reading-treble-note-names-ex1', 1, 10),
      playEx('l1-sight-reading-treble-note-names-ex2', 'Name and play five treble-staff notes from the demonstration', 5),
    ],
  },

  // ---- Hands Together (playing) --------------------------------------------
  {
    id: 'l1-hands-together-parallel',
    unitId: U_TOGETHER,
    track: 'playing',
    title: 'Hands Together: Parallel Motion',
    explanation:
      'Playing hands together is a genuinely new coordination skill, not just "the same thing ' +
      'twice at once" — start with parallel motion, where both hands move the same direction by ' +
      'the same steps, an octave apart. This is the gentlest possible introduction: your two hands ' +
      'feel like mirror images of the same shape rather than two independent lines.\n\n' +
      'If a passage falls apart hands together, practise it hands separately again first, then ' +
      'bring the hands back together only once each one is solid alone.',
    demoScoreId: demo('demo-hands-together-parallel-motion-c'),
    exercises: [
      playEx('l1-hands-together-parallel-ex1', 'Play the parallel-motion demonstration hands together', 8),
      techniqueEx('l1-hands-together-parallel-ex2', 'five-finger-c-major-hands-right', 6),
    ],
  },
  {
    id: 'l1-simple-piece-lh-root-rh-melody',
    unitId: U_TOGETHER,
    track: 'playing',
    title: 'A Simple Piece: Held Left-Hand Root, Right-Hand Melody',
    explanation:
      'A more independent kind of hands-together playing: the left hand holds a single low note ' +
      'as a sustained root while the right hand plays a short melody above it. This is the texture ' +
      'behind an enormous amount of easy repertoire, because it lets a beginner\'s left hand do ' +
      'something simple and steady while the right hand carries the tune.\n\n' +
      'Set the left-hand note down first and let it ring, then bring in the right-hand melody — ' +
      "don't try to start both hands with equal attention on day one.",
    demoScoreId: demo('demo-lh-root-rh-melody-simple-piece'),
    exercises: [
      playEx('l1-simple-piece-lh-root-rh-melody-ex1', 'Play the held-root demonstration hands together', 8),
      techniqueEx('l1-simple-piece-lh-root-rh-melody-ex2', 'five-finger-c-major-hands-left', 6),
    ],
  },
  {
    id: 'l1-sight-reading-bass-note-names',
    unitId: U_TOGETHER,
    track: 'sight-reading',
    title: 'Sight Reading: Naming Notes in the Bass Staff',
    explanation:
      'The same note-naming speed drill as the treble lesson, now for the bass staff — the clef ' +
      'your left hand will read for the rest of your playing, so it deserves the same fluency as ' +
      'the treble clef rather than being left as an afterthought.\n\n' +
      'As always, each item is read once and retired; the goal is genuine unrehearsed recognition, not memorisation of a fixed set.',
    demoScoreId: demo('demo-middle-c-position-lh'),
    exercises: [
      sightReadEx('l1-sight-reading-bass-note-names-ex1', 1, 10),
      playEx('l1-sight-reading-bass-note-names-ex2', 'Name and play five bass-staff notes from the demonstration', 5),
    ],
  },
]
