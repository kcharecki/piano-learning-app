import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { unwrap } from '@core/shared/result.ts'
import { parseMusicXml } from '@core/notation/musicxml.ts'
import { makeScore, type Score, type ScoreNoteInput } from '@core/notation/score.ts'
import { type Inversion, invertChord } from './chords.ts'
import { diatonicChords } from './harmony.ts'
import { CIRCLE_OF_FIFTHS, type Key, relativeKey } from './keys.ts'
import { toMidi } from './pitch.ts'
import { analyseScore, detectKey } from './analysis.ts'

const FIXTURE_PATH = fileURLToPath(
  new URL('../../content/scores/twinkle-twinkle-little-star.musicxml', import.meta.url),
)

function loadTwinkle(): Score {
  return unwrap(parseMusicXml(readFileSync(FIXTURE_PATH, 'utf-8')))
}

// ---------------------------------------------------------------------------
// detectKey
// ---------------------------------------------------------------------------

describe('detectKey', () => {
  it('reads Twinkle Twinkle as C major, from its signature and its all-diatonic content', () => {
    const key = detectKey(loadTwinkle())
    expect(key.tonic.letter).toBe('C')
    expect(key.tonic.alter).toBe(0)
    expect(key.mode).toBe('major')
  })

  it('flips to the relative minor when all three votes agree: a GENUINE cadential leading tone (V resolves to i in the bass), and the first and last bass both landing on the minor tonic', () => {
    // The genuine-minor half of the roadmap-3.19 fix: the leading-tone vote must not
    // simply be disabled to kill the false-positive bug (see the regression test
    // below) — it has to still recognise a real dominant-to-tonic resolution. Here the
    // V chord's G# (midi 68) ends at tick 3840+1920=5760, exactly where the i chord's
    // bass (A, midi 57) begins, so `leadingToneResolvesToMinorTonic` must find it. A
    // stub that always returns `false` for the leading-tone vote (over-correcting the
    // fix) would fail this test by reporting C major instead.
    //
    // i - iv - V - i in A minor, signature 0 fifths (shared with C major).
    const score = makeScore({
      id: 'a-minor-probe',
      measures: [{ keyFifths: 0 }, { keyFifths: 0 }, { keyFifths: 0 }, { keyFifths: 0 }],
      notes: [
        // i: A-C-E
        { midi: 57, startTick: 0, durationTicks: 1920, hand: 'left' },
        { midi: 60, startTick: 0, durationTicks: 1920, hand: 'left' },
        { midi: 64, startTick: 0, durationTicks: 1920, hand: 'left' },
        // iv: D-F-A
        { midi: 62, startTick: 1920, durationTicks: 1920, hand: 'left' },
        { midi: 65, startTick: 1920, durationTicks: 1920, hand: 'left' },
        { midi: 69, startTick: 1920, durationTicks: 1920, hand: 'left' },
        // V: E-G#-B (the raised leading tone)
        { midi: 64, startTick: 3840, durationTicks: 1920, hand: 'left' },
        { midi: 68, startTick: 3840, durationTicks: 1920, hand: 'left' },
        { midi: 71, startTick: 3840, durationTicks: 1920, hand: 'left' },
        // i: A-C-E
        { midi: 57, startTick: 5760, durationTicks: 1920, hand: 'left' },
        { midi: 60, startTick: 5760, durationTicks: 1920, hand: 'left' },
        { midi: 64, startTick: 5760, durationTicks: 1920, hand: 'left' },
      ],
    })
    const key = detectKey(score)
    expect(key.tonic.letter).toBe('A')
    expect(key.tonic.alter).toBe(0)
    expect(key.mode).toBe('minor')
  })

  it('stays major on a single vote: only the last bass note lands on the minor tonic', () => {
    const score = makeScore({
      id: 'one-vote-probe',
      measures: [{ keyFifths: 0 }, { keyFifths: 0 }],
      notes: [
        // C major tonic — first bass is the MAJOR tonic, no leading tone.
        { midi: 60, startTick: 0, durationTicks: 1920, hand: 'left' },
        { midi: 64, startTick: 0, durationTicks: 1920, hand: 'left' },
        { midi: 67, startTick: 0, durationTicks: 1920, hand: 'left' },
        // A minor tonic — last bass lands on the minor tonic, the only vote cast.
        { midi: 57, startTick: 1920, durationTicks: 1920, hand: 'left' },
        { midi: 60, startTick: 1920, durationTicks: 1920, hand: 'left' },
        { midi: 64, startTick: 1920, durationTicks: 1920, hand: 'left' },
      ],
    })
    const key = detectKey(score)
    expect(key.tonic.letter).toBe('C')
    expect(key.mode).toBe('major')
  })

  it('returns the major key straight from the signature when the score has no notes at all', () => {
    const score = makeScore({ id: 'empty-probe', measures: [{ keyFifths: 2 }], notes: [] })
    const key = detectKey(score)
    expect(key.tonic.letter).toBe('D')
    expect(key.mode).toBe('major')
  })

  it('stays major on a monophonic melody that touches the raised leading tone: with no left-hand voice at all, none of the three votes can be cast', () => {
    // Before this fix, `bassAt` was "the lowest sounding pitch", so in a single
    // melodic line (this app's own sight-reading material, constantly) the
    // melody itself stood in for the bass and the rule collapsed back to the
    // old global "pitch class present anywhere" test. A stub that reverts
    // `bassAt` to ignore `hand` fails this: it would read the lone melodic line
    // as its own bass, see the first note land on the minor tonic (A), the
    // G-G#-A-B figure as the leading tone "resolving" one step later, and the
    // final C as landing on the major tonic only at the very end — enough
    // votes to wrongly flip to A minor.
    //
    // A | G G# A B | C | C — entirely hand: 'right', no left hand anywhere.
    const score = makeScore({
      id: 'monophonic-probe',
      measures: [{ keyFifths: 0 }, { keyFifths: 0 }, { keyFifths: 0 }, { keyFifths: 0 }],
      notes: [
        { midi: 69, startTick: 0, durationTicks: 1920, hand: 'right' }, // A4
        { midi: 67, startTick: 1920, durationTicks: 240, hand: 'right' }, // G4
        { midi: 68, startTick: 2160, durationTicks: 240, hand: 'right' }, // G#4
        { midi: 69, startTick: 2400, durationTicks: 240, hand: 'right' }, // A4
        { midi: 71, startTick: 2640, durationTicks: 240, hand: 'right' }, // B4
        { midi: 72, startTick: 3840, durationTicks: 1920, hand: 'right' }, // C5
        { midi: 72, startTick: 5760, durationTicks: 1920, hand: 'right' }, // C5
      ],
    })
    const key = detectKey(score)
    expect(key.tonic.letter).toBe('C')
    expect(key.tonic.alter).toBe(0)
    expect(key.mode).toBe('major')
  })
})

