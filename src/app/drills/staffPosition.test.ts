/**
 * `staffPosition.ts` (roadmap 2.12) — checked against the standard staff
 * mnemonics directly, so a regression here would misplace a real flashcard
 * note on the wrong line or space.
 */
import { describe, expect, it } from 'vitest'
import { ledgerSteps, staffStep } from './staffPosition.ts'

describe('staffStep — treble clef (E4 G4 B4 D5 F5 lines, F4 A4 C5 E5 spaces)', () => {
  it.each([
    [{ letter: 'E', alter: 0, octave: 4 }, 0],
    [{ letter: 'F', alter: 0, octave: 4 }, 1],
    [{ letter: 'G', alter: 0, octave: 4 }, 2],
    [{ letter: 'A', alter: 0, octave: 4 }, 3],
    [{ letter: 'B', alter: 0, octave: 4 }, 4],
    [{ letter: 'C', alter: 0, octave: 5 }, 5],
    [{ letter: 'D', alter: 0, octave: 5 }, 6],
    [{ letter: 'E', alter: 0, octave: 5 }, 7],
    [{ letter: 'F', alter: 0, octave: 5 }, 8],
  ] as const)('%o is step %i', (spelled, step) => {
    expect(staffStep(spelled, 'treble')).toBe(step)
  })

  it('middle C sits two steps below the staff, on a ledger line', () => {
    expect(staffStep({ letter: 'C', alter: 0, octave: 4 }, 'treble')).toBe(-2)
  })

  it('an accidental never moves the note off its letter position', () => {
    const natural = staffStep({ letter: 'F', alter: 0, octave: 4 }, 'treble')
    const sharp = staffStep({ letter: 'F', alter: 1, octave: 4 }, 'treble')
    expect(sharp).toBe(natural)
  })
})

describe('staffStep — bass clef (G2 B2 D3 F3 A3 lines, A2 C3 E3 G3 spaces)', () => {
  it.each([
    [{ letter: 'G', alter: 0, octave: 2 }, 0],
    [{ letter: 'A', alter: 0, octave: 2 }, 1],
    [{ letter: 'B', alter: 0, octave: 2 }, 2],
    [{ letter: 'C', alter: 0, octave: 3 }, 3],
    [{ letter: 'D', alter: 0, octave: 3 }, 4],
    [{ letter: 'E', alter: 0, octave: 3 }, 5],
    [{ letter: 'F', alter: 0, octave: 3 }, 6],
    [{ letter: 'G', alter: 0, octave: 3 }, 7],
    [{ letter: 'A', alter: 0, octave: 3 }, 8],
  ] as const)('%o is step %i', (spelled, step) => {
    expect(staffStep(spelled, 'bass')).toBe(step)
  })

  it('middle C sits two steps above the staff, on a ledger line', () => {
    expect(staffStep({ letter: 'C', alter: 0, octave: 4 }, 'bass')).toBe(10)
  })
})

describe('ledgerSteps', () => {
  it('is empty for anything on the staff itself', () => {
    expect(ledgerSteps(0)).toEqual([])
    expect(ledgerSteps(4)).toEqual([])
    expect(ledgerSteps(8)).toEqual([])
  })

  it('lists every ledger line down to (and including) a note below the staff', () => {
    expect(ledgerSteps(-2)).toEqual([-2])
    expect(ledgerSteps(-6)).toEqual([-2, -4, -6])
  })

  it('lists every ledger line up to (and including) a note above the staff', () => {
    expect(ledgerSteps(10)).toEqual([10])
    expect(ledgerSteps(14)).toEqual([10, 12, 14])
  })

  it('a note one step off the staff needs no ledger line — it reads off the staff edge', () => {
    expect(ledgerSteps(-1)).toEqual([])
    expect(ledgerSteps(9)).toEqual([])
  })

  it('a note in a ledger space still shows the nearer ledger line as reference', () => {
    // Step -3 is the space just below the first ledger line (-2, middle C in treble).
    expect(ledgerSteps(-3)).toEqual([-2])
    expect(ledgerSteps(11)).toEqual([10])
  })
})
