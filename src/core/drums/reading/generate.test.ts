/**
 * Property-first: the pedagogical guarantees ("every exercise validates",
 * "no dead cells", "no silent bar above level 1", "no cell straddles a
 * barline") matter far more here than any one example, since the generator's
 * whole job is to be trustworthy across thousands of unseen seeds a real
 * learner will hit.
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { seededRng } from '@core/ports/rng.ts'
import { validateGrooveScore } from '@core/drums/model/groove.ts'
import { cellsForLevel, MAX_READING_LEVEL, MIN_READING_LEVEL, type ReadingLevel } from './levels.ts'
import { fillMeasure, generateReadingExercise, readingOnsetCount } from './generate.ts'

const levelArb = fc.integer({ min: MIN_READING_LEVEL, max: MAX_READING_LEVEL }) as fc.Arbitrary<ReadingLevel>
const measuresArb = fc.integer({ min: 1, max: 4 })
const seedArb = fc.integer({ min: 0, max: 2 ** 31 - 1 })

describe('generateReadingExercise', () => {
  it('every generated exercise validates (property)', () => {
    fc.assert(
      fc.property(seedArb, levelArb, measuresArb, (seed, level, measures) => {
        const score = generateReadingExercise({ level, measures }, seededRng(seed))
        expect(validateGrooveScore(score).ok).toBe(true)
      }),
    )
  })

  it('is deterministic from seed and options', () => {
    fc.assert(
      fc.property(seedArb, levelArb, measuresArb, (seed, level, measures) => {
        const a = generateReadingExercise({ level, measures }, seededRng(seed))
        const b = generateReadingExercise({ level, measures }, seededRng(seed))
        expect(a).toEqual(b)
      }),
    )
  })

  it('only ever places notes on the snare pad', () => {
    fc.assert(
      fc.property(seedArb, levelArb, measuresArb, (seed, level, measures) => {
        const score = generateReadingExercise({ level, measures }, seededRng(seed))
        for (const note of score.notes) expect(note.pad).toBe('snare')
      }),
    )
  })

  it('never produces an all-rest bar at level >= 2', () => {
    fc.assert(
      fc.property(seedArb, fc.integer({ min: 2, max: MAX_READING_LEVEL }) as fc.Arbitrary<ReadingLevel>, measuresArb, (seed, level, measures) => {
        const score = generateReadingExercise({ level, measures }, seededRng(seed))
        for (const measure of score.measures) {
          const end = measure.startTick + measure.durationTicks
          const notesInBar = score.notes.filter((n) => n.tick >= measure.startTick && n.tick < end)
          expect(notesInBar.length).toBeGreaterThan(0)
        }
      }),
    )
  })

  it('builds the id and title from level, name and the id option', () => {
    const score = generateReadingExercise({ level: 3, id: 'seed-42' }, seededRng(1))
    expect(score.id).toBe('reading-L3-seed-42')
    expect(score.title).toBe('Reading level 3: Eighth rests')
  })

  it('defaults id to "reading" and measures to 2', () => {
    const score = generateReadingExercise({ level: 1 }, seededRng(1))
    expect(score.id).toBe('reading-L1-reading')
    expect(score.measures.length).toBe(2)
  })

  it('supports 3/4', () => {
    const score = generateReadingExercise(
      { level: 4, timeSignature: { beats: 3, beatType: 4 } },
      seededRng(7),
    )
    expect(validateGrooveScore(score).ok).toBe(true)
    expect(score.timeSignature).toEqual({ beats: 3, beatType: 4 })
  })

  it('rejects an unsupported beat type', () => {
    expect(() =>
      generateReadingExercise({ level: 1, timeSignature: { beats: 6, beatType: 8 } }, seededRng(1)),
    ).toThrow()
  })

  it('readingOnsetCount counts the notes', () => {
    const score = generateReadingExercise({ level: 2, measures: 1 }, seededRng(3))
    expect(readingOnsetCount(score)).toBe(score.notes.length)
  })
})

describe('fillMeasure (no dead cells)', () => {
  it('every cell id in a level vocabulary appears at least once over many seeds (property)', () => {
    for (let level = MIN_READING_LEVEL; level <= MAX_READING_LEVEL; level++) {
      const readingLevel = level as ReadingLevel
      const vocabulary = cellsForLevel(readingLevel)
      const seen = new Set<string>()
      for (let seed = 0; seed < 4000; seed++) {
        const cells = fillMeasure(vocabulary, 4, readingLevel, seededRng(seed))
        for (const cell of cells) seen.add(cell.id)
        if (seen.size === vocabulary.length) break
      }
      const missing = vocabulary.map((c) => c.id).filter((id) => !seen.has(id))
      expect(missing).toEqual([])
    }
  })
})