// ---------------------------------------------------------------------------
// REGRESSION (roadmap 3.19, REQ-3.5.5): the leading-tone vote must be
// cadential, not "this pitch class shows up anywhere in the score"
// ---------------------------------------------------------------------------

describe('detectKey — the leading-tone vote is cadential, not global', () => {
  it('REGRESSION: a C major piece with one non-cadential chromatic G# and an A-minor-tonic bass at only ONE end still detects as C MAJOR', () => {
    // Before the fix, `leadingTonePresent` was `pitchClasses.has(raisedLeadingToneClass)`
    // — true the instant a G# sounds ANYWHERE, no matter what it resolves to. Combined
    // with an A bass at just one end (one more vote) that reached `minorVotes >= 2` and
    // wrongly reported A minor, which would then mislabel every roman numeral
    // downstream. A stub that reverts `leadingToneResolvesToMinorTonic` to "the pitch
    // class is present anywhere in score.notes" is exactly the bug this test kills.
    //
    // (Deliberately only ONE end sits on the minor tonic: a piece with BOTH ends on A
    // already reaches minorVotes >= 2 from firstIsMinorTonic + lastIsMinorTonic alone,
    // regardless of the leading-tone vote — see the "both ends" test below, a separate,
    // out-of-scope concern about those two votes that this task was not asked to fix.)
    //
    // mm1 (0-1920):    left hand opens on vi, A3-C4-E4 — an ordinary diatonic chord;
    //                  first bass is the minor tonic (one vote).
    // mm2 (1920-3840): left hand holds IV (F3-A3-C4) as a whole note; right hand
    //                  threads G4-G#4-A4 as a quick chromatic passing figure — the
    //                  ONLY G# in the piece. It never moves the bass, which stays on
    //                  the held F the entire time.
    // mm3 (3840-5760): left hand V, G3-B3-D4.
    // mm4 (5760-7680): left hand I, C4-E4-G4 — the piece closes firmly on the major
    //                  tonic; last bass is NOT the minor tonic.
    const score = makeScore({
      id: 'chromatic-passing-tone-probe',
      measures: [{ keyFifths: 0 }, { keyFifths: 0 }, { keyFifths: 0 }, { keyFifths: 0 }],
      notes: [
        // mm1: vi
        { midi: 57, startTick: 0, durationTicks: 1920, hand: 'left' },
        { midi: 60, startTick: 0, durationTicks: 1920, hand: 'left' },
        { midi: 64, startTick: 0, durationTicks: 1920, hand: 'left' },
        // mm2: IV held under a G-G#-A chromatic passing tone
        { midi: 53, startTick: 1920, durationTicks: 1920, hand: 'left' },
        { midi: 57, startTick: 1920, durationTicks: 1920, hand: 'left' },
        { midi: 60, startTick: 1920, durationTicks: 1920, hand: 'left' },
        { midi: 67, startTick: 1920, durationTicks: 240, hand: 'right' }, // G4
        { midi: 68, startTick: 2160, durationTicks: 240, hand: 'right' }, // G#4 — the only one
        { midi: 69, startTick: 2400, durationTicks: 240, hand: 'right' }, // A4
        // mm3: V
        { midi: 55, startTick: 3840, durationTicks: 1920, hand: 'left' },
        { midi: 59, startTick: 3840, durationTicks: 1920, hand: 'left' },
        { midi: 62, startTick: 3840, durationTicks: 1920, hand: 'left' },
        // mm4: I
        { midi: 60, startTick: 5760, durationTicks: 1920, hand: 'left' },
        { midi: 64, startTick: 5760, durationTicks: 1920, hand: 'left' },
        { midi: 67, startTick: 5760, durationTicks: 1920, hand: 'left' },
      ],
    })

    const key = detectKey(score)
    expect(key.tonic.letter).toBe('C')
    expect(key.tonic.alter).toBe(0)
    expect(key.mode).toBe('major')
  })

  it('BLOCKER FIX: a secondary dominant (V/vi) resolving to vi in the MIDDLE of a C major piece still detects as C MAJOR, even though the bass genuinely does reach the minor tonic right after it', () => {
    // This is the case the original bug (roadmap 3.19) and a naive "the bass reaches
    // the minor tonic somewhere" rule both still get wrong: V/vi in C major (E-G#-B)
    // and V-i in A minor are the SAME sonority resolving the SAME way — the bass
    // genuinely does move from E to A right after the G#. Only the fact that this
    // resolution sits in measure 2 of 4, not at the piece's own final cadence (which
    // closes firmly on the MAJOR tonic, C), can tell it apart from a real minor
    // cadence. A stub that drops the "at or into the last measure" requirement and
    // keeps only "the bass reaches the minor tonic at its next move" fails this test
    // by reporting A minor.
    //
    // mm1 (0-1920):    vi, A3-C4-E4 — first bass is the minor tonic (one vote).
    // mm2 (1920-3840): V/vi, E4-G#4-B4 — the only G# in the piece; the bass genuinely
    //                  moves to A right after it, but that resolution lands back in
    //                  vi, not at the final cadence.
    // mm3 (3840-5760): vi again, A3-C4-E4.
    // mm4 (5760-7680): I, C4-E4-G4 — the piece closes firmly on the major tonic; last
    //                  bass is NOT the minor tonic.
    const score = makeScore({
      id: 'secondary-dominant-mid-piece-probe',
      measures: [{ keyFifths: 0 }, { keyFifths: 0 }, { keyFifths: 0 }, { keyFifths: 0 }],
      notes: [
        // mm1: vi
        { midi: 57, startTick: 0, durationTicks: 1920, hand: 'left' },
        { midi: 60, startTick: 0, durationTicks: 1920, hand: 'left' },
        { midi: 64, startTick: 0, durationTicks: 1920, hand: 'left' },
        // mm2: V/vi — E-G#-B
        { midi: 64, startTick: 1920, durationTicks: 1920, hand: 'left' },
        { midi: 68, startTick: 1920, durationTicks: 1920, hand: 'left' },
        { midi: 71, startTick: 1920, durationTicks: 1920, hand: 'left' },
        // mm3: vi
        { midi: 57, startTick: 3840, durationTicks: 1920, hand: 'left' },
        { midi: 60, startTick: 3840, durationTicks: 1920, hand: 'left' },
        { midi: 64, startTick: 3840, durationTicks: 1920, hand: 'left' },
        // mm4: I
        { midi: 60, startTick: 5760, durationTicks: 1920, hand: 'left' },
        { midi: 64, startTick: 5760, durationTicks: 1920, hand: 'left' },
        { midi: 67, startTick: 5760, durationTicks: 1920, hand: 'left' },
      ],
    })

    const key = detectKey(score)
    expect(key.tonic.letter).toBe('C')
    expect(key.tonic.alter).toBe(0)
    expect(key.mode).toBe('major')
  })

  it('does not admit an unconditional "raised leading tone anywhere in the final measure" vote: a right-hand G# flourish over a held C bass in the last bar still detects as C MAJOR', () => {
    // A previous, mid-fix version of this rule voted for ANY raised leading tone in
    // the score's last measure, bass ignored — re-admitting the original bug under a
    // narrower door. Here the final measure's bass never leaves C (the major tonic):
    // only the right hand touches G# as a quick decorative flourish. A stub that votes
    // "true" whenever the leading tone sounds anywhere in the final measure, without
    // checking what the bass actually does, fails this test by reporting A minor.
    //
    // mm1 (0-1920):    vi, A3-C4-E4 — first bass is the minor tonic (one vote).
    // mm2 (1920-3840): IV, F3-A3-C4.
    // mm3 (3840-5760): V, G3-B3-D4.
    // mm4 (5760-7680): left hand holds I (C4-E4-G4) as a whole note — the bass never
    //                  moves off C; right hand plays a G4-G#4-A4-C5 flourish that
    //                  touches the only G# in the piece, in the score's own final bar.
    const score = makeScore({
      id: 'final-measure-flourish-probe',
      measures: [{ keyFifths: 0 }, { keyFifths: 0 }, { keyFifths: 0 }, { keyFifths: 0 }],
      notes: [
        // mm1: vi
        { midi: 57, startTick: 0, durationTicks: 1920, hand: 'left' },
        { midi: 60, startTick: 0, durationTicks: 1920, hand: 'left' },
        { midi: 64, startTick: 0, durationTicks: 1920, hand: 'left' },
        // mm2: IV
        { midi: 53, startTick: 1920, durationTicks: 1920, hand: 'left' },
        { midi: 57, startTick: 1920, durationTicks: 1920, hand: 'left' },
        { midi: 60, startTick: 1920, durationTicks: 1920, hand: 'left' },
        // mm3: V
        { midi: 55, startTick: 3840, durationTicks: 1920, hand: 'left' },
        { midi: 59, startTick: 3840, durationTicks: 1920, hand: 'left' },
        { midi: 62, startTick: 3840, durationTicks: 1920, hand: 'left' },
        // mm4: I, held under a right-hand flourish that touches G#
        { midi: 60, startTick: 5760, durationTicks: 1920, hand: 'left' },
        { midi: 64, startTick: 5760, durationTicks: 1920, hand: 'left' },
        { midi: 67, startTick: 5760, durationTicks: 1920, hand: 'left' },
        { midi: 67, startTick: 5760, durationTicks: 240, hand: 'right' }, // G4
        { midi: 68, startTick: 6000, durationTicks: 240, hand: 'right' }, // G#4 — the only one
        { midi: 69, startTick: 6240, durationTicks: 240, hand: 'right' }, // A4
        { midi: 72, startTick: 6480, durationTicks: 240, hand: 'right' }, // C5
      ],
    })

    const key = detectKey(score)
    expect(key.tonic.letter).toBe('C')
    expect(key.tonic.alter).toBe(0)
    expect(key.mode).toBe('major')
  })

  it('REGRESSION (metre/rhythm independence): a genuine A minor cadence whose dominant is held for a whole bar, with the leading tone only on beat 1, still detects as A MINOR', () => {
    // A fixed tick-width window ("2 quarters") is metre-blind: sized to survive a short
    // rest, it is nowhere near wide enough for a dominant that is arpeggiated or simply
    // held for a full bar before resolving. Here the raised leading tone (G#) sounds
    // only on the first beat of the V measure, decorating a right-hand arpeggio, while
    // the left-hand bass holds the dominant root (E) for the whole bar and only moves
    // to the tonic (A) at the start of the next measure — several beats after the G#
    // itself ends. The pre-this-fix window-based code got this wrong (too narrow a
    // window misses the resolution); the ORIGINAL global "pitch class present anywhere"
    // code got it right by accident. `nextBassChange` has no width to be too narrow:
    // it just waits for the bass's own next move, however long that takes.
    //
    // mm1 (0-1920):    III, C4-E4-G4 — first bass is the MAJOR-key relative (C), not
    //                  the minor tonic — no vote from firstIsMinorTonic.
    // mm2 (1920-3840): i, A3-C4-E4.
    // mm3 (3840-5760): left hand holds the V root (E3) for the whole bar; right hand
    //                  arpeggiates E4-G#4-B4-E5, the G# landing only on beat 1.
    // mm4 (5760-7680): i, A3-C4-E4 — the piece closes on the minor tonic; last bass
    //                  IS the minor tonic (one vote). The leading-tone vote must be the
    //                  decisive second vote for this to read A minor at all.
    const score = makeScore({
      id: 'held-dominant-whole-bar-probe',
      measures: [{ keyFifths: 0 }, { keyFifths: 0 }, { keyFifths: 0 }, { keyFifths: 0 }],
      notes: [
        // mm1: III (C major triad) — bass is C, neither tonic.
        { midi: 60, startTick: 0, durationTicks: 1920, hand: 'left' },
        { midi: 64, startTick: 0, durationTicks: 1920, hand: 'left' },
        { midi: 67, startTick: 0, durationTicks: 1920, hand: 'left' },
        // mm2: i
        { midi: 57, startTick: 1920, durationTicks: 1920, hand: 'left' },
        { midi: 60, startTick: 1920, durationTicks: 1920, hand: 'left' },
        { midi: 64, startTick: 1920, durationTicks: 1920, hand: 'left' },
        // mm3: V, held root in the left hand, arpeggiated in the right hand
        { midi: 52, startTick: 3840, durationTicks: 1920, hand: 'left' }, // E3, held all bar
        { midi: 64, startTick: 3840, durationTicks: 480, hand: 'right' }, // E4
        { midi: 68, startTick: 4320, durationTicks: 480, hand: 'right' }, // G#4 — the only one
        { midi: 71, startTick: 4800, durationTicks: 480, hand: 'right' }, // B4
        { midi: 76, startTick: 5280, durationTicks: 480, hand: 'right' }, // E5
        // mm4: i
        { midi: 57, startTick: 5760, durationTicks: 1920, hand: 'left' },
        { midi: 60, startTick: 5760, durationTicks: 1920, hand: 'left' },
        { midi: 64, startTick: 5760, durationTicks: 1920, hand: 'left' },
      ],
    })

    const key = detectKey(score)
    expect(key.tonic.letter).toBe('A')
    expect(key.tonic.alter).toBe(0)
    expect(key.mode).toBe('minor')
  })
})

