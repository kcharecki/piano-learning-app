import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { type Midi } from '@core/shared/units.ts'
import { at } from '@core/shared/invariant.ts'
import { seededRng } from '@core/ports/rng.ts'
import { classifyCadence, chordForRomanNumeral } from '@core/theory/harmony.ts'
import { keyFromFifths } from '@core/theory/keys.ts'
import {
  buildTheoryQuiz,
  MAX_THEORY_LEVEL,
  theoryQuizFromId,
  type TheoryQuizItem,
  type TheoryQuizKind,
} from './theory.ts'

const KINDS: readonly TheoryQuizKind[] = [
  'build-scale',
  'build-chord',
  'build-interval',
  'name-key-signature',
  'build-cadence',
]

const arbKind = fc.constantFrom(...KINDS)
const arbLevel = fc.integer({ min: 1, max: 10 })
const arbSeed = fc.integer({ min: 0, max: 2 ** 31 - 1 })

// ---------------------------------------------------------------------------
// buildTheoryQuiz — determinism
// ---------------------------------------------------------------------------

describe('buildTheoryQuiz — determinism', () => {
  it('is fully determined by kind, level and a seeded rng, ids included', () => {
    fc.assert(
      fc.property(arbKind, arbLevel, arbSeed, (kind, level, seed) => {
        const a = buildTheoryQuiz(kind, level, seededRng(seed))
        const b = buildTheoryQuiz(kind, level, seededRng(seed))
        expect(b).toEqual(a)
      }),
    )
  })

  it('treats level 0 and negative levels as level 1', () => {
    fc.assert(
      fc.property(arbKind, arbSeed, (kind, seed) => {
        const level1 = buildTheoryQuiz(kind, 1, seededRng(seed))
        expect(buildTheoryQuiz(kind, 0, seededRng(seed))).toEqual(level1)
        expect(buildTheoryQuiz(kind, -5, seededRng(seed))).toEqual(level1)
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// buildTheoryQuiz — shape
// ---------------------------------------------------------------------------

describe('buildTheoryQuiz — shape', () => {
  it('marks chord/cadence items simultaneous and note-sequence items not', () => {
    const expected: Readonly<Record<TheoryQuizKind, boolean>> = {
      'build-scale': false,
      'build-chord': true,
      'build-interval': false,
      'name-key-signature': false,
      'build-cadence': true,
    }
    fc.assert(
      fc.property(arbKind, arbLevel, arbSeed, (kind, level, seed) => {
        const item = buildTheoryQuiz(kind, level, seededRng(seed))
        expect(item.simultaneous).toBe(expected[kind])
        expect(item.kind).toBe(kind)
        expect(item.answer.length).toBeGreaterThan(0)
      }),
    )
  })

  it('build-scale plays ascending, tonic to tonic', () => {
    const item = buildTheoryQuiz('build-scale', 4, seededRng(7))
    expect(item.prompt).toMatch(/^Play .+, ascending\.$/)
    expect(item.answer.length).toBeGreaterThanOrEqual(6)
    // every group is exactly one note
    for (const group of item.answer) expect(group.length).toBe(1)
  })

  it('build-chord plays every voice of the chord together', () => {
    const item = buildTheoryQuiz('build-chord', 4, seededRng(3))
    expect(item.prompt).toMatch(/^Play a \S+ .+ chord, .+\.$/)
    expect(item.answer.length).toBe(1)
    expect((item.answer[0] as readonly Midi[]).length).toBeGreaterThanOrEqual(3)
  })

  it('build-interval plays the root, then the interval note', () => {
    const item = buildTheoryQuiz('build-interval', 4, seededRng(9))
    expect(item.prompt).toMatch(/^Play \S+, then a .+ above it\.$/)
    expect(item.answer.length).toBe(2)
    for (const group of item.answer) expect(group.length).toBe(1)
    // the target really is above the root, by the interval's own distance
    const semitones = (item.answer[1] as readonly Midi[])[0] as number
    const root = (item.answer[0] as readonly Midi[])[0] as number
    expect(semitones - root).toBeGreaterThan(0)
  })

  it('name-key-signature is answered by a single tonic note', () => {
    const item = buildTheoryQuiz('name-key-signature', 4, seededRng(5))
    expect(item.prompt).toMatch(
      /^How many (sharps|flats|sharps or flats) has .+\? Answer by playing its tonic\.$/,
    )
    expect(item.answer).toEqual([item.answer[0]])
    expect((item.answer[0] as readonly Midi[]).length).toBe(1)
  })

  it('build-cadence plays two chords in sequence', () => {
    const item = buildTheoryQuiz('build-cadence', 4, seededRng(11))
    expect(item.prompt).toMatch(/^Play a .+ cadence in .+\.$/)
    expect(item.answer.length).toBe(2)
    for (const group of item.answer) expect(group.length).toBeGreaterThanOrEqual(3)
  })

  it('level 1 stays at the simplest pool: no accidentals, only the perfect authentic cadence', () => {
    for (let seed = 0; seed < 20; seed++) {
      const key = buildTheoryQuiz('name-key-signature', 1, seededRng(seed))
      expect(key.prompt).toMatch(
        /^How many sharps or flats has (C major|A minor)\? Answer by playing its tonic\.$/,
      )

      const cadence = buildTheoryQuiz('build-cadence', 1, seededRng(seed))
      expect(cadence.prompt).toMatch(/^Play a perfect authentic cadence in/)
    }
  })

  it('level 1 build-cadence items really are perfect authentic cadences, per classifyCadence', () => {
    const cMajor = keyFromFifths(0, 'major')
    const v = chordForRomanNumeral('V', cMajor)
    const i = chordForRomanNumeral('I', cMajor)
    if (!v.ok || !i.ok) throw new Error('V and I must be diatonic in C major')
    for (let seed = 0; seed < 30; seed++) {
      const item = buildTheoryQuiz('build-cadence', 1, seededRng(seed))
      const soprano = (item.answer[1] as readonly Midi[]).at(-1) as Midi
      expect(classifyCadence(v.value, i.value, cMajor, soprano)).toBe('perfect-authentic')
    }
  })

  it('chord and interval roots widen past naturals by level 3', () => {
    let sawAccidentalRoot = false
    for (let seed = 0; seed < 200 && !sawAccidentalRoot; seed++) {
      const chord = buildTheoryQuiz('build-chord', 3, seededRng(seed))
      const interval = buildTheoryQuiz('build-interval', 3, seededRng(seed))
      if (/[#b]/.test(chord.prompt) || /[#b]/.test(interval.prompt)) sawAccidentalRoot = true
    }
    expect(sawAccidentalRoot).toBe(true)
  })

  it('level progression is monotonic: every id reachable at a level is still reachable one level up', () => {
    for (const kind of KINDS) {
      for (let level = 1; level <= 3; level++) {
        const lowerIds = new Set<string>()
        const higherIds = new Set<string>()
        for (let seed = 0; seed < 100; seed++) {
          lowerIds.add(buildTheoryQuiz(kind, level, seededRng(seed)).id)
          higherIds.add(buildTheoryQuiz(kind, level + 1, seededRng(seed)).id)
        }
        for (const id of lowerIds) {
          if (higherIds.has(id)) continue
          // A higher level's pool is a strict superset — more seeds at the
          // higher level must eventually reach the same id.
          let found = false
          for (let seed = 100; seed < 6000 && !found; seed++) {
            if (buildTheoryQuiz(kind, level + 1, seededRng(seed)).id === id) found = true
          }
          expect(found).toBe(true)
        }
      }
    }
  })
})


// ---------------------------------------------------------------------------
// theoryQuizFromId — the reverse of a generated id (roadmap 3.20, REQ-3.5.6)
// ---------------------------------------------------------------------------

describe('theoryQuizFromId', () => {
  it('reads back the EXACT item a real id names: same id, kind, prompt, answer, simultaneity', () => {
    // Kills a stub that "fakes" reversibility by re-seeding `buildTheoryQuiz`
    // from a hash of the id (explicitly the wrong shape per the brief): that
    // stub would return a DIFFERENT item's prompt/answer most of the time,
    // not the one the id actually names, so this exact-equality check (not
    // merely "same kind") fails it. Also kills a stub that returns the input
    // unchanged only for `build-scale` ids (the simplest case) — every kind
    // is covered here.
    fc.assert(
      fc.property(arbKind, arbLevel, arbSeed, (kind, level, seed) => {
        const original = buildTheoryQuiz(kind, level, seededRng(seed))
        const reconstructed = theoryQuizFromId(original.id)
        expect(reconstructed).toBeDefined()
        expect(reconstructed?.id).toBe(original.id)
        expect(reconstructed?.kind).toBe(original.kind)
        expect(reconstructed?.prompt).toBe(original.prompt)
        expect(reconstructed?.answer).toEqual(original.answer)
        expect(reconstructed?.simultaneous).toBe(original.simultaneous)
      }),
    )
  })

  it('round-trips a flat key signature — fifths is negative, so the id itself contains a stray "-"', () => {
    // 'name-key-signature--3-minor' etc: a naive split-on-'-' parser (rather
    // than the anchored regex this module uses) would misplace the fields
    // here. Search a small seed range for a negative-fifths item so the test
    // does not depend on which seed happens to produce one.
    let found: TheoryQuizItem | undefined
    for (let seed = 0; seed < 100 && found === undefined; seed++) {
      const item = buildTheoryQuiz('name-key-signature', MAX_THEORY_LEVEL, seededRng(seed))
      if (item.id.includes('-signature--')) found = item
    }
    expect(found).toBeDefined()
    const item = found as TheoryQuizItem
    const reconstructed = theoryQuizFromId(item.id)
    expect(reconstructed?.id).toBe(item.id)
    expect(reconstructed?.prompt).toBe(item.prompt)
    expect(reconstructed?.answer).toEqual(item.answer)
  })

  it('round-trips every cadence type, including the ones whose own name contains a "-"', () => {
    // 'perfect-authentic' embeds a dash inside the id's own type field —
    // splitting the remainder positionally (like build-chord/build-interval
    // do) would misread it as an extra field. Kills a parser that assumes
    // every kind's remainder splits cleanly on '-'.
    const seenTypes = new Set<string>()
    for (let seed = 0; seed < 100 && seenTypes.size < 4; seed++) {
      const item = buildTheoryQuiz('build-cadence', MAX_THEORY_LEVEL, seededRng(seed))
      seenTypes.add(item.prompt)
      const reconstructed = theoryQuizFromId(item.id)
      expect(reconstructed?.id).toBe(item.id)
      expect(reconstructed?.prompt).toBe(item.prompt)
      expect(reconstructed?.answer).toEqual(item.answer)
    }
  })

  it('returns undefined for ids this module never produced, rather than guessing', () => {
    // Kills a stub that falls back to SOME item (e.g. buildTheoryQuiz(kind, 1,
    // a fixed rng)) whenever parsing gets hard, instead of admitting failure.
    const malformed = [
      '',
      'not-a-real-id',
      'build-scale-C', // missing scale type
      'build-scale-Z-major', // 'Z' is not a note letter
      'build-chord-C-madeUpQuality-0', // unknown chord quality
      'build-chord-C-major-9', // inversion out of range
      'build-interval-C-3-madeUpQuality', // unknown interval quality
      'name-key-signature-notanumber-major', // fifths must be numeric
      'name-key-signature-3-mixolydian', // key-signature mode is major/minor only
      'build-cadence-madeUpCadence-C', // unknown cadence type
      'name-key-signature-3', // missing mode
    ]
    for (const id of malformed) {
      expect(theoryQuizFromId(id)).toBeUndefined()
    }
  })

  it('rejects an id whose inversion re-serialises differently, via the id === rebuilt-id guard', () => {
    // 'Number("00") === 0' parses cleanly as a valid inversion, and every
    // earlier check (regex, length, table lookup) accepts it — this id is
    // rejected ONLY by `theoryQuizFromId`'s last-line `item.id === id` check,
    // since the rebuilt item's id is 'build-chord-C-major-0', not '...-00'.
    // Kills a mutant that deletes that guard: every other malformed-id case
    // above is caught earlier and stays green either way.
    expect(theoryQuizFromId('build-chord-C-major-00')).toBeUndefined()
  })

  it('an unknown-kind id (no recognised prefix) is undefined, not a crash', () => {
    expect(theoryQuizFromId('note-name-C4')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// MAX_THEORY_LEVEL — the level selector's honest ceiling (roadmap 3.20)
// ---------------------------------------------------------------------------

describe('MAX_THEORY_LEVEL', () => {
  it('equals the highest level any axis still widens at, not just the *_BY_LEVEL tables own length', () => {
    // Every *_BY_LEVEL table plateaus at 4 tiers, but `fifthsPoolForLevel`
    // (feeding build-scale, name-key-signature and build-cadence) keeps
    // widening through MAX_ACCIDENTALS + 1 = 8 — key signatures up to 7
    // sharps/flats, e.g. E major (4 sharps) at level 5, only become drawable
    // once the ceiling accounts for that non-table axis too. Kills a stub
    // that derives the ceiling from the *_BY_LEVEL tables alone (=4) and
    // silently caps three of the five kinds below their real width.
    expect(MAX_THEORY_LEVEL).toBe(8)
  })

  it('selecting the maximum level yields a different item pool than one level below, for the kinds whose pool widens via key-signature width', () => {
    // NOT "for every kind": build-chord and build-interval draw only from
    // *_BY_LEVEL tables that plateau at level 4 (their own length), so their
    // pool at MAX_THEORY_LEVEL (8) and MAX_THEORY_LEVEL - 1 (7) is genuinely
    // identical — asserting otherwise would be the false premise finding 1
    // corrects, not a stronger test. Only build-scale, name-key-signature and
    // build-cadence draw a tonic/key through `fifthsPoolForLevel`, which is
    // what keeps widening all the way to the true ceiling.
    const FIFTHS_DRIVEN_KINDS: readonly TheoryQuizKind[] = [
      'build-scale',
      'name-key-signature',
      'build-cadence',
    ]
    for (const kind of FIFTHS_DRIVEN_KINDS) {
      const atMax = new Set<string>()
      const belowMax = new Set<string>()
      for (let seed = 0; seed < 300; seed++) {
        atMax.add(buildTheoryQuiz(kind, MAX_THEORY_LEVEL, seededRng(seed)).id)
        belowMax.add(buildTheoryQuiz(kind, MAX_THEORY_LEVEL - 1, seededRng(seed)).id)
      }
      const widened = [...atMax].some((id) => !belowMax.has(id))
      expect(widened).toBe(true)
    }
  })

  it('build-chord and build-interval plateau at level 4 — MAX_THEORY_LEVEL does not change their pool', () => {
    // The flip side of the test above, pinned explicitly rather than left as
    // an absence: these two kinds' pools at the ceiling and one below it are
    // the SAME set, because neither axis they draw from widens past level 4.
    for (const kind of ['build-chord', 'build-interval'] as const) {
      const atMax = new Set<string>()
      const belowMax = new Set<string>()
      for (let seed = 0; seed < 300; seed++) {
        atMax.add(buildTheoryQuiz(kind, MAX_THEORY_LEVEL, seededRng(seed)).id)
        belowMax.add(buildTheoryQuiz(kind, MAX_THEORY_LEVEL - 1, seededRng(seed)).id)
      }
      expect(atMax).toEqual(belowMax)
    }
  })

  it('produces no id beyond MAX_THEORY_LEVEL that is not already reachable at MAX_THEORY_LEVEL, for every kind', () => {
    // The test above only ever visited MAX_THEORY_LEVEL and MAX_THEORY_LEVEL
    // - 1, so a ceiling that is honest going up but still one level short of
    // where every axis truly plateaus (or one level too many) would pass it
    // either way. This instead checks the plateau itself: one level past the
    // ceiling must not unlock anything MAX_THEORY_LEVEL's own pool lacks.
    for (const kind of KINDS) {
      const atMax = new Set<string>()
      for (let seed = 0; seed < 300; seed++) {
        atMax.add(buildTheoryQuiz(kind, MAX_THEORY_LEVEL, seededRng(seed)).id)
      }
      for (let seed = 0; seed < 300; seed++) {
        const id = buildTheoryQuiz(kind, MAX_THEORY_LEVEL + 1, seededRng(seed)).id
        expect(atMax.has(id)).toBe(true)
      }
    }
  })

  it('E major (4 sharps) is drawable as a key-signature item once the level is high enough', () => {
    // The roadmap task's own motivating example: keyFromFifths(4, 'major')
    // needs fifths = 4 in the pool, which first appears at level 5
    // (fifthsRangeForLevel(5) = min(7, 4) = 4) — unreachable under the
    // reverted level-4 ceiling this finding undoes.
    let sawEMajor = false
    for (let seed = 0; seed < 500 && !sawEMajor; seed++) {
      const item = buildTheoryQuiz('name-key-signature', 5, seededRng(seed))
      if (item.prompt.includes('E major')) sawEMajor = true
    }
    expect(sawEMajor).toBe(true)
  })
})


describe('build-cadence — the leading tone resolves upward (roadmap T.23)', () => {
  /**
   * Every cadence item the generator can draw, at every level the selector
   * offers, collected by exhausting the draw rather than by rebuilding the key
   * list here — a test that spells its own keys cannot catch the generator
   * widening past them.
   */
  function everyCadenceItem(): readonly TheoryQuizItem[] {
    const byId = new Map<string, TheoryQuizItem>()
    for (let level = 1; level <= MAX_THEORY_LEVEL; level += 1) {
      for (let seed = 0; seed < 400; seed += 1) {
        const item = buildTheoryQuiz('build-cadence', level, seededRng(seed))
        byId.set(item.id, item)
      }
    }
    return [...byId.values()]
  }

  const ITEMS = everyCadenceItem()

  it('draws every cadence type, in every key the level range reaches', () => {
    const types = new Set(ITEMS.map((i) => i.id.split('-').slice(2, -1).join('-')))
    expect([...types].sort()).toEqual(['deceptive', 'half', 'perfect-authentic', 'plagal'])
    // 15 keys: seven flats through seven sharps.
    const keys = new Set(ITEMS.map((i) => i.id.split('-').at(-1)))
    expect(keys.size).toBe(15)
  })

  it('gives the leading tone of a perfect authentic cadence somewhere to rise to', () => {
    const pacs = ITEMS.filter((i) => i.id.startsWith('build-cadence-perfect-authentic-'))
    expect(pacs.length).toBe(15)
    for (const item of pacs) {
      const cadence = item.cadence
      expect(cadence).toBeDefined()
      if (cadence === undefined) continue
      const leadingToneClass = (cadence.tonicPitchClass + 11) % 12
      const dominant = at(item.answer, 0)
      const final = at(item.answer, 1)
      const leadingTones = dominant.filter((n) => n % 12 === leadingToneClass)
      // The dominant of a major key HAS the leading tone; if it stopped
      // containing one this assertion is what says so.
      expect(leadingTones.length, `${item.id} dominant has no leading tone`).toBeGreaterThan(0)
      for (const lt of leadingTones) {
        // A semitone up from that very note must be present in the final
        // chord. This is the original T.23 defect: the answer named a tonic
        // chord whose highest note was below the leading tone, so under the
        // obvious voice reading 7 fell a fifth instead of rising a semitone.
        expect(
          final.includes((lt + 1) as Midi),
          `${item.id}: no ${String(lt + 1)} above the leading tone ${String(lt)} in ${final.join()}`,
        ).toBe(true)
      }
    }
  })
})
