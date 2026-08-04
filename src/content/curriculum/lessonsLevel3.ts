/**
 * Level 3 (Late Elementary) lessons — requirements.md §2: two-octave scales
 * hands together, broken chords and pedal basics for playing; keys up to 2
 * sharps/flats, dotted rhythms and two-hand coordination for sight reading;
 * all intervals, major/minor triads and inversions, the circle of fifths and
 * relative minors for theory (roadmap 3.7, REQ-3.1.1-3.1.3). Deliberately
 * smaller than levels 1-2 (4.9: "Level 3 does not need the same volume") —
 * enough to make the level real and its exit criteria checkable.
 *
 * `unitId` values here are the level-3 unit ids authored in
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
    throw new Error(`lessonsLevel3: unknown demo score '${id}'`)
  }
  return id
}

function techniqueEx(id: string, drillId: string, minutes = 6): Exercise {
  const d = techniqueDrillById(drillId)
  if (d === undefined) throw new Error(`lessonsLevel3: unknown technique drill '${drillId}'`)
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

const U_TECHNIQUE = 'l3-u1-two-octave-technique'
const U_HARMONY = 'l3-u2-circle-relative-minors'
const U_SIGHT = 'l3-u3-sight-two-sharps-flats'

export const LEVEL_3_LESSONS: readonly Lesson[] = [
  // ---- Two-Octave Scales and Broken Chords (playing) -----------------------
  {
    id: 'l3-two-octave-scales-hands-together',
    unitId: U_TECHNIQUE,
    track: 'playing',
    title: 'Two-Octave Scales, Hands Together',
    explanation:
      'Playing a scale across two octaves, hands together, adds a real coordination challenge on ' +
      'top of the notes themselves: both hands move in parallel motion, an octave apart, and each ' +
      "thumb needs to tuck under at the right moment in its own line.\n\n" +
      'Start each hand alone across the full two octaves before combining them. The two hands\' ' +
      'thumb crossings fall at different points in the scale, so each hand must keep its own ' +
      'fingering steady while the other one crosses — do not expect the crossings to line up.',
    demoScoreId: demo('demo-c-major-scale-one-octave-rh'),
    exercises: [
      techniqueEx('l3-two-octave-scales-hands-together-ex1', 'scale-c-major-2oct-hands-together', 8),
      playEx('l3-two-octave-scales-hands-together-ex2', 'Play the two-octave C major scale hands together', 6),
    ],
  },
  {
    id: 'l3-broken-chords',
    unitId: U_TECHNIQUE,
    track: 'playing',
    title: 'Broken Chords',
    explanation:
      'A broken chord plays a chord\'s notes one at a time instead of all together — the same three ' +
      'notes as a blocked triad, spread out into a flowing shape. Broken chords are the basis of the ' +
      'classic "Alberti bass" accompaniment pattern found throughout early-intermediate repertoire.\n\n' +
      'Practise the triad blocked first to fix the notes in your hand, then break it apart while ' +
      'keeping the same finger for the same note each time — consistent fingering is what makes a broken-chord pattern eventually feel automatic.',
    demoScoreId: demo('demo-c-major-triad-broken'),
    // No in-level broken-chord technique drill exists: the library's only
    // broken-chord drills (arpeggio-*) are graded level 4, and
    // chord-inversions-* drills are BLOCKED chords, the opposite of this
    // lesson. Both exercises here are `play` exercises on the broken-chord
    // demo score until a level-3 arpeggio drill is added (raised as a gap,
    // not fixed here).
    exercises: [
      playEx('l3-broken-chords-ex1', 'Play the broken C major triad demonstration, slowly', 6),
      playEx('l3-broken-chords-ex2', 'Play the broken C major triad demonstration', 6),
    ],
  },
  {
    id: 'l3-pedal-basics',
    unitId: U_TECHNIQUE,
    track: 'playing',
    title: 'Sustain Pedal Basics',
    explanation:
      'The right-most pedal (the sustain or damper pedal), operated by your right foot, lets notes ' +
      'keep ringing after your fingers release the keys — ' +
      'used well, it connects notes a hand alone cannot legato, and adds warmth to a held chord. Used ' +
      'carelessly, it blurs everything into a wash of sound.\n\n' +
      'The basic technique is "legato pedalling": press the pedal down just after a new note or chord ' +
      'sounds, release it right as the next one begins, so the change is covered rather than overlapping. ' +
      'Practise the up-down motion away from a piece first, in time with a steady beat, before adding it to actual playing.',
    demoScoreId: demo('demo-lh-root-rh-melody-simple-piece'),
    exercises: [
      playEx('l3-pedal-basics-ex1', 'Play the demonstration with legato pedalling', 8),
      techniqueEx('l3-pedal-basics-ex2', 'scale-g-major-2oct-hands-together', 6),
    ],
  },

  // ---- Circle of Fifths and Relative Minors (theory) ------------------------
  {
    id: 'l3-circle-of-fifths',
    unitId: U_HARMONY,
    track: 'theory',
    title: 'The Circle of Fifths',
    explanation:
      'Arrange the twelve major keys so that each one is a fifth above the last — C, G, D, A, E and ' +
      'so on — and you get the circle of fifths, a map where each step clockwise adds one sharp and ' +
      'each step counter-clockwise adds one flat. G, one step from C, has one sharp; F, one step the ' +
      'other way, has one flat — the pattern you have already been building scale by scale.\n\n' +
      'The circle is worth learning as a picture, not just a list: once you can place a key on it, ' +
      'you instantly know its neighbours, which are the keys a piece is most likely to modulate into.',
    demoScoreId: demo('demo-i-iv-v-i-c-major'),
    exercises: [
      // Finding 1: `buildKeySignatureDeck`'s default level-1 deck only holds
      // fifths -1..+1 (F/C/G), so a lesson about the WHOLE circle of fifths
      // was drilling three of its fifteen keys. `MAX_DRILL_LEVEL` was raised
      // to 7 (finding 6) precisely so this quiz can open the full ±7 circle.
      theoryQuizEx(
        'l3-circle-of-fifths-ex1',
        'Quiz: the circle of fifths and key signatures',
        'key-signature',
        8,
        7,
      ),
      techniqueEx('l3-circle-of-fifths-ex2', 'scale-g-major-2oct-hands-together', 6),
    ],
  },
  {
    id: 'l3-relative-minors',
    unitId: U_HARMONY,
    track: 'theory',
    title: 'Relative Minors',
    explanation:
      'Every major key has a relative minor: the minor key that shares exactly the same key ' +
      'signature. A minor is the relative minor of C major — no sharps, no flats, same notes, but ' +
      'built from a scale starting and centred on A instead of C, which gives it a different, darker ' +
      'character even though the pitches involved are identical.\n\n' +
      'The A minor triad — A, C, E — uses the same three white keys as the C major triad, just ' +
      'starting from a different one; play both back to back and listen for how the same notes can sound like two different "home" chords.\n\n' +
      '[diagram:a-minor-triad]',
    demoScoreId: demo('demo-c-major-triad-blocked'),
    exercises: [
      theoryQuizEx(
        'l3-relative-minors-ex1',
        'Quiz: relative minors and shared key signatures',
        'key-signature',
      ),
      techniqueEx('l3-relative-minors-ex2', 'chord-inversions-a-minor-hands-right', 6),
    ],
  },
  {
    id: 'l3-triad-inversions',
    unitId: U_HARMONY,
    track: 'theory',
    title: 'Triad Inversions',
    explanation:
      'A triad does not have to be played with its root on the bottom. First inversion puts the ' +
      'third on the bottom (E-G-C for C major); second inversion puts the fifth on the bottom ' +
      '(G-C-E). The notes are identical either way — only which one is lowest changes.\n\n' +
      'Inversions matter for two practical reasons: they let a chord progression move between chords ' +
      'with minimal hand movement, and they change which note the ear hears as the "bass", subtly ' +
      'changing how settled or unsettled the chord feels even though its spelling is unchanged.',
    demoScoreId: demo('demo-c-major-triad-blocked'),
    exercises: [
      // No deck tests triad inversions — a gap topic (see
      // lessonsLevel1.ts's module comment). Parenthetical distinguishes this
      // from the other gap-topic quizzes (finding 4).
      theoryQuizEx(
        'l3-triad-inversions-ex1',
        'Quiz: find the notes on the keyboard (triad inversions)',
        'staff-to-key',
      ),
      techniqueEx('l3-triad-inversions-ex2', 'chord-inversions-c-major-hands-right', 6),
    ],
  },
  {
    id: 'l3-intervals-extended',
    unitId: U_HARMONY,
    track: 'theory',
    title: 'Intervals: Sixths, Sevenths and the Octave',
    explanation:
      'Continuing the counting rule from level 2 (thirds and fifths) up to the top of the octave: C ' +
      'to A is a sixth, C to B is a seventh, and C to the next C is an octave — eight letter names, ' +
      'the point where the pattern of letter names repeats. Between the second you learned first and ' +
      'the octave that closes the pattern, you now have every interval size covered.\n\n' +
      'Play through all seven interval sizes in order, from a second up to an octave, from the same ' +
      'starting note — hearing them as one continuous, widening sequence makes the whole interval ' +
      'system feel like one idea rather than seven separate facts to memorise.',
    demoScoreId: demo('demo-c-major-scale-one-octave-rh'),
    exercises: [
      // Finding 1: `INTERVAL_NUMBERS_BY_LEVEL` only reaches `[2,3,4,5,6,7,8]`
      // (sevenths and the octave included) at level 4 — level 3 stops at
      // `[2,3,4,5,6]`, missing 7 and 8 — so the quiz must open at level 4,
      // not the default level 1, to actually contain what it names.
      theoryQuizEx(
        'l3-intervals-extended-ex1',
        'Quiz: identify sixths, sevenths and octaves',
        'interval-on-staff',
        8,
        4,
      ),
      playEx('l3-intervals-extended-ex2', 'Play a second through an octave from the same starting note', 6),
    ],
  },

  // ---- Sight Reading: Two Sharps/Flats & Dotted Rhythms ----------------------
  {
    id: 'l3-dotted-rhythms',
    unitId: U_SIGHT,
    track: 'sight-reading',
    title: 'Sight Reading: Dotted Rhythms',
    explanation:
      'A dot after a note adds half of that note\'s own value to its length: a dotted quarter note ' +
      'lasts a quarter plus an eighth (one and a half beats), commonly paired with a single eighth ' +
      'note to fill out the remaining half beat. This "long-short" pattern is extremely common and ' +
      'worth being able to count without hesitation.\n\n' +
      'Count the underlying eighth-note pulse ("1-and-2-and") underneath a dotted rhythm until the ' +
      'long-short shape locks in, the same subdivision approach used for plain eighth notes in level 2.',
    demoScoreId: demo('demo-waltz-rhythm-3-4'),
    exercises: [
      sightReadEx('l3-dotted-rhythms-ex1', 3, 10),
      playEx('l3-dotted-rhythms-ex2', 'Play the waltz demonstration counting the eighth-note pulse', 5),
    ],
  },
  {
    id: 'l3-keys-to-two-sharps-flats',
    unitId: U_SIGHT,
    track: 'sight-reading',
    title: 'Sight Reading: Keys up to Two Sharps or Flats',
    explanation:
      'Level 3 sight reading extends the one-sharp/one-flat range of level 2 to two sharps (D major: ' +
      'F# and C#) and two flats (Bb major: Bb and Eb). Reading in these keys is exactly the same ' +
      'skill as before, just with one more altered note to track from the key signature.\n\n' +
      'As always, name the key signature\'s altered notes silently before playing a single note — the ' +
      'habit that made one-accidental keys manageable scales directly to two.\n\n' +
      '[diagram:d-major-scale]',
    demoScoreId: demo('demo-waltz-rhythm-3-4'),
    exercises: [
      sightReadEx('l3-keys-to-two-sharps-flats-ex1', 3, 10),
      techniqueEx('l3-keys-to-two-sharps-flats-ex2', 'scale-d-major-2oct-hands-together', 6),
      // The demo score above is C major (all demo scores are, by design —
      // see demoScores.ts), so there is nothing altered to name from it; the
      // level-3 sight-reading item above is what actually presents 2
      // sharps/flats content. A demo score in D or Bb major is a raised gap.
    ],
  },
  {
    id: 'l3-two-hand-coordination',
    unitId: U_SIGHT,
    track: 'sight-reading',
    title: 'Sight Reading: Simple Two-Hand Coordination',
    explanation:
      'Beyond parallel motion, real pieces ask the two hands to do genuinely different things at the ' +
      'same time — different rhythms, different directions, different note values in each hand at ' +
      'once. Sight-reading this kind of independence means tracking two staves simultaneously rather ' +
      'than reading one, pausing, then reading the other.\n\n' +
      'Preview both staves before playing: find where the hands move together and where they diverge, ' +
      "so you know in advance which moments will need the most attention.",
    demoScoreId: demo('demo-hands-together-parallel-motion-c'),
    exercises: [
      sightReadEx('l3-two-hand-coordination-ex1', 3, 10),
      playEx('l3-two-hand-coordination-ex2', 'Play the parallel-motion demonstration at sight, hands together', 5),
    ],
  },
]
