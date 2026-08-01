/**
 * `noteDisplay.ts` (roadmap 2.12) — the pure grouping/label logic behind
 * `NoteListPreview.tsx`, testable without a DOM.
 */
import { buildTestScore } from '@test/fixtures.ts'
import { EIGHTH, HALF, QUARTER, WHOLE } from '@core/shared/units.ts'
import { describe, expect, it } from 'vitest'
import { durationLabel, groupByHandAndMeasure, noteLabel } from './noteDisplay.ts'

describe('durationLabel', () => {
  it.each([
    [WHOLE, 'whole'],
    [HALF, 'half'],
    [QUARTER, 'quarter'],
    [EIGHTH, 'eighth'],
    [EIGHTH / 2, 'sixteenth'],
    [QUARTER * 1.5, 'dotted quarter'],
    [7 * (QUARTER / 4), '7/16'],
  ])('labels %i ticks as %s', (ticks, label) => {
    expect(durationLabel(ticks)).toBe(label)
  })
})

describe('noteLabel', () => {
  it('names the pitch and the duration together', () => {
    const score = buildTestScore([{ midi: 61, startTick: 0, durationTicks: HALF }])
    expect(noteLabel(score.notes[0]!)).toBe('C#4 (half)')
  })
})

describe('groupByHandAndMeasure', () => {
  it('groups notes by hand, then by measure, in playing order', () => {
    const score = buildTestScore([
      { midi: 60, startTick: 0, hand: 'right' },
      { midi: 62, startTick: QUARTER, hand: 'right' },
      { midi: 48, startTick: 0, hand: 'left' },
      { midi: 60, startTick: WHOLE, hand: 'right' }, // measure 2
    ])

    const lines = groupByHandAndMeasure(score)

    expect(lines.map((l) => l.hand)).toEqual(['left', 'right'])
    const right = lines.find((l) => l.hand === 'right')!
    expect(right.measures).toHaveLength(2)
    expect(right.measures[0]!.notes.map((n) => n.midi)).toEqual([60, 62])
    expect(right.measures[1]!.notes.map((n) => n.midi)).toEqual([60])
  })

  it('omits a hand with no notes at all — a right-hand-only exercise has no left-hand line', () => {
    const score = buildTestScore([{ midi: 60, startTick: 0, hand: 'right' }])

    const lines = groupByHandAndMeasure(score)

    expect(lines.map((l) => l.hand)).toEqual(['right'])
  })
})
