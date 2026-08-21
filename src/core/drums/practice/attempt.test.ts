import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { MAPPED_PADS } from '@core/drums/model/pad.ts'
import type { PadResult } from './grooveGrader.ts'
import {
  DEAD_ON_MS,
  FLAM_GAP_NOTE,
  GROOVE_PAD_LABEL,
  TIMING_CAVEAT,
  lastRunSummary,
  offsetPhrase,
  padLabel,
  padLineText,
  verdictText,
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
    spreadMs: 0,
    steady: true,
    toleranceMs: 40,
    steadyBarMs: 35,
    gridTicks: undefined,
    phaseSlipSteps: undefined,
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
  it('says late for a positive offset and early for a negative one, when the run was even', () => {
    expect(offsetPhrase(12, 0)).toBe('12 ms late')
    expect(offsetPhrase(-12, 0)).toBe('12 ms early')
  })

  it('rounds both figures to whole milliseconds — sub-millisecond precision is noise to a drummer', () => {
    expect(offsetPhrase(11.6, 0)).toBe('12 ms late')
    expect(offsetPhrase(-11.6, 0)).toBe('12 ms early')
    expect(offsetPhrase(95, 40.4)).toBe('95 ms late, ±40 ms')
  })

  it('reports a mean inside DEAD_ON_MS as dead on, in both directions, when the spread is small too', () => {
    expect(offsetPhrase(0, 0)).toBe('dead on')
    expect(offsetPhrase(DEAD_ON_MS, 0)).toBe('dead on')
    expect(offsetPhrase(-DEAD_ON_MS, 0)).toBe('dead on')
    expect(offsetPhrase(DEAD_ON_MS + 1, 0)).toBe(`${DEAD_ON_MS + 1} ms late`)
  })

  it('dead on: a tiny mean with a tiny spread reads as dead on, not as a number', () => {
    expect(offsetPhrase(0.4, 0)).toBe('dead on')
  })

  it('the panel blocker: a mean near zero built from alternating early/late hits must not read as dead on', () => {
    // Hi-hat hits alternating +80/-80 ms average to a mean near zero. Printing
    // "dead on" for that is exactly the bug this change exists to fix — the
    // grader now also hands over how far the hits scattered from their own
    // mean, and that spread is what turns this into an honest sentence.
    expect(offsetPhrase(0.4, 80)).toBe('centred on the beat, ±80 ms')
  })

  it('a perfectly even run that is uniformly late prints no ± at all', () => {
    expect(offsetPhrase(95, 0)).toBe('95 ms late')
  })

  it('a late run that is also scattered prints both the bias and the spread', () => {
    expect(offsetPhrase(95, 40)).toBe('95 ms late, ±40 ms')
  })

  it('says nothing landed when no hit matched at all', () => {
    expect(offsetPhrase(undefined, undefined)).toBe('nothing landed')
  })

  it('property: a phrase never reads "0 ms", in either direction', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: 0, max: 5000, noNaN: true }),
        (offset, spread) => {
          expect(offsetPhrase(offset, spread)).not.toMatch(/\b0 ms\b/)
        },
      ),
    )
  })
})