// ---------------------------------------------------------------------------
// A score that is nothing but the A minor triad, start to finish
// ---------------------------------------------------------------------------

describe('detectKey — a score that sounds only the A minor triad, throughout', () => {
  it('reads as A MINOR, with zero leading-tone evidence: two bars of A3-C4-E4 and nothing else IS an A minor piece, not a C major one', () => {
    // Not a limitation: a score whose only sounding chord, start to finish, is the A
    // minor triad genuinely is in A minor — that shape essentially defines the key.
    // Both bass votes (first bass and last bass on the minor tonic) agree, and correctly
    // so; the leading-tone vote casting none here is expected, not a weakness, since
    // there is no leading tone anywhere in the piece to cast one.
    const score = makeScore({
      id: 'only-a-minor-triad-probe',
      measures: [{ keyFifths: 0 }, { keyFifths: 0 }],
      notes: [
        // mm1: A3-C4-E4 — first bass is the minor tonic.
        { midi: 57, startTick: 0, durationTicks: 1920, hand: 'left' },
        { midi: 60, startTick: 0, durationTicks: 1920, hand: 'left' },
        { midi: 64, startTick: 0, durationTicks: 1920, hand: 'left' },
        // mm2: A3-C4-E4 again — last bass is also the minor tonic. No G# anywhere.
        { midi: 57, startTick: 1920, durationTicks: 1920, hand: 'left' },
        { midi: 60, startTick: 1920, durationTicks: 1920, hand: 'left' },
        { midi: 64, startTick: 1920, durationTicks: 1920, hand: 'left' },
      ],
    })
    const key = detectKey(score)
    expect(key.tonic.letter).toBe('A')
    expect(key.mode).toBe('minor')
  })
})

