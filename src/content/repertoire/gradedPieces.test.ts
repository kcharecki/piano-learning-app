import { describe, expect, it } from 'vitest'
import { addPiece, type RepertoirePiece } from '@core/repertoire/repertoire.ts'
import { GRADED_PIECES } from './gradedPieces.ts'

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/

describe('GRADED_PIECES', () => {
  it('has exactly 20 entries', () => {
    expect(GRADED_PIECES.length).toBe(20)
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

  it('gives every piece a substantive, distinct grading rationale, a composer, and no scoreId', () => {
    const notes = new Set<string>()
    for (const piece of GRADED_PIECES) {
      expect(piece.gradingNote.trim().length).toBeGreaterThan(40)
      expect(piece.composer.trim().length).toBeGreaterThan(0)
      expect(piece.scoreId).toBeUndefined()
      expect('scoreId' in piece).toBe(false)
      notes.add(piece.gradingNote)
    }
    expect(notes.size).toBe(GRADED_PIECES.length)
  })

  it('folds cleanly through addPiece into a real 20-piece RepertoirePiece library that preserves content', () => {
    let library: readonly RepertoirePiece[] = []
    for (const piece of GRADED_PIECES) {
      const result = addPiece(library, piece)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('unreachable')
      library = result.value
    }
    expect(library.length).toBe(20)
    expect(library.map(({ id, title, composer, level }) => ({ id, title, composer, level }))).toEqual(
      GRADED_PIECES.map(({ id, title, composer, level }) => ({ id, title, composer, level })),
    )
    for (const piece of library) {
      expect(piece.status).toBe('learning')
      expect(piece.sessions).toEqual([])
      expect(piece.bestAccuracy).toBe(0)
    }
  })
})
