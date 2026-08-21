import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { MAPPED_PADS } from '@core/drums/model/pad.ts'
import type { PadResult } from './grooveGrader.ts'
import {
  DEAD_ON_MS,
  GROOVE_PAD_LABEL,
  lastRunSummary,
  offsetPhrase,
  padLabel,
  padLineText,
  type DrumsGrooveAttempt,
} from './attempt.ts'

function row(over: Partial<PadResult> = {}): PadResult {
  return {
    pad: 'hhClosed',
    expected: 16,
    matched: 16,
    missed: 0,
    extra: 0,
    meanOffsetMs: 0,
    worstOffsetMs: 0,
    ...over,
  }
}

describe('padLabel', () => {
  it('names every mapped pad in kit vocabulary, not MusicXML instrument names', () => {
    for (const pad of MAPPED_PADS) {
      expect(padLabel(pad)).toBe(GROOVE_PAD_LABEL[pad])
      expect(padLabel(pad).length).toBeGreaterThan(0)
    }
  })

  it('names an unclassifiable live hit rather than showing its internal id', () => {
    expect(padLabel('unmapped')).toBe('Unrecognised hit')
  })
})

describe('offsetPhrase', () => {
  it('says late for a positive offset and early for a negative one', () => {
    expect(offsetPhrase(12)).toBe('12 ms late')
    expect(offsetPhrase(-12)).toBe('12 ms early')
  })

  it('rounds to whole milliseconds — sub-millisecond precision is noise to a drummer', () => {
    expect(offsetPhrase(11.6)).toBe('12 ms late')
    expect(offsetPhrase(-11.6)).toBe('12 ms early')
  })

  it('reports anything inside DEAD_ON_MS as dead on, in both directions', () => {
    expect(offsetPhrase(0)).toBe('dead on')
    expect(offsetPhrase(DEAD_ON_MS)).toBe('dead on')
    expect(offsetPhrase(-DEAD_ON_MS)).toBe('dead on')
    expect(offsetPhrase(DEAD_ON_MS + 1)).toBe(`${DEAD_ON_MS + 1} ms late`)
  })

  it('says nothing landed when no hit matched at all', () => {
    expect(offsetPhrase(undefined)).toBe('nothing landed')
  })

  it('property: a phrase never reads "0 ms", in either direction', () => {
    fc.assert(
      fc.property(fc.double({ min: -5000, max: 5000, noNaN: true }), (offset) => {
        expect(offsetPhrase(offset)).not.toMatch(/\b0 ms\b/)
      }),
    )
  })
})

describe('padLineText', () => {
  it('a clean pad reads as its own count and its own offset', () => {
    expect(padLineText(row({ meanOffsetMs: 12 }))).toBe('Hi-hat — 16 of 16, 12 ms late')
  })

  it('names the misses and extras before the offset, because they are the bigger fact', () => {
    const line = padLineText(row({ pad: 'snare', expected: 4, matched: 2, missed: 2, extra: 1, meanOffsetMs: 30 }))
    expect(line).toBe('Snare — 2 of 4, 2 missed, 1 extra, 30 ms late')
  })

  it('a limb that played nowhere near its notes still names the limb', () => {
    const line = padLineText(
      row({ pad: 'snare', expected: 4, matched: 0, missed: 4, extra: 4, meanOffsetMs: undefined, worstOffsetMs: undefined }),
    )
    expect(line).toBe('Snare — 0 of 4, 4 missed, 4 extra')
    expect(line).not.toContain('nothing landed')
  })

  it('a pad the groove never asks for says so rather than reading as 0 of 0', () => {
    expect(padLineText(row({ pad: 'crash1', expected: 0, matched: 0, missed: 0, extra: 2, meanOffsetMs: undefined, worstOffsetMs: undefined }))).toBe(
      'Crash — not in this groove, 2 extra',
    )
  })

  it('property: every line starts with the pad the learner sees on the pad itself', () => {
    const padArb = fc.constantFrom(...MAPPED_PADS)
    fc.assert(
      fc.property(padArb, fc.nat({ max: 32 }), fc.nat({ max: 32 }), fc.nat({ max: 8 }), (pad, expected, matchedRaw, extra) => {
        const matched = Math.min(matchedRaw, expected)
        const line = padLineText(
          row({
            pad,
            expected,
            matched,
            missed: expected - matched,
            extra,
            meanOffsetMs: matched === 0 ? undefined : 0,
            worstOffsetMs: matched === 0 ? undefined : 0,
          }),
        )
        expect(line.startsWith(`${GROOVE_PAD_LABEL[pad]} — `)).toBe(true)
      }),
    )
  })
})

describe('lastRunSummary', () => {
  const attempt: DrumsGrooveAttempt = {
    grooveId: 'money-beat',
    grooveTitle: 'Money Beat',
    bpm: 80,
    repeats: 2,
    at: 1_700_000_000_000,
    clean: true,
    pads: [
      row(),
      row({ pad: 'snare', expected: 4, matched: 4 }),
      row({ pad: 'kick', expected: 4, matched: 4 }),
    ],
  }

  it('names the groove, the tempo and every pad count, in the order they were shown', () => {
    expect(lastRunSummary(attempt)).toBe(
      'Last run: Money Beat at 80 bpm — Hi-hat 16 of 16, Snare 4 of 4, Kick 4 of 4',
    )
  })

  it('leaves out pads the groove never asked for — a stray crash is not part of the reminder', () => {
    const withStray: DrumsGrooveAttempt = {
      ...attempt,
      pads: [...attempt.pads, row({ pad: 'crash1', expected: 0, matched: 0, extra: 1, meanOffsetMs: undefined, worstOffsetMs: undefined })],
    }
    expect(lastRunSummary(withStray)).toBe(lastRunSummary(attempt))
  })

  it('still says what was played when the run matched nothing at all', () => {
    const nothing: DrumsGrooveAttempt = {
      ...attempt,
      clean: false,
      pads: [row({ expected: 16, matched: 0, missed: 16, meanOffsetMs: undefined, worstOffsetMs: undefined })],
    }
    expect(lastRunSummary(nothing)).toBe('Last run: Money Beat at 80 bpm — Hi-hat 0 of 16')
  })
})
