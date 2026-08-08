/**
 * The class of bug behind roadmap 5.8, asserted for EVERY lesson rather than
 * for the two instances that were reported.
 *
 * The G major lesson taught one sharp and then played a demonstration with
 * none: it, the F major lesson, and two sight-reading lessons about key
 * signatures all pointed `demoScoreId` at scores in C major. The prose was
 * right and the sound was wrong, which is the worst way round — a beginner
 * cannot tell which one is lying, and the audio wins.
 *
 * A test that pinned those four lessons would not have caught the fifth. So
 * this derives the claim from the lesson's own words: if a lesson states, in
 * its title or unambiguously in its prose, that it is about a particular key,
 * then the demonstration it plays must actually be in that key.
 *
 * ## Why the patterns are narrow
 *
 * A general "find any key name" scan is not usable here. `\b[A-G] major\b`
 * matches the indefinite article in "A major scale uses this same pattern",
 * and there is no reliable way to tell that from a genuine mention of A major
 * without parsing English. A test with false positives gets weakened or
 * deleted the first time it blocks a correct lesson, so the patterns below are
 * deliberately restricted to phrasings that cannot mean anything else:
 *
 *   - a key named in the lesson TITLE ("The G Major Scale")
 *   - "the key of G"
 *   - "G major's key signature"
 *   - "(D major: F# and C#)" — a parenthesised key naming its accidentals
 *
 * The cost of that narrowness is that a lesson can still discuss a key in
 * looser prose without being checked. The benefit is that every failure this
 * produces is a real defect. Widen it when a real miss is found, not on
 * speculation — and never in a way that can match an article.
 *
 * Key signature only, not mode: `Score` measures carry `keyFifths` and no
 * mode, and relative keys deliberately share a signature. A lesson naming A
 * minor is satisfied by a demo with no sharps or flats, which is correct — that
 * is what "relative" means.
 */
import { describe, expect, it } from 'vitest'
import { CURRICULUM } from '@content/curriculum/curriculum.ts'
import { demoScoreById } from '@content/scores/demoScores.ts'
import type { Lesson } from '@core/curriculum/types.ts'
import { keySignatureForTonic, type Mode } from '@core/theory/keys.ts'
import { spell, type Alter, type Letter } from '@core/theory/pitch.ts'

/** Keys have no register; the octave is discarded by `keySignatureForTonic`. */
const ANY_OCTAVE = 4

type NamedKey = {
  /** As written in the lesson, for the failure message. */
  readonly text: string
  readonly fifths: number
}

const LETTER = '([A-G])'
const ACCIDENTAL = '([#b♯♭]?)'
const MODE = '(major|minor)'

/**
 * Each pattern must capture, in order: letter, accidental, and — where the
 * phrasing carries one — mode. `modeGroup` is the capture index of the mode,
 * or `null` when the phrasing has none and major is meant ("the key of G" is
 * never said about a minor key in this curriculum's voice).
 */
const KEY_PATTERNS: readonly { readonly re: RegExp; readonly modeGroup: number | null }[] = [
  // "the key of G", "the key of Bb"
  { re: new RegExp(`\\bthe key of ${LETTER}${ACCIDENTAL}\\b`, 'gi'), modeGroup: null },
  // "G major's key signature", "F major's key signature"
  {
    re: new RegExp(`\\b${LETTER}${ACCIDENTAL} ${MODE}'s key signature`, 'gi'),
    modeGroup: 3,
  },
  // "(D major: F# and C#)" — a parenthesised key naming its own accidentals
  { re: new RegExp(`\\(${LETTER}${ACCIDENTAL} ${MODE}:`, 'gi'), modeGroup: 3 },
]

/** "The G Major Scale" — a key named in the title is always about that key. */
const TITLE_PATTERN = new RegExp(`\\b${LETTER}${ACCIDENTAL} (Major|Minor)\\b`, 'g')

function alterOf(accidental: string): Alter {
  if (accidental === '#' || accidental === '♯') return 1
  if (accidental === 'b' || accidental === '♭') return -1
  return 0
}

function fifthsOf(letter: string, accidental: string, mode: Mode): number {
  const tonic = spell(letter as Letter, alterOf(accidental), ANY_OCTAVE)
  const sig = keySignatureForTonic(tonic, mode)
  if (!sig.ok) throw new Error(`test: ${letter}${accidental} ${mode} has no key signature`)
  return sig.value.fifths
}

/** Every key this lesson unambiguously claims to be about, deduped by fifths. */
function keysNamedBy(lesson: Lesson): readonly NamedKey[] {
  const found = new Map<number, NamedKey>()

  const record = (letter: string, accidental: string, mode: Mode): void => {
    const fifths = fifthsOf(letter, accidental, mode)
    if (!found.has(fifths)) {
      found.set(fifths, { text: `${letter}${accidental} ${mode}`.replace('  ', ' '), fifths })
    }
  }

  for (const match of lesson.title.matchAll(TITLE_PATTERN)) {
    const [, letter = '', accidental = '', mode = 'Major'] = match
    record(letter, accidental, mode.toLowerCase() === 'minor' ? 'minor' : 'major')
  }

  for (const { re, modeGroup } of KEY_PATTERNS) {
    // `matchAll` needs a fresh lastIndex per lesson; the regexes are global.
    for (const match of lesson.explanation.matchAll(new RegExp(re.source, re.flags))) {
      const letter = match[1] ?? ''
      const accidental = match[2] ?? ''
      const rawMode = modeGroup === null ? 'major' : (match[modeGroup] ?? 'major')
      record(letter, accidental, rawMode.toLowerCase() === 'minor' ? 'minor' : 'major')
    }
  }

  return [...found.values()]
}

/** Every distinct key signature the demonstration actually engraves. */
function demoKeySignatures(demoScoreId: string): readonly number[] {
  const demo = demoScoreById(demoScoreId)
  if (demo === undefined) throw new Error(`test: unknown demo score '${demoScoreId}'`)
  return [...new Set(demo.score.measures.map((m) => m.keyFifths))]
}

describe('a lesson that names a key is demonstrated in that key (roadmap 5.8)', () => {
  const lessonsNamingAKey = CURRICULUM.lessons.flatMap((lesson) => {
    const keys = keysNamedBy(lesson)
    if (keys.length === 0 || lesson.demoScoreId === undefined) return []
    return [{ lesson, keys, demoScoreId: lesson.demoScoreId }]
  })

  it('finds lessons to check at all — a detector that matches nothing proves nothing', () => {
    // If a rewording of the curriculum silently stops every pattern matching,
    // the suite below would pass vacuously. This is the guard against that.
    expect(lessonsNamingAKey.length).toBeGreaterThanOrEqual(6)
  })

  it.each(
    lessonsNamingAKey.map(({ lesson, keys, demoScoreId }) => ({
      id: lesson.id,
      named: keys.map((k) => k.text).join(', '),
      keys,
      demoScoreId,
    })),
  )('$id names $named — its demonstration engraves it', ({ id, keys, demoScoreId }) => {
    const engraved = demoKeySignatures(demoScoreId)
    for (const key of keys) {
      expect(
        engraved,
        `lesson '${id}' is about ${key.text} (${key.fifths} fifths) but its demonstration ` +
          `'${demoScoreId}' engraves key signature(s) [${engraved.join(', ')}]. ` +
          `The prose and the sound disagree; a learner cannot tell which is lying.`,
      ).toContain(key.fifths)
    }
  })
})