describe('verdictText', () => {
  it('says not there yet whenever the run is incomplete, regardless of steadiness', () => {
    expect(verdictText({ complete: false, steady: false })).toBe('Not there yet')
    expect(verdictText({ complete: false, steady: true })).toBe('Not there yet')
  })

  it('says every note but not together when complete and unsteady with no alignment data to tell the fault apart', () => {
    // Without padAlignmentMs/laggingPad/leadingPad this function cannot tell
    // a genuinely uneven pad from a flam (see the flam-split tests below), so
    // it must not guess at either by name — this is the sentence that is
    // true regardless of which one it was.
    expect(verdictText({ complete: true, steady: false })).toBe('Every note, but not together yet')
  })

  it('says steady run when complete and even', () => {
    expect(verdictText({ complete: true, steady: true })).toBe('Steady run')
  })

  it('never says "clean" — that word certified placement this app cannot measure', () => {
    expect(verdictText({ complete: false, steady: false })).not.toMatch(/clean/i)
    expect(verdictText({ complete: true, steady: false })).not.toMatch(/clean/i)
    expect(verdictText({ complete: true, steady: true })).not.toMatch(/clean/i)
  })

  describe('the flam split', () => {
    it('the panel blocker: every pad even, but two pads not together, names the limb instead of blaming the pulse', () => {
      // Hats and snare exact, kick 60-70 ms behind the hi-hat it shares beat
      // 1 with. The old two-way split called this "the pulse is uneven",
      // which is false — every pad's own pulse was fine.
      const text = verdictText({
        complete: true,
        steady: false,
        padAlignmentMs: 61,
        laggingPad: 'kick',
        leadingPad: 'hhClosed',
      })
      expect(text).toBe(
        'Your kick is 61 ms behind your hi-hat. ' +
          'That gap is real: a slow keyboard or speakers would delay every drum by the same amount, not just one.',
      )
      expect(text).not.toMatch(/pulse is uneven/i)
    })

    it('rounds the alignment gap to whole milliseconds', () => {
      const text = verdictText({
        complete: true,
        steady: false,
        padAlignmentMs: 60.6,
        laggingPad: 'kick',
        leadingPad: 'hhClosed',
      })
      expect(text).toContain('Your kick is 61 ms behind your hi-hat.')
    })

    it('when alignment is known and fine, an unsteady run is still the pulse — that fault is real too', () => {
      const text = verdictText({
        complete: true,
        steady: false,
        padAlignmentMs: 10,
        laggingPad: 'kick',
        leadingPad: 'hhClosed',
      })
      expect(text).toBe('Every note, but the pulse is uneven')
    })

    it('when alignment is unknown, the fallback names neither fault — it only claims what is true of both', () => {
      const text = verdictText({ complete: true, steady: false })
      expect(text).toBe('Every note, but not together yet')
      expect(text).not.toMatch(/pulse is uneven/i)
      expect(text).not.toMatch(/\d+ ms/)
    })
  })
})

