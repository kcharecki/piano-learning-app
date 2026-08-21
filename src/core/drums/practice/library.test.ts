import { describe, expect, it } from 'vitest'
import { validateGrooveScore } from '@core/drums/model/groove.ts'
import { grooveById, grooveTrainerLibrary } from './library.ts'
import { planGrooveRun } from './plan.ts'

describe('grooveTrainerLibrary', () => {
  it('opens on the groove where every limb lands on a beat, then works up', () => {
    expect(grooveTrainerLibrary().map((groove) => groove.id)).toEqual([
      'quarter-note-rock',
      'money-beat',
      'money-beat-open-hat',
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
   * Half of what makes Ghost Funk that groove is eight ghosted snare strokes
   * against two accents, and a pad press carries no velocity. Offering it
   * would advertise a skill the trainer cannot sense. See the module comment.
   */
  it('leaves out the groove whose content the trainer cannot sense', () => {
    expect(grooveTrainerLibrary().map((groove) => groove.id)).not.toContain('ghost-funk-bar')
    for (const groove of grooveTrainerLibrary()) {
      expect(groove.notes.every((note) => note.dynamics === 'normal')).toBe(true)
    }
  })

  it('offers only valid, distinctly-titled scores', () => {
    const library = grooveTrainerLibrary()
    expect(new Set(library.map((groove) => groove.title)).size).toBe(library.length)
    for (const groove of library) expect(validateGrooveScore(groove).ok).toBe(true)
  })
})

describe('grooveById', () => {
  it('finds a library entry by id and nothing else', () => {
    expect(grooveById('money-beat')?.title).toBe('Money Beat')
    expect(grooveById('ghost-funk-bar')).toBeUndefined()
    expect(grooveById('nope')).toBeUndefined()
  })
})
