import { describe, expect, it } from 'vitest'
import {
  calibrationStateText,
  looksWireless,
  spreadWarningText,
  storedOffsetText,
  summaryText,
  wirelessNoticeText,
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

describe('looksWireless', () => {
  it.each(['Bluetooth MIDI Kit', 'TD-17 BLE', 'WIDI Master', 'CME WIDI Bud'])('true for %s', (name) => {
    expect(looksWireless(name)).toBe(true)
  })

  it.each([undefined, 'Fake MIDI Test Keyboard', 'TD-17 USB', 'Cable'])('false for %s', (name) => {
    expect(looksWireless(name)).toBe(false)
  })
})

describe('wirelessNoticeText', () => {
  it('is undefined for a non-wireless-looking name', () => {
    expect(wirelessNoticeText('TD-17 USB')).toBeUndefined()
    expect(wirelessNoticeText(undefined)).toBeUndefined()
  })

  it('names the jitter caveat for a wireless-looking name', () => {
    expect(wirelessNoticeText('Bluetooth MIDI Kit')).toBe(
      'Bluetooth MIDI adds jitter that calibration cannot remove — only the constant offset is. Use USB for scored work.',
    )
  })
})

describe('spreadWarningText', () => {
  it('is undefined at or below 20ms spread', () => {
    expect(spreadWarningText({ offsetMs: 0, spreadMs: 20, samples: 16 })).toBeUndefined()
  })

  it('warns above 20ms spread', () => {
    expect(spreadWarningText({ offsetMs: 0, spreadMs: 20.1, samples: 16 })).toBe(
      'That spread is jitter, which calibration cannot remove — only the constant offset is. Use USB for scored work.',
    )
  })

  it('shortens the sentence above 20ms spread when the device looks wireless', () => {
    expect(spreadWarningText({ offsetMs: 0, spreadMs: 25, samples: 16 }, 'Bluetooth MIDI Kit')).toBe(
      'That spread is the Bluetooth jitter.',
    )
  })

  it('uses the full sentence above 20ms spread when the device does not look wireless', () => {
    expect(spreadWarningText({ offsetMs: 0, spreadMs: 25, samples: 16 }, 'TD-17 USB')).toBe(
      'That spread is jitter, which calibration cannot remove — only the constant offset is. Use USB for scored work.',
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
