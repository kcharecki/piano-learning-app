import { describe, expect, it } from 'vitest'
import { validateGrooveScore } from '@core/drums/model/groove.ts'
import { grooveTrainerLibrary } from './library.ts'
import { planGrooveRun } from './plan.ts'

describe('grooveTrainerLibrary', () => {
  it('opens on the groove where every limb lands on a beat, then works up', () => {
    expect(grooveTrainerLibrary().map((groove) => groove.id)).toEqual([
      'quarter-note-rock',
      'money-beat',
      'money-beat-open-hat',
      'ghost-funk-bar',
    ])
  })

  it('is ordered so the grid never gets finer as the learner goes back a step', () => {
    const subdivisions = grooveTrainerLibrary().map(
      (groove) => planGrooveRun(groove, 80).subdivisionMs,
    )
    for (let i = 1; i < subdivisions.length; i++) {
      expect(subdivisions[i] ?? 0).toBeLessThanOrEqual(subdivisions[i - 1] ?? 0)
    }
  })

  /**
   * Review round 3, RED 2: `ghostFunkBar` withheld dynamics-graded content
   * while the trainer only sensed onsets. A pad press carries a velocity now
   * (keyboard Shift/Alt, MIDI velocity — see `dynamics.ts`), so the groove
   * belongs in the library, and at least one library entry has to actually
   * notate a ghost/accent for DR-03's dynamics grading to have anything to
   * exercise on real content.
   */
  it('includes the groove whose content needs dynamics grading, now that a pad press carries velocity', () => {
    const library = grooveTrainerLibrary()
    expect(library.map((groove) => groove.id)).toContain('ghost-funk-bar')
    expect(library.some((groove) => groove.notes.some((note) => note.dynamics === 'ghost'))).toBe(true)
    expect(library.some((groove) => groove.notes.some((note) => note.dynamics === 'accent'))).toBe(true)
  })

  it('offers only valid, distinctly-titled scores', () => {
    const library = grooveTrainerLibrary()
    expect(new Set(library.map((groove) => groove.title)).size).toBe(library.length)
    for (const groove of library) expect(validateGrooveScore(groove).ok).toBe(true)
  })
})
