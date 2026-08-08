import { describe, expect, it } from 'vitest'
import { addPiece, type RepertoirePiece } from '@core/repertoire/repertoire.ts'
import { gradedScoreById } from '@content/scores/gradedScoreFiles.ts'
import { GRADED_PIECES } from './gradedPieces.ts'

/** The key signature (fifths) each entry's bundled score is stated to be in — the roadmap 5.1
 *  proof action's "key signature matches the entry's stated key" check. */
const EXPECTED_KEY_FIFTHS: ReadonlyMap<string, number> = new Map([
  ['au-clair-de-la-lune', 0],
  ['hot-cross-buns', 0],
  ['london-bridge-is-falling-down', 0],
  ['mary-had-a-little-lamb', 0],
  ['merrily-we-roll-along', 0],
  ['ode-to-joy-theme', 0],
  ['amazing-grace', 1],
  ['long-long-ago', 0],
  ['minuet-in-g-major-bwv-anh-114', 1],
  ['scarborough-fair', 1],
  ['skip-to-my-lou', 0],
  ['fur-elise-theme', 0],
  ['greensleeves', 0],
  ['burgmuller-arabesque-op-100-no-2', 0],
  ['bach-prelude-in-c-major-bwv-846', 0],
  ['kuhlau-sonatina-op-20-no-1', 0],
  ['clementi-sonatina-op-36-no-1', 0],
  ['beethoven-sonatina-op-49-no-1', -2],
  ['bach-invention-no-1-bwv-772', 0],
  ['chopin-prelude-op-28-no-4', 1],
  ['twinkle-twinkle-little-star', 0],
  ['row-row-row-your-boat', 0],
  ['frere-jacques', 0],
  ['this-old-man', 0],
  ['old-macdonald-had-a-farm', 0],
  ['lightly-row', 0],
  ['yankee-doodle', 0],
  ['jolly-old-saint-nicholas', 0],
  ['ring-around-the-rosie', 0],
  ['rain-rain-go-away', 0],
  ['the-farmer-in-the-dell', 0],
  ['when-the-saints-go-marching-in', 0],
  ['jingle-bells', 1],
  ['camptown-races', 1],
  ['oh-susanna', 1],
  ['auld-lang-syne', 1],
  ['simple-gifts', -1],
  ['home-on-the-range', -1],
  ['my-bonnie-lies-over-the-ocean', 1],
  ['danny-boy', 1],
])

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/

describe('GRADED_PIECES', () => {
  it('has exactly 40 entries', () => {
    expect(GRADED_PIECES.length).toBe(40)
  })

  it('roadmap 5.3: has at least 40 entries and at least 25 at level <= 2', () => {
    expect(GRADED_PIECES.length).toBeGreaterThanOrEqual(40)
    const belowOrAtLevel2 = GRADED_PIECES.filter((p) => p.level <= 2).length
    expect(belowOrAtLevel2).toBeGreaterThanOrEqual(25)
  })

  it('has unique, kebab-case ids', () => {
    const ids = GRADED_PIECES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id).toMatch(KEBAB_CASE)
    }
  })

  it('assigns every piece an integer level in 1..5', () => {
    for (const piece of GRADED_PIECES) {
      expect(Number.isInteger(piece.level)).toBe(true)
      expect(piece.level).toBeGreaterThanOrEqual(1)
      expect(piece.level).toBeLessThanOrEqual(5)
    }
  })

  it('is weighted toward the lower levels and covers every level 1..5', () => {
    const counts = new Map<number, number>()
    for (const piece of GRADED_PIECES) {
      counts.set(piece.level, (counts.get(piece.level) ?? 0) + 1)
    }
    for (let level = 1; level <= 5; level++) {
      expect(counts.get(level) ?? 0).toBeGreaterThan(0)
    }
    const lower = (counts.get(1) ?? 0) + (counts.get(2) ?? 0)
    const upper = (counts.get(3) ?? 0) + (counts.get(4) ?? 0) + (counts.get(5) ?? 0)
    expect(lower).toBeGreaterThanOrEqual(upper)
  })

  it('is sorted ascending by level, then by title, with no duplicate titles at a level', () => {
    for (let i = 1; i < GRADED_PIECES.length; i++) {
      const prev = GRADED_PIECES[i - 1]
      const curr = GRADED_PIECES[i]
      if (prev === undefined || curr === undefined) throw new Error('unreachable')
      if (prev.level !== curr.level) {
        expect(curr.level).toBeGreaterThan(prev.level)
      } else {
        expect(prev.title.localeCompare(curr.title, 'en')).toBeLessThan(0)
      }
    }
    const titles = GRADED_PIECES.map((p) => p.title)
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('gives every piece a substantive, distinct grading rationale, a composer, and a real scoreId', () => {
    const notes = new Set<string>()
    for (const piece of GRADED_PIECES) {
      expect(piece.gradingNote.trim().length).toBeGreaterThan(40)
      expect(piece.composer.trim().length).toBeGreaterThan(0)
      expect(piece.scoreId).toBe(piece.id)
      notes.add(piece.gradingNote)
    }
    expect(notes.size).toBe(GRADED_PIECES.length)
  })

  it('resolves every scoreId to a real, non-empty Score whose key signature matches the stated key (roadmap 5.1)', () => {
    expect(EXPECTED_KEY_FIFTHS.size).toBe(GRADED_PIECES.length)
    for (const piece of GRADED_PIECES) {
      const scoreId = piece.scoreId
      expect(scoreId).toBeDefined()
      if (scoreId === undefined) throw new Error('unreachable')
      const parsed = gradedScoreById(scoreId)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) throw new Error(`${piece.id}: ${parsed.error}`)
      expect(parsed.value.notes.length).toBeGreaterThan(0)
      const expectedFifths = EXPECTED_KEY_FIFTHS.get(piece.id)
      expect(expectedFifths).toBeDefined()
      expect(parsed.value.measures[0]?.keyFifths).toBe(expectedFifths)
    }
  })

  it('folds cleanly through addPiece into a real 40-piece RepertoirePiece library that preserves content', () => {
    let library: readonly RepertoirePiece[] = []
    for (const piece of GRADED_PIECES) {
      const result = addPiece(library, piece)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('unreachable')
      library = result.value
    }
    expect(library.length).toBe(40)
    expect(
      library.map(({ id, title, composer, level }) => ({ id, title, composer, level })),
    ).toEqual(
      GRADED_PIECES.map(({ id, title, composer, level }) => ({ id, title, composer, level })),
    )
    for (const piece of library) {
      expect(piece.status).toBe('learning')
      expect(piece.sessions).toEqual([])
      expect(piece.bestAccuracy).toBe(0)
    }
  })
})
