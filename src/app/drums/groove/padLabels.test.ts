import { describe, expect, it } from 'vitest'
import { MAPPED_PADS, padOrderIndex, type DrumPad } from '@core/drums/model/pad.ts'
import { GROOVE_PAD_KEY, GROOVE_PAD_LABEL, keyLabel, sortPadsForDisplay } from './padLabels.ts'

describe('GROOVE_PAD_LABEL', () => {
  it('names every pad, including the unmapped one', () => {
    for (const pad of [...MAPPED_PADS, 'unmapped'] as const) {
      expect(GROOVE_PAD_LABEL[pad].length).toBeGreaterThan(0)
    }
  })

  /**
   * The pad buttons' accessible names come straight from this table, so two
   * pads sharing a label would give the screen two buttons a learner (and a
   * screen reader, and `getByRole('button', { name })`) cannot tell apart.
   */
  it('gives every pad a distinct label', () => {
    const labels = Object.values(GROOVE_PAD_LABEL)
    expect(new Set(labels).size).toBe(labels.length)
  })

  /** The open hat is its own instrument here — the grader times it separately. */
  it('does not call the open hat a kind of hi-hat the label collapses', () => {
    expect(GROOVE_PAD_LABEL.hhClosed).toBe('Hi-hat')
    expect(GROOVE_PAD_LABEL.hhOpen).toBe('Open hi-hat')
  })
})

describe('GROOVE_PAD_KEY', () => {
  it('puts the hi-hat under the right hand and the snare under the left', () => {
    expect(GROOVE_PAD_KEY.hhClosed).toBe('j')
    expect(GROOVE_PAD_KEY.snare).toBe('f')
    expect(GROOVE_PAD_KEY.kick).toBe(' ')
  })

  it('binds no two pads to the same key', () => {
    const keys = Object.values(GROOVE_PAD_KEY)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('binds only lower-case keys, because the handler lower-cases what it reads', () => {
    for (const key of Object.values(GROOVE_PAD_KEY)) expect(key).toBe(key.toLowerCase())
  })
})

describe('keyLabel', () => {
  it('spells the space bar out and upper-cases the letters', () => {
    expect(keyLabel(' ')).toBe('Space')
    expect(keyLabel('j')).toBe('J')
  })
})

describe('sortPadsForDisplay', () => {
  it('orders pads bottom-up, the model’s own canonical order', () => {
    const shuffled: readonly DrumPad[] = ['hhOpen', 'kick', 'hhClosed', 'snare']
    expect(sortPadsForDisplay(shuffled, (pad) => pad)).toEqual([
      'kick',
      'snare',
      'hhClosed',
      'hhOpen',
    ])
  })

  it('keeps the closed hat below the open one', () => {
    expect(padOrderIndex('hhClosed')).toBeLessThan(padOrderIndex('hhOpen'))
  })

  it('does not mutate the array it was given', () => {
    const input: readonly DrumPad[] = ['hhOpen', 'kick']
    const copy = [...input]
    sortPadsForDisplay(input, (pad) => pad)
    expect(input).toEqual(copy)
  })
})
