import { describe, expect, it } from 'vitest'
import {
  calibrationStateText,
  spreadWarningText,
  storedOffsetText,
  summaryText,
} from './calibrationText.ts'

describe('calibrationStateText', () => {
  it('idle', () => {
    expect(calibrationStateText('idle', 0, 0)).toBe('Play along with the click on any pad. 16 hits.')
  })

  it('count-in echoes the beat', () => {
    expect(calibrationStateText('count-in', 3, 0)).toBe('Count-in… 3')
  })

  it('collecting echoes hits out of 16', () => {
    expect(calibrationStateText('collecting', 1, 7)).toBe('Hit 7 of 16')
  })

  it('done', () => {
    expect(calibrationStateText('done', 0, 16)).toBe('Done')
  })
})

describe('summaryText', () => {
  it('reads late for a positive offset', () => {
    expect(summaryText({ offsetMs: 30, spreadMs: 5, samples: 16 })).toBe(
      'Your hits read 30 ms late on average (spread ±5 ms)',
    )
  })

  it('reads early for a negative offset', () => {
    expect(summaryText({ offsetMs: -18, spreadMs: 4, samples: 16 })).toBe(
      'Your hits read 18 ms early on average (spread ±4 ms)',
    )
  })

  it('reads "on the click" when the rounded offset is 0', () => {
    expect(summaryText({ offsetMs: 0.4, spreadMs: 3, samples: 16 })).toBe(
      'Your hits read on the click (spread ±3 ms)',
    )
    expect(summaryText({ offsetMs: -0.4, spreadMs: 3, samples: 16 })).toBe(
      'Your hits read on the click (spread ±3 ms)',
    )
  })

  it('rounds the absolute offset and the spread', () => {
    expect(summaryText({ offsetMs: 29.6, spreadMs: 4.5, samples: 16 })).toBe(
      'Your hits read 30 ms late on average (spread ±5 ms)',
    )
  })
})

describe('spreadWarningText', () => {
  it('is undefined at or below 20ms spread', () => {
    expect(spreadWarningText({ offsetMs: 0, spreadMs: 20, samples: 16 })).toBeUndefined()
  })

  it('warns above 20ms spread', () => {
    expect(spreadWarningText({ offsetMs: 0, spreadMs: 21, samples: 16 })).toBe(
      'Windows tighter than that will feel random.',
    )
  })
})

describe('storedOffsetText', () => {
  it('reads "no offset stored" when nothing is stored', () => {
    expect(storedOffsetText('Pads and keys', undefined)).toBe('Pads and keys: no offset stored')
  })

  it('names the input and the stored late offset', () => {
    expect(
      storedOffsetText('Pads and keys', { offsetMs: 30, spreadMs: 5, samples: 16, at: 0 }),
    ).toBe('Pads and keys: 30 ms late offset stored')
  })

  it('names the input and the stored early offset', () => {
    expect(
      storedOffsetText('TD-17', { offsetMs: -12, spreadMs: 5, samples: 16, at: 0 }),
    ).toBe('TD-17: 12 ms early offset stored')
  })

  it('reads "0 ms offset stored" — no "late"/"early" word — when the rounded offset is 0', () => {
    expect(
      storedOffsetText('Pads and keys', { offsetMs: 0.4, spreadMs: 5, samples: 16, at: 0 }),
    ).toBe('Pads and keys: 0 ms offset stored')
    expect(
      storedOffsetText('Pads and keys', { offsetMs: -0.4, spreadMs: 5, samples: 16, at: 0 }),
    ).toBe('Pads and keys: 0 ms offset stored')
  })
})