// ---------------------------------------------------------------------------
// analyseScore — the bundled sample, named literally
// ---------------------------------------------------------------------------

describe('analyseScore — Twinkle Twinkle Little Star', () => {
  const score = loadTwinkle()
  const analysis = analyseScore(score, detectKey(score))

  it('names every measure I, V or IV — the I-V-IV-I skeleton this arrangement actually has, three times over', () => {
    // One left-hand block chord per measure, held under a moving right-hand melody:
    // I V IV I, repeated across mm1-4, 5-8 and 9-12. This is NOT the classic
    // I-IV-V-I cadential shape — this transcription's left hand never plays V
    // immediately before a final I; V is always followed by IV first.
    const numeralPerMeasure = new Map<number, string>()
    for (const chord of analysis.chords) {
      if (chord.numeral !== null) numeralPerMeasure.set(chord.measureIndex, chord.numeral.text)
    }
    const sequence = Array.from({ length: 12 }, (_, i) => numeralPerMeasure.get(i))
    expect(sequence).toEqual(['I', 'V', 'IV', 'I', 'I', 'V', 'IV', 'I', 'I', 'V', 'IV', 'I'])
  })

  it('ignores the right-hand passing tone rather than renaming the held left-hand chord', () => {
    // Measure 3 (index 2): left hand holds F-A-C (IV) as a whole note; the right hand
    // plays F then E (each re-attacked, so the melody alone yields several slices).
    // F is a chord tone; E is not, but read together with the held triad it happens to
    // spell a complete F major seventh (F-A-C-E). Because the core-pitches rule reads
    // the chord from the longest-held notes alone, the shorter-held E never gets a
    // vote: every slice in the measure reads IV, not IV7.
    const measure3 = analysis.chords.filter((c) => c.measureIndex === 2)
    expect(measure3.length).toBeGreaterThanOrEqual(2)
    for (const chord of measure3) expect(chord.numeral?.text).toBe('IV')

    // The passing E4 (MIDI 64) was seen, not silently dropped from the reported data —
    // it just did not get to rename the chord.
    expect(measure3.some((c) => c.midi.some((m) => Number(m) === 64))).toBe(true)
  })

  it('finds exactly the three real phrase-ending cadences, none of the false ones a naive every-barline reading would report', () => {
    // Grouping slices into harmonic runs and requiring a run to arrive on a barline,
    // materially outlast the one it replaces (or be the score's own final run),
    // eliminates the false "half" (I->V, mid-phrase) and "deceptive" (V->IV, mid-phrase)
    // readings a naive every-barline-chord-change rule would report, and correctly
    // finds the one genuine IV->I plagal cadence at the end of each of the three
    // 4-measure phrases.
    const types = analysis.cadences.map((c) => c.type)
    expect(types).toEqual(['plagal', 'plagal', 'plagal'])
  })

  it('reports the final phrase-ending cadence as plagal, landing on the last measure’s tonic', () => {
    const last = analysis.cadences[analysis.cadences.length - 1]
    expect(last?.type).toBe('plagal')
    const finalChord = last === undefined ? undefined : analysis.chords[last.atChordIndex]
    expect(finalChord?.numeral?.text).toBe('I')
    expect(finalChord?.measureIndex).toBe(11) // the last measure, 0-indexed
  })

  it('gives every chord a bass equal to the lowest of its reported pitches', () => {
    for (const chord of analysis.chords) {
      expect(chord.bass).toBe(Math.min(...chord.midi))
    }
  })

  it('detects its own key when none is supplied, instead of silently defaulting to C major', () => {
    const withoutKey = analyseScore(score)
    expect(withoutKey.key).toEqual(detectKey(score))
  })
})

