/**
 * `noteDisplay.ts` — the duration-label logic behind
 * `@app/rhythm/PatternPreview.tsx`, testable without a DOM.
 */
import { EIGHTH, HALF, QUARTER, WHOLE } from '@core/shared/units.ts'
import { describe, expect, it } from 'vitest'
import { durationLabel } from './noteDisplay.ts'

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