describe('padLineText', () => {
  it('a steady, complete pad reads as its own count and its own offset', () => {
    expect(padLineText(row({ meanOffsetMs: 12, spreadMs: 2, steady: true }))).toBe('Hi-hat — 16 of 16, 12 ms late')
  })

  it('a scattered, complete pad reads as centred with its spread, never as dead on', () => {
    expect(padLineText(row({ meanOffsetMs: 0.4, spreadMs: 80, steady: false }))).toBe(
      'Hi-hat — 16 of 16, centred on the beat, ±80 ms',
    )
  })

  it('names the misses and extras, but not an offset — a partial match is not evidence about the whole pad', () => {
    const line = padLineText(
      row({ pad: 'snare', expected: 4, matched: 2, missed: 2, extra: 1, meanOffsetMs: 30, spreadMs: 1, steady: true }),
    )
    expect(line).toBe('Snare — 2 of 4, 2 missed, 1 extra')
  })

  it('the panel minor: "12 missed, 12 extra, dead on" — an offset built from wrong-note matches must not be printed', () => {
    // Ghost Funk Bar, whole performance one sixteenth late: the 8 "matched"
    // pairs are hits paired with a *different* notated snare, so the mean
    // they produce is not a fact about this pad and must be withheld, not
    // rounded down to "dead on".
    const line = padLineText(
      row({ pad: 'snare', expected: 20, matched: 8, missed: 12, extra: 12, meanOffsetMs: 0.4, spreadMs: 1, steady: true }),
    )
    expect(line).toBe('Snare — 8 of 20, 12 missed, 12 extra')
    expect(line).not.toMatch(/dead on/i)
  })

  it('an offset is still printed once a pad matches every note it was asked for, with nothing spurious', () => {
    const line = padLineText(row({ meanOffsetMs: 5, spreadMs: 1, steady: true }))
    expect(line).toBe('Hi-hat — 16 of 16, 5 ms late')
  })

  describe('phase slip', () => {
    it('the panel blocker: a whole line one grid step late reads as a named shift, not a millisecond lie', () => {
      // Ghost Funk Bar, hi-hat played a whole sixteenth (gridTicks: 120)
      // behind the click. The screen used to say "11 ms late, ±4 ms" — a
      // false statement about a learner who never once played on the beat.
      const line = padLineText(
        row({
          pad: 'hhClosed',
          expected: 32,
          matched: 31,
          missed: 1,
          extra: 1,
          meanOffsetMs: 11,
          spreadMs: 4,
          steady: true,
          gridTicks: 120,
          phaseSlipSteps: 1,
        }),
      )
      expect(line).toBe('Hi-hat — 31 of 32, 1 missed, 1 extra, your hi-hat is one sixteenth behind the click')
      expect(line).not.toMatch(/\d+ ms/)
    })

    it('a negative phaseSlipSteps reads as ahead of the click, not behind it', () => {
      const line = padLineText(
        row({ pad: 'snare', expected: 4, matched: 4, gridTicks: 240, phaseSlipSteps: -1 }),
      )
      expect(line).toBe('Snare — 4 of 4, your snare is one eighth ahead of the click')
    })

    it('two grid steps spells "two" and pluralises the grid name', () => {
      const line = padLineText(row({ pad: 'kick', expected: 4, matched: 4, gridTicks: 60, phaseSlipSteps: 2 }))
      expect(line).toBe('Kick — 4 of 4, your kick is two thirty-seconds behind the click')
    })

    it.each([
      [480, 'quarter'],
      [320, 'dotted quarter'],
      [240, 'eighth'],
      [160, 'eighth triplet'],
      [120, 'sixteenth'],
      [60, 'thirty-second'],
    ])('names gridTicks %i as %s', (gridTicks, name) => {
      const line = padLineText(row({ expected: 4, matched: 4, gridTicks, phaseSlipSteps: 1 }))
      expect(line).toBe(`Hi-hat — 4 of 4, your hi-hat is one ${name} behind the click`)
    })

    it('a gridTicks value with no name reads as a step of the pattern, never a guessed name', () => {
      const line = padLineText(row({ expected: 4, matched: 4, gridTicks: 90, phaseSlipSteps: 1 }))
      expect(line).toBe('Hi-hat — 4 of 4, your hi-hat is one step of the pattern behind the click')
    })

    it('gridTicks undefined also reads as a step of the pattern', () => {
      const line = padLineText(row({ expected: 4, matched: 4, gridTicks: undefined, phaseSlipSteps: 1 }))
      expect(line).toBe('Hi-hat — 4 of 4, your hi-hat is one step of the pattern behind the click')
    })

    it('takes priority over the minor fix above — misses and extras still show, but so does the named shift', () => {
      const line = padLineText(
        row({ pad: 'snare', expected: 20, matched: 8, missed: 12, extra: 12, gridTicks: 120, phaseSlipSteps: 1 }),
      )
      expect(line).toBe('Snare — 8 of 20, 12 missed, 12 extra, your snare is one sixteenth behind the click')
    })
  })

  it('a limb that played nowhere near its notes still names the limb', () => {
    const line = padLineText(
      row({
        pad: 'snare',
        expected: 4,
        matched: 0,
        missed: 4,
        extra: 4,
        meanOffsetMs: undefined,
        worstOffsetMs: undefined,
        spreadMs: undefined,
        steady: false,
      }),
    )
    expect(line).toBe('Snare — 0 of 4, 4 missed, 4 extra')
    expect(line).not.toContain('nothing landed')
  })

  it('a pad the groove never asks for says so rather than reading as 0 of 0', () => {
    expect(
      padLineText(
        row({
          pad: 'crash1',
          expected: 0,
          matched: 0,
          missed: 0,
          extra: 2,
          meanOffsetMs: undefined,
          worstOffsetMs: undefined,
          spreadMs: undefined,
          steady: false,
        }),
      ),
    ).toBe('Crash — not in this groove, 2 extra')
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
            spreadMs: matched === 0 ? undefined : 0,
            steady: matched === expected && extra === 0,
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
    steady: true,
    pads: [
      row(),
      row({ pad: 'snare', expected: 4, matched: 4 }),
      row({ pad: 'kick', expected: 4, matched: 4 }),
    ],
  }

  it('names the verdict, the groove, the tempo and every pad count, in the order they were shown', () => {
    expect(lastRunSummary(attempt)).toBe(
      'Last run: Money Beat at 80 bpm — Steady run: Hi-hat 16 of 16, Snare 4 of 4, Kick 4 of 4',
    )
  })

  it('leaves an off-groove pad out of the per-pad list, but its extra still counts against the verdict', () => {
    const withStray: DrumsGrooveAttempt = {
      ...attempt,
      steady: false,
      pads: [
        ...attempt.pads,
        row({
          pad: 'crash1',
          expected: 0,
          matched: 0,
          extra: 1,
          meanOffsetMs: undefined,
          worstOffsetMs: undefined,
          spreadMs: undefined,
          steady: false,
        }),
      ],
    }
    const summary = lastRunSummary(withStray)
    expect(summary).toBe(
      'Last run: Money Beat at 80 bpm — Not there yet: Hi-hat 16 of 16, Snare 4 of 4, Kick 4 of 4',
    )
    expect(summary).not.toContain('Crash')
  })

  it('still says what was played when the run matched nothing at all', () => {
    const nothing: DrumsGrooveAttempt = {
      ...attempt,
      steady: false,
      pads: [
        row({
          expected: 16,
          matched: 0,
          missed: 16,
          meanOffsetMs: undefined,
          worstOffsetMs: undefined,
          spreadMs: undefined,
          steady: false,
        }),
      ],
    }
    expect(lastRunSummary(nothing)).toBe('Last run: Money Beat at 80 bpm — Not there yet: Hi-hat 0 of 16')
  })

  it('the defect this fixes: full counts with hidden extras must not read back as a complete run', () => {
    const notSteady: DrumsGrooveAttempt = {
      grooveId: 'money-beat',
      grooveTitle: 'Money Beat',
      bpm: 80,
      repeats: 2,
      at: 1_700_000_000_000,
      steady: false,
      pads: [
        row({ pad: 'hhClosed', expected: 16, matched: 16, missed: 0, extra: 8, meanOffsetMs: 5, worstOffsetMs: 20, spreadMs: 10, steady: true }),
        row({ pad: 'snare', expected: 4, matched: 4, missed: 0, extra: 0, meanOffsetMs: 2, worstOffsetMs: 4, spreadMs: 1, steady: true }),
        row({ pad: 'kick', expected: 4, matched: 2, missed: 2, extra: 0, meanOffsetMs: 3, worstOffsetMs: 5, spreadMs: 2, steady: true }),
      ],
    }
    const summary = lastRunSummary(notSteady)
    expect(summary).toBe(
      'Last run: Money Beat at 80 bpm — Not there yet: Hi-hat 16 of 16 (8 extra), Snare 4 of 4, Kick 2 of 4',
    )
    expect(summary).not.toBe(
      'Last run: Money Beat at 80 bpm — Steady run: Hi-hat 16 of 16, Snare 4 of 4, Kick 2 of 4',
    )
  })

  it('a stored flam run does not claim the pulse is uneven — the pulse was fine, the drums were not together', () => {
    // DrumsGrooveAttempt never stores padAlignmentMs/laggingPad/leadingPad
    // (see the type's own doc), so a flam read back from history has no way
    // to be named by limb. It must not fall back to "the pulse is uneven"
    // either — that is just as false here as it was on the live screen.
    const flamAttempt: DrumsGrooveAttempt = {
      grooveId: 'money-beat',
      grooveTitle: 'Money Beat',
      bpm: 80,
      repeats: 2,
      at: 1_700_000_000_000,
      steady: false,
      pads: [
        row({ pad: 'hhClosed', expected: 16, matched: 16, missed: 0, extra: 0, meanOffsetMs: 8, spreadMs: 3, steady: true }),
        row({ pad: 'kick', expected: 4, matched: 4, missed: 0, extra: 0, meanOffsetMs: 69, spreadMs: 4, steady: true }),
      ],
    }
    const summary = lastRunSummary(flamAttempt)
    expect(summary).toBe(
      'Last run: Money Beat at 80 bpm — Every note, but not together yet: Hi-hat 16 of 16, Kick 4 of 4',
    )
    expect(summary).not.toMatch(/uneven/i)
  })
})

describe('TIMING_CAVEAT', () => {
  it('is non-empty and discloses the hardware hiding inside every millisecond figure', () => {
    expect(TIMING_CAVEAT.length).toBeGreaterThan(0)
    expect(TIMING_CAVEAT).toMatch(/keyboard/i)
    expect(TIMING_CAVEAT).toMatch(/speaker/i)
  })
})

describe('FLAM_GAP_NOTE', () => {
  it('is non-empty and says the gap survives device delay, unlike a single pad mean', () => {
    expect(FLAM_GAP_NOTE.length).toBeGreaterThan(0)
    expect(FLAM_GAP_NOTE).toMatch(/real/i)
  })
})