// ---------------------------------------------------------------------------
// the non-chord-tone fallback, and the case respellForKey cannot reach
// ---------------------------------------------------------------------------

describe('analyseScore — core-too-thin fallback and unspellable keys', () => {
  it('names a chord from the full sounding set when the longest-held note alone is just a single pitch', () => {
    // A held melody note (the longest-held pitch, so it alone is the "core") over a
    // shorter accompaniment triad — the core alone names nothing, so every sounding
    // pitch must get a look for the fallback to name the chord at all.
    const score = makeScore({
      id: 'thin-core-probe',
      measures: [{ keyFifths: 0 }],
      notes: [
        { midi: 67, startTick: 0, durationTicks: 1920, hand: 'right' }, // G, held the whole measure
        { midi: 60, startTick: 0, durationTicks: 960, hand: 'left' }, // C
        { midi: 64, startTick: 0, durationTicks: 960, hand: 'left' }, // E
      ],
    })
    const key = detectKey(score)
    const analysis = analyseScore(score, key)
    expect(analysis.chords[0]?.numeral?.text).toBe('I')
  })

  it('reports null rather than a guess when nothing sounding is recognisable as a chord at all', () => {
    // A tight chromatic cluster: no root/quality combination shares enough of its
    // pitch classes to clear identifyChord's confidence floor, in ANY key, so both
    // the core and the full-sounding-set fallback come back empty.
    const score = makeScore({
      id: 'unrecognisable-probe',
      measures: [{ keyFifths: 0 }],
      notes: [
        { midi: 60, startTick: 0, durationTicks: 1920, hand: 'right' },
        { midi: 61, startTick: 0, durationTicks: 1920, hand: 'right' },
        { midi: 62, startTick: 0, durationTicks: 1920, hand: 'right' },
        { midi: 63, startTick: 0, durationTicks: 1920, hand: 'right' },
      ],
    })
    const key = detectKey(score)
    const analysis = analyseScore(score, key)
    expect(analysis.chords[0]?.numeral).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// property: a score built entirely from known diatonic triads never comes back null
// ---------------------------------------------------------------------------

/** Keys whose diatonic roots stay inside the standard 12 default pitch-class spellings
 *  (naturals and single sharps/flats) — excludes the handful of exotic keys (Cb/C#
 *  major and their relatives) whose diatonic degrees need a letter no MIDI pitch class
 *  is ever spelled with by default (Fb, B#, E#, Cb), a documented limitation of
 *  `respellForKey`. */
const SAFE_MAJOR_KEYS: readonly Key[] = CIRCLE_OF_FIFTHS.filter(
  (k) => Math.abs(k.signature.fifths) <= 5,
)
const SAFE_KEYS: readonly Key[] = [...SAFE_MAJOR_KEYS, ...SAFE_MAJOR_KEYS.map(relativeKey)]

const TRIAD_INVERSIONS: readonly Inversion[] = [0, 1, 2]

/** One measure per plan entry: a solid whole-note triad, no melody, no passing tones. */
function scoreFromTriadPlan(
  key: Key,
  plan: readonly { readonly degree: number; readonly inversion: Inversion }[],
): Score {
  const diatonic = diatonicChords(key)
  const notes: ScoreNoteInput[] = []
  plan.forEach(({ degree, inversion }, measureIndex) => {
    const base = diatonic[degree]
    if (base === undefined) throw new Error(`degree ${degree} out of range for ${diatonic.length}`)
    const chord = invertChord(base, inversion)
    for (const pitch of chord.notes) {
      notes.push({
        midi: toMidi(pitch),
        startTick: measureIndex * 1920,
        durationTicks: 1920,
        hand: 'right',
      })
    }
  })
  return makeScore({
    id: 'property-fixture',
    measures: plan.map(() => ({ keyFifths: key.signature.fifths })),
    notes,
  })
}

describe('property: known diatonic triads always analyse to a non-null numeral', () => {
  it('every slice of a score built from random diatonic triads, any inversion, any of the common keys, gets a numeral', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SAFE_KEYS),
        fc.array(
          fc.record({
            degree: fc.integer({ min: 0, max: 6 }),
            inversion: fc.constantFrom(...TRIAD_INVERSIONS),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        (key, plan) => {
          const score = scoreFromTriadPlan(key, plan)
          const analysis = analyseScore(score, key)

          expect(analysis.chords.length).toBe(plan.length)
          plan.forEach(({ degree, inversion }, i) => {
            const chord = analysis.chords[i]
            expect(chord?.numeral).not.toBeNull()
            // Not just "some numeral came back" — the exact planted degree and
            // inversion, so a respelling or inversion bug can't hide behind a
            // merely-non-null assertion.
            expect(chord?.numeral?.degree).toBe(degree + 1)
            expect(chord?.numeral?.inversion).toBe(inversion)
          })
        },
      ),
    )
  })
})

// ---------------------------------------------------------------------------
// property (roadmap 3.19, REQ-3.5.5): one non-cadential chromatic accidental
// never flips a major key to its relative minor
// ---------------------------------------------------------------------------

describe('property: a single non-cadential chromatic accidental never flips detectKey to the relative minor', () => {
  it('adding the relative minor’s raised leading tone as a short mid-piece passing tone, at a random position and duration, over vi-IV-V-I in any safe major key, leaves the detected key major', () => {
    // The skeleton is vi-IV-V-I, not I-IV-V-I: opening on vi means firstIsMinorTonic is
    // ALREADY true for every generated key, so one bass vote is live before the
    // leading-tone vote is even considered — reaching minorVotes >= 2 (a wrong flip to
    // minor) takes exactly one more true vote. A stub that hardwires the leading-tone
    // vote to `true`, or that reverts it to "the pitch class is present anywhere in
    // score.notes" (true here, since the injected accidental's pitch class is always
    // present), supplies exactly that second vote and fails this test — unlike the old
    // I-IV-V-I skeleton, where both bass votes were false for every generated key and a
    // hardwired-`true` leading-tone stub could never push minorVotes past 1.
    //
    // The accidental's measure (one of the first three — never the final I, which would
    // make it cadential and change what the test is asking), tick offset and duration
    // are all generated, not fixed to one spot: scale degrees 6, 4, 5 and 1 are always
    // four distinct pitch classes in a major scale, so the bass can never coincidentally
    // land on the minor tonic class no matter where or how long the passing tone is.
    fc.assert(
      fc.property(
        fc.constantFrom(...SAFE_MAJOR_KEYS),
        fc.integer({ min: 0, max: 2 }),
        fc.integer({ min: 0, max: 1900 }),
        fc.integer({ min: 1, max: 20 }),
        (key, accidentalMeasureIndex, offsetInMeasure, durationTicks) => {
          const diatonic = diatonicChords(key)
          const minor = relativeKey(key)
          const minorTonicClass = toMidi(minor.tonic) % 12
          const raisedLeadingToneClass = (minorTonicClass + 11) % 12

          const plan = [5, 3, 4, 0] // vi - IV - V - I, root position, one measure each
          const notes: ScoreNoteInput[] = []
          plan.forEach((degree, measureIndex) => {
            const chord = diatonic[degree]
            if (chord === undefined) throw new Error(`degree ${degree} out of range`)
            for (const pitch of chord.notes) {
              notes.push({
                midi: toMidi(pitch),
                startTick: measureIndex * 1920,
                durationTicks: 1920,
                hand: 'left',
              })
            }
          })
          // The chromatic passing tone: a short right-hand note at a generated position
          // inside a generated non-final measure, never touching the left-hand bass.
          notes.push({
            midi: 60 + raisedLeadingToneClass,
            startTick: accidentalMeasureIndex * 1920 + offsetInMeasure,
            durationTicks,
            hand: 'right',
          })

          const score = makeScore({
            id: 'chromatic-property-fixture',
            measures: plan.map(() => ({ keyFifths: key.signature.fifths })),
            notes,
          })

          const detected = detectKey(score)
          expect(detected.mode).toBe('major')
          expect(detected.tonic.letter).toBe(key.tonic.letter)
          expect(detected.tonic.alter).toBe(key.tonic.alter)
        },
      ),
    )
  })
})
